import { withSpan } from '../trace/trace.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AudioMeta, RenderInput, RenderRecord, VideoState } from '../contracts/types.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { newId } from '../domain/ids.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { isSfError, SfError } from '../errors.js';
import { BuildGraph, unsettled, type BuilderRegistry } from '../graph/graph.js';
import { hfCheck, hfInstall } from '../hf/cli.js';
import { loadVideoModel } from '../graph/model.js';
import { loadOutputProfile } from '../hf/outputs.js';
import { readChannelAssets } from '../hf/packet.js';
import { Logger } from '../log.js';
import { buildCredits } from '../music/credits.js';
import { trackById } from '../music/library.js';
import { createScratchDir } from '../store/scratch.js';
import type { WriteStore } from '../store/writer.js';
import { hfRender } from './hf-render.js';
import { finishVideo, probeDurationMs, probeMedia } from './post.js';
import { publishProblems, type PlatformId } from '../publish/limits.js';
import { resolveConfig } from '../config/resolve.js';

export interface RenderDeps {
  store: WriteStore;
  builders: BuilderRegistry;
  appDataDir?: string;
  logger?: Logger;
}

/** `RenderInput` của D4 mục 3 (output profile mặc định theo video) + thông tin job. */
export interface RenderJobInput extends Omit<RenderInput, 'output_profile'> {
  output_profile?: string;
  /** Id cấp trước (job) để khôi phục biết thư mục; không có → tạo mới. */
  render_id?: string;
  /** Bước workflow đang chạy render (bỏ qua điểm duyệt của chính nó). */
  step_id?: string;
}

type Gate = RenderRecord['gate_results'][number];

/** Khóa của bản HyperFrames: nội dung mọi thứ render đọc (index, frame, audio, ảnh) + fps/crf + bản HyperFrames. */
export function renderKey(d: RenderDeps, videoId: string, fps: number, crf: number): string {
  const m = loadVideoModel(d.store.root, videoId, d.appDataDir);
  return sha256(
    canonicalJson({
      files: ['index.html', 'hyperframes.json', 'compositions', 'audio', 'public'].map((f) =>
        m.hashOf(f),
      ),
      fps,
      crf,
      hf: hfInstall().version,
    }),
  ).slice(0, 32);
}

/** Giữ bản HyperFrames của bản nháp (dữ liệu dẫn xuất `.sf/`, chỉ bản mới nhất của video). */
function keepRaw(store: WriteStore, v: string, raw: string, rel: string): void {
  const dir = store.abs(`${v}/.sf/render-raw`);
  for (const f of existsSync(dir) ? readdirSync(dir) : [])
    store.removeDerived(`${v}/.sf/render-raw/${f}`);
  store.importFile(raw, rel, { by: 'render' });
}

export function newRenderId(store: WriteStore, videoId: string): string {
  const dir = store.abs(`videos/${videoId}/renders`);
  return newId('rd', new Set(existsSync(dir) ? readdirSync(dir) : []));
}

const recRel = (videoId: string, rd: string) => `videos/${videoId}/renders/${rd}/render.json`;

export function writeRecord(store: WriteStore, videoId: string, r: RenderRecord): void {
  store.write(recRel(videoId, r.id), `${JSON.stringify(r, null, 2)}\n`, { by: 'render' });
}

/** Render bị ngắt khi tắt app (AC-M1-05): `render.json` `running` → `failed`. */
export function markInterrupted(store: WriteStore, videoId: string, rd: string): void {
  const f = store.abs(recRel(videoId, rd));
  if (!existsSync(f)) return;
  const r = JSON.parse(readFileSync(f, 'utf8')) as RenderRecord;
  if (r.status !== 'running') return;
  writeRecord(store, videoId, {
    ...r,
    status: 'failed',
    finished_at: new Date().toISOString(),
    gate_results: [
      ...r.gate_results,
      {
        gate: 'interrupted',
        pass: false,
        detail: 'app closed while rendering (E_JOB_INTERRUPTED)',
      },
    ],
  });
}

/** Gate phát hành (013 FR-003); nháp chạy cùng gate nhưng chỉ cảnh báo. */
export async function releaseGates(
  d: RenderDeps,
  videoId: string,
  input: RenderJobInput,
  signal?: AbortSignal,
): Promise<Gate[]> {
  const v = `videos/${videoId}`;
  const gates: Gate[] = [];
  const stale = new BuildGraph({ store: d.store, appDataDir: d.appDataDir, builders: d.builders })
    .status(videoId)
    .filter(unsettled);
  gates.push({
    gate: 'graph_fresh',
    pass: stale.length === 0,
    ...(stale.length
      ? {
          detail: stale
            .map((n) => `${n.key}: ${n.status}`)
            .slice(0, 8)
            .join('; '),
        }
      : {}),
  });
  const metaFile = d.store.abs(`${v}/audio_meta.json`);
  const bad = existsSync(metaFile)
    ? (JSON.parse(readFileSync(metaFile, 'utf8')) as AudioMeta).lines
        .filter((l) => l.asr_flag === 'mismatch')
        .map((l) => l.line_id)
    : [];
  gates.push({
    gate: 'asr',
    pass: bad.length === 0,
    ...(bad.length
      ? { detail: `lines still misread: ${bad.join(', ')} (asr.accept or fix the text)` }
      : {}),
  });
  const st = JSON.parse(readFileSync(d.store.abs(`${v}/state.json`), 'utf8')) as VideoState;
  if (st.phase === 'workflow') {
    const open = st.approvals
      .filter((a) => a.step_id !== input.step_id && a.status !== 'approved')
      .map((a) => `${a.step_id} (${a.status})`);
    gates.push({
      gate: 'approvals',
      pass: open.length === 0,
      ...(open.length ? { detail: `not approved: ${open.join(', ')}` } : {}),
    });
  }
  if (existsSync(d.store.abs(`${v}/index.html`))) {
    try {
      const chk = await hfCheck(d.store.abs(v), signal ? { signal } : {});
      gates.push({
        gate: 'hf_check',
        pass: chk.ok,
        ...(chk.ok
          ? {}
          : {
              detail: chk.errors
                .slice(0, 5)
                .map((e) => `${e.code}: ${e.message}`)
                .join('; '),
            }),
      });
    } catch (e) {
      if (isSfError(e) && e.code === 'E_JOB_CANCELED') throw e;
      gates.push({ gate: 'hf_check', pass: false, detail: String((e as Error).message) });
    }
  } else gates.push({ gate: 'hf_check', pass: false, detail: 'index.html is missing' });
  return gates;
}

/** `CREDITS.txt`: nhạc trong `index.html` + asset thư viện được frame dùng (D8 mục 4). */
export function creditsFor(d: RenderDeps, videoId: string): string {
  const v = d.store.abs(`videos/${videoId}`);
  const index = readFileSync(path.join(v, 'index.html'), 'utf8');
  const ids = /data-sf-track="([^"]+)"/.exec(index)?.[1]?.split(',') ?? [];
  const tracks = ids
    .map((id) => (d.appDataDir ? trackById(d.store, d.appDataDir, id)?.track : undefined))
    .filter((t) => t !== undefined);
  const framesDir = path.join(v, 'compositions', 'frames');
  const html = existsSync(framesDir)
    ? readdirSync(framesDir)
        .map((f) => readFileSync(path.join(framesDir, f), 'utf8'))
        .join('\n')
    : '';
  const assets = readChannelAssets(d.store.root).filter((a) => html.includes(`public/${a.id}`));
  return buildCredits(tracks, assets);
}

/**
 * `render.video` (D4): build graph → gate → `hyperframes render` → hậu kỳ (độ to, "NHÁP") →
 * `renders/<rd>/video.mp4` + `render.json`; phát hành kèm `CREDITS.txt`, `description.txt`.
 */
type RenderOpts = {
  signal?: AbortSignal;
  /** Đang ở trong `graph.build` (nút `render`, 020): không build lại (tránh khóa lồng). */
  skipBuild?: boolean;
  progress?: (done: number, total: number, message?: string) => void;
};

export function renderVideo(
  d: RenderDeps,
  videoId: string,
  input: RenderJobInput,
  o: RenderOpts = {},
): Promise<RenderRecord> {
  return withSpan('sf.render', { 'sf.mode': input.mode, 'sf.video_id': videoId }, async (span) => {
    const r = await renderVideoInner(d, videoId, input, o);
    span.setAttributes({
      'sf.duration_ms': r.duration_ms ?? 0,
      'sf.output_profile': r.output_profile,
    });
    return r;
  });
}

async function renderVideoInner(
  d: RenderDeps,
  videoId: string,
  input: RenderJobInput,
  o: RenderOpts,
): Promise<RenderRecord> {
  const logger = d.logger ?? new Logger();
  const v = `videos/${videoId}`;
  const st = JSON.parse(readFileSync(d.store.abs(`${v}/state.json`), 'utf8')) as VideoState;
  const profile = loadOutputProfile(input.output_profile ?? st.output_profile);
  const rd = input.render_id ?? newRenderId(d.store, videoId);
  const rec: RenderRecord = {
    schema_version: 1,
    id: rd as RenderRecord['id'],
    mode: input.mode,
    output_profile: profile.id,
    started_at: new Date().toISOString(),
    status: 'running',
    gate_results: [],
    index_hash: '0'.repeat(64),
  };
  writeRecord(d.store, videoId, rec);
  const progress = (pct: number, msg?: string) => o.progress?.(Math.round(pct), 100, msg);
  const scratch = createScratchDir('sf-render-');
  try {
    progress(1, 'build graph');
    const built = o.skipBuild
      ? {
          status: 'succeeded' as const,
          nodes: {} as Record<string, { status: string; error?: { message: string } }>,
        }
      : await new BuildGraph({
          store: d.store,
          appDataDir: d.appDataDir,
          builders: d.builders,
        }).build(videoId, { ...(o.signal ? { signal: o.signal } : {}) });
    if (!existsSync(d.store.abs(`${v}/index.html`))) {
      const failed = Object.entries(built.nodes)
        .filter(([, n]) => n.status === 'failed')
        .map(([id, n]) => `${id}: ${n.error?.message}`);
      throw new SfError(
        'E_GATE_FAILED',
        `index.html could not be built: ${failed.join('; ') || built.status}`,
      );
    }
    rec.index_hash = sha256(readFileSync(d.store.abs(`${v}/index.html`)));
    progress(5, 'gates');
    rec.gate_results = await releaseGates(d, videoId, input, o.signal);
    const failing = rec.gate_results.filter((g) => !g.pass);
    if (input.mode === 'release' && failing.length) {
      throw new SfError(
        'E_GATE_FAILED',
        `release gates failed: ${failing.map((g) => `${g.gate}: ${g.detail ?? ''}`).join('; ')}`,
      );
    }
    // render một lần: bản HyperFrames của bản nháp được giữ theo khóa nội dung; Render phát hành (hoặc nháp
    // lại) với cùng hình/tiếng/tham số dùng lại, chỉ hoàn thiện (mã lại, chuẩn hóa âm lượng)
    const key = renderKey(d, videoId, profile.fps, profile.video.crf);
    const cacheRel = `${v}/.sf/render-raw/${key}.mp4`;
    let raw = path.join(scratch.dir, 'raw.mp4');
    if (existsSync(d.store.abs(cacheRel))) {
      raw = d.store.abs(cacheRel);
      progress(85, 'reuse draft render');
    } else {
      await hfRender(d.store.abs(v), raw, {
        fps: profile.fps,
        crf: profile.video.crf,
        ...(o.signal ? { signal: o.signal } : {}),
        progress: (p, m) => progress(10 + p * 0.75, m),
      });
      if (input.mode === 'draft') keepRaw(d.store, v, raw, cacheRel);
    }
    progress(86, 'loudness');
    const final = path.join(scratch.dir, 'video.mp4');
    await finishVideo(raw, final, {
      lufs: profile.audio.loudness_lufs,
      draft: input.mode === 'draft',
      crf: profile.video.crf,
      fps: profile.fps,
      ...(o.signal ? { signal: o.signal } : {}),
    });
    const file = `renders/${rd}/video.mp4`;
    d.store.importFile(final, `${v}/${file}`, { by: 'render' });
    rec.file = file;
    rec.duration_ms = await probeDurationMs(final);
    // đầu ra phát hành phải đăng được lên mọi nền tảng đích của kênh (giới hạn chính thức, publish/limits.ts);
    // thời lượng theo nền tảng kiểm sớm ở gate `max_duration` và lúc chọn nền tảng đăng (không chặn render)
    if (input.mode === 'release') {
      const platforms = (resolveConfig(
        'publish.platforms',
        { channelDir: d.store.root, videoId },
        { appDataDir: d.appDataDir },
      ).value ?? []) as string[];
      const media = await probeMedia(final);
      const bad = platforms
        .filter((p): p is PlatformId => ['youtube', 'facebook', 'tiktok'].includes(p))
        .map((p) => [p, publishProblems(p, media, { ignoreDuration: true })] as const)
        .filter(([, x]) => x.length);
      if (bad.length)
        throw new SfError(
          'E_GATE_FAILED',
          `publish_ready: ${bad.map(([p, x]) => `${p}: ${x.join('; ')}`).join(' · ')}`,
        );
    }
    if (input.mode === 'release') {
      const credits = creditsFor(d, videoId);
      if (credits) d.store.write(`${v}/renders/${rd}/CREDITS.txt`, credits, { by: 'render' });
      const pub = d.store.abs(`${v}/publish.md`);
      const desc = existsSync(pub)
        ? parseBlocksDoc(readFileSync(pub, 'utf8')).body.join('\n').trim()
        : '';
      if (desc || credits)
        d.store.write(
          `${v}/renders/${rd}/description.txt`,
          `${[desc, credits.trim()].filter(Boolean).join('\n\n')}\n`,
          { by: 'render' },
        );
    }
    rec.status = 'done';
    rec.finished_at = new Date().toISOString();
    writeRecord(d.store, videoId, rec);
    progress(100, 'done');
    logger.write('info', 'sf.render', {
      video_id: videoId,
      render_id: rd,
      mode: input.mode,
      duration_ms: rec.duration_ms,
    });
    return rec;
  } catch (e) {
    rec.status = isSfError(e) && e.code === 'E_JOB_CANCELED' ? 'canceled' : 'failed';
    rec.finished_at = new Date().toISOString();
    writeRecord(d.store, videoId, rec);
    throw e;
  } finally {
    scratch.cleanup();
  }
}
