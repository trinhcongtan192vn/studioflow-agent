import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AudioMeta, RenderRecord } from '../contracts/types.js';
import { decodeWav, encodePcm16 } from '../captions/voice.js';
import { sha256 } from '../domain/hash.js';
import { SfError } from '../errors.js';
import { BuildGraph, type BuilderRegistry } from '../graph/graph.js';
import { loadOutputProfile } from '../hf/outputs.js';
import { loadVideoModel } from '../graph/model.js';
import { ffmpegPath } from '../models/install.js';
import { createScratchDir, writeOutsideProject } from '../store/scratch.js';
import type { WriteStore } from '../store/writer.js';
import type { StepRunContext } from '../workflow/engine.js';
import { timingOf } from '../workflow/duration.js';
import { newRenderId, writeRecord } from './render.js';

const SR = 48000;

/** Ảnh tĩnh của frame: ảnh của layer đầu tiên có asset (thư viện hoặc nút `asset:<el>`), không có → thẻ màu. */
function frameStill(
  store: WriteStore,
  videoId: string,
  layers: { id: string; asset_id?: string }[],
) {
  const v = `videos/${videoId}`;
  let records: Record<string, { meta?: { asset_id?: string } }> = {};
  try {
    records =
      (
        JSON.parse(readFileSync(store.abs(`${v}/.sf/graph.json`), 'utf8')) as {
          nodes?: typeof records;
        }
      ).nodes ?? {};
  } catch {
    /* chưa build */
  }
  const pub = store.abs(`${v}/public`);
  const files = existsSync(pub) ? readdirSync(pub) : [];
  for (const l of layers) {
    const id = l.asset_id ?? records[`asset:${l.id}`]?.meta?.asset_id;
    const f = id && files.find((x) => x.startsWith(`${id}.`) && /\.(png|jpe?g|webp)$/i.test(x));
    if (f) return path.join(pub, f);
  }
  return undefined;
}

function ffmpeg(
  appDataDir: string | undefined,
  args: string[],
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(appDataDir ?? ''), ['-hide_banner', '-loglevel', 'error', ...args], {
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new SfError('E_PROVIDER_FAILED', `ffmpeg animatic: ${err.slice(-400)}`)),
    );
  });
}

/**
 * Executor bước `animatic` (D6 mục 2, 031): khung tĩnh theo frame (ảnh của frame hoặc thẻ màu) đặt theo
 * `frame_timing`, lời đọc trộn theo mốc tuyệt đối của line → `renders/<rd>/video.mp4`, `mode: animatic`.
 */
export function animaticExecutor(builders: BuilderRegistry) {
  return async (ctx: StepRunContext): Promise<{ outputs: string[]; summary: string }> => {
    const v = `videos/${ctx.videoId}`;
    const graph = new BuildGraph({ store: ctx.store, appDataDir: ctx.appDataDir, builders });
    const b = await graph.build(ctx.videoId, {
      targets: ['frame_timing'],
      signal: ctx.signal,
      ...(ctx.progress ? { progress: ctx.progress } : {}),
    });
    if (b.status !== 'succeeded')
      throw new SfError('E_STEP_INCOMPLETE', 'animatic needs voice audio and frame timing first');
    const timing = timingOf(ctx.store, ctx.videoId);
    if (!timing?.frames.length) throw new SfError('E_STEP_INCOMPLETE', 'no frame timing');
    const meta = JSON.parse(
      readFileSync(ctx.store.abs(`${v}/audio_meta.json`), 'utf8'),
    ) as AudioMeta;
    const model = loadVideoModel(ctx.store.root, ctx.videoId, ctx.appDataDir);
    const st = JSON.parse(readFileSync(ctx.store.abs(`${v}/state.json`), 'utf8')) as {
      output_profile: string | null;
    };
    const profile = loadOutputProfile(st.output_profile);
    const rd = newRenderId(ctx.store, ctx.videoId);
    const started = new Date().toISOString();
    const rec: RenderRecord = {
      schema_version: 1,
      id: rd as RenderRecord['id'],
      mode: 'animatic',
      output_profile: profile.id,
      started_at: started,
      status: 'running',
      gate_results: [],
      index_hash: sha256(JSON.stringify(timing)),
    } as RenderRecord;
    writeRecord(ctx.store, ctx.videoId, rec);
    const s = createScratchDir('sf-animatic-');
    try {
      // lời đọc theo timeline
      const mix = new Float32Array(Math.ceil((timing.total_ms * SR) / 1000));
      for (const l of timing.lines) {
        const m = meta.lines.find((x) => x.line_id === l.id);
        const f = m && ctx.store.abs(`${v}/${m.file}`);
        if (!f || !existsSync(f)) continue;
        const d = decodeWav(readFileSync(f));
        const ratio = d.sampleRate / SR;
        const at = Math.round((l.start_ms * SR) / 1000);
        const n = Math.min(Math.floor(d.samples.length / ratio), mix.length - at);
        for (let i = 0; i < n; i++) mix[at + i]! += d.samples[Math.floor(i * ratio)]!;
      }
      writeOutsideProject(path.join(s.dir, 'voice.wav'), encodePcm16(mix, SR));
      const W = profile.width;
      const H = profile.height;
      const inputs: string[] = [];
      const filters: string[] = [];
      timing.frames.forEach((f, i) => {
        const fr = model.frames.find((x) => x.id === f.id);
        const still = frameStill(ctx.store, ctx.videoId, fr?.layers ?? []);
        const dur = (Math.max(40, f.duration_ms) / 1000).toFixed(3);
        if (still) inputs.push('-loop', '1', '-t', dur, '-i', still);
        else
          inputs.push(
            '-f',
            'lavfi',
            '-t',
            dur,
            '-i',
            `color=c=0x1b1f24:s=${W}x${H}:r=${profile.fps}`,
          );
        filters.push(
          `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x1b1f24,setsar=1,fps=${profile.fps},format=yuv420p[v${i}]`,
        );
      });
      const n = timing.frames.length;
      filters.push(`${timing.frames.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[vout]`);
      const out = path.join(s.dir, 'video.mp4');
      await ffmpeg(
        ctx.appDataDir,
        [
          '-y',
          ...inputs,
          '-i',
          path.join(s.dir, 'voice.wav'),
          '-filter_complex',
          filters.join(';'),
          '-map',
          '[vout]',
          '-map',
          `${n}:a`,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '28',
          '-c:a',
          'aac',
          '-shortest',
          out,
        ],
        ctx.signal,
      );
      const file = `renders/${rd}/video.mp4`;
      ctx.store.importFile(out, `${v}/${file}`, { by: 'animatic' });
      writeRecord(ctx.store, ctx.videoId, {
        ...rec,
        status: 'done',
        finished_at: new Date().toISOString(),
        file: file as RenderRecord['file'],
        duration_ms: timing.total_ms,
      });
      return {
        outputs: [file, `renders/${rd}/render.json`],
        summary: `Animatic: ${n} khung, ${Math.round(timing.total_ms / 1000)} s — ${file}`,
      };
    } catch (e) {
      writeRecord(ctx.store, ctx.videoId, {
        ...rec,
        status: 'failed',
        finished_at: new Date().toISOString(),
      });
      throw e;
    } finally {
      s.cleanup();
    }
  };
}
