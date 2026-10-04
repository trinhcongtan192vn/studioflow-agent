import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { VideoState } from '../contracts/types.js';
import { parseStoryboard, serializeStoryboard } from '../domain/markdown/storyboard.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { SfError } from '../errors.js';
import type { ToolDefinition } from '../gateway/types.js';
import { loadVideoModel } from '../graph/model.js';
import { runHf } from '../hf/cli.js';
import { assetRef } from '../image/service.js';
import type { JobQueue } from '../jobs/queue.js';
import { createScratchDir } from '../store/scratch.js';
import type { WriteStore } from '../store/writer.js';
import { finishReport } from './check.js';
import {
  effectCatalog,
  frameFinish,
  normalizeGrading,
  parseEffect,
  type MediaEffect,
} from './grading.js';
import { stylePack } from './styles.js';

export interface FinishToolServices {
  queue: JobQueue;
  storeFor(dir: string): WriteStore;
}

const ASSET = { type: 'string', pattern: '^as_[0-9a-z]{8}$' };

interface GradeCompareInput {
  asset_ids: string[];
  looks: string[];
}
interface TreatmentInput {
  asset_id: string;
  effect: string;
  mode: 'dry_run' | 'apply';
}

/**
 * `grade.compare` (D4 2.4): mỗi ảnh một bảng so sánh các look (HyperFrames `grade-compare`) →
 * `.sf/preview/grade-compare-<as>-<hash>.png`.
 */
async function gradeCompare(
  store: WriteStore,
  videoId: string | undefined,
  input: GradeCompareInput,
  appDataDir: string | undefined,
  signal: AbortSignal,
): Promise<{ contact_sheet: string; contact_sheets: string[] }> {
  const grades: { label: string; grading: Record<string, unknown> }[] = [];
  for (const id of input.looks) {
    const p = stylePack(id, appDataDir);
    if (!p) throw new SfError('E_ID_UNKNOWN', `look ${id} has no style pack`);
    if (p.grading) grades.push({ label: id, grading: await normalizeGrading(p.grading) });
    for (const [v, g] of Object.entries(p.variants ?? {}))
      if (input.looks.includes(`${id}/${v}`))
        grades.push({ label: `${id}/${v}`, grading: await normalizeGrading(g) });
  }
  if (!grades.length)
    throw new SfError('E_SCHEMA_INVALID', 'no look with a color grade to compare');
  const base = videoId ? `videos/${videoId}/.sf/preview` : '.sf/preview';
  const sheets: string[] = [];
  for (const id of input.asset_ids) {
    const ref = assetRef(store, id);
    const s = createScratchDir('sf-grade-compare-');
    try {
      const out = path.join(s.dir, 'sheet.png');
      const r = await runHf(
        [
          'grade-compare',
          `--for=${store.abs(ref.path)}`,
          `--grades=${JSON.stringify(grades)}`,
          `--out=${out}`,
          '--json',
        ],
        { cwd: s.dir, signal, timeoutMs: 180_000 },
      );
      if (!existsSync(out))
        throw new SfError(
          'E_PROVIDER_FAILED',
          `hyperframes grade-compare: ${(r.stderr || r.stdout).slice(-300)}`,
        );
      const rel = `${base}/grade-compare-${id}-${sha256(canonicalJson(grades)).slice(0, 10)}.png`;
      store.importFile(out, rel, { by: 'grade.compare' });
      sheets.push(rel);
    } finally {
      s.cleanup();
    }
  }
  return { contact_sheet: sheets[0]!, contact_sheets: sheets };
}

/**
 * `media.treatment` (D4 2.4, FN-common 6): hiệu ứng cho các frame có layer dùng asset. `dry_run` kiểm
 * bằng `media-treatment --dry-run` + ngân sách hiệu ứng nặng; `apply` (sau dry-run qua) thêm vào
 * `sf-frame.effects` trong `STORYBOARD.md` — engine áp khi dựng frame.
 */
async function mediaTreatment(
  store: WriteStore,
  videoId: string,
  input: TreatmentInput,
  appDataDir: string | undefined,
) {
  const cat: Map<string, MediaEffect> = await effectCatalog();
  const { key } = parseEffect(input.effect);
  const known = cat.get(key) ?? (key === 'vignette' || key === 'grain' ? { key } : undefined);
  if (!known)
    throw new SfError(
      'E_SCHEMA_INVALID',
      `unknown media effect ${input.effect}; see the effects list of the effects step`,
    );
  const heavy = (known as MediaEffect).renderLane === 'multipass';
  const model = loadVideoModel(store.root, videoId, appDataDir);
  // layer dùng asset: `asset_id` trong storyboard hoặc ảnh do nút `asset:<el>` sinh (graph, 020)
  let records: Record<string, { meta?: { asset_id?: string } }> = {};
  try {
    records =
      (
        JSON.parse(readFileSync(store.abs(`videos/${videoId}/.sf/graph.json`), 'utf8')) as {
          nodes?: typeof records;
        }
      ).nodes ?? {};
  } catch {
    /* chưa build */
  }
  const frames = model.frames.filter((f) =>
    f.layers.some(
      (l) =>
        l.asset_id === input.asset_id ||
        records[`asset:${l.id}`]?.meta?.asset_id === input.asset_id,
    ),
  );
  if (!frames.length) throw new SfError('E_ID_UNKNOWN', `no frame uses asset ${input.asset_id}`);
  const normalized: Record<string, Record<string, unknown>> = {};
  const adds = frames.filter((f) => !(f.effects ?? []).includes(input.effect));
  for (const f of frames) {
    const fin = frameFinish(
      model,
      { ...f, effects: [...new Set([...(f.effects ?? []), input.effect])] },
      cat,
      appDataDir,
    );
    normalized[f.id] = await normalizeGrading(fin.fxPatch!);
  }
  const rep = await finishReport(store, videoId, appDataDir);
  const heavyAfter = rep.heavy_total + (heavy ? adds.length : 0);
  const report = {
    effect: input.effect,
    heavy,
    frames: frames.map((f) => f.id),
    heavy_total: heavyAfter,
    heavy_allowed: rep.heavy_allowed,
    within_budget: heavyAfter <= rep.heavy_allowed,
    grading: normalized,
  };
  if (input.mode === 'dry_run') return { mode: 'dry_run', applied: [], ...report };
  if (!report.within_budget)
    throw new SfError(
      'E_GATE_FAILED',
      `${heavyAfter} heavy effects would exceed the budget of ${rep.heavy_allowed} for this video`,
    );
  const v = `videos/${videoId}`;
  const st = JSON.parse(readFileSync(store.abs(`${v}/state.json`), 'utf8')) as VideoState;
  if (st.owner === 'studio')
    throw new SfError('E_OWNER_CONFLICT', 'Studio is editing this video; commit or close it first');
  const sbRel = `${v}/STORYBOARD.md`;
  const p = parseStoryboard(readFileSync(store.abs(sbRel), 'utf8'));
  for (const f of adds) {
    const blk = p.blocks.find(
      (b) => b.tag === 'sf-frame' && (b.data as { id?: string }).id === f.id,
    );
    if (blk) (blk.data as { effects?: string[] }).effects = [...(f.effects ?? []), input.effect];
  }
  if (adds.length) store.write(sbRel, serializeStoryboard(p), { by: 'media.treatment' });
  return { mode: 'apply', applied: adds.map((f) => f.id), ...report };
}

export function defineFinishJobs(s: FinishToolServices, appDataDir?: string): void {
  s.queue.define('grade.compare', {
    needsDisk: true,
    idempotent: true,
    run: (job, ctx) =>
      gradeCompare(
        s.storeFor(job.channel_dir!),
        job.video_id,
        job.payload as GradeCompareInput,
        appDataDir,
        ctx.signal,
      ),
  });
  s.queue.define('media.treatment', {
    // apply ghi STORYBOARD.md: chạy lại cho cùng kết quả (thêm hiệu ứng khi chưa có)
    idempotent: true,
    run: (job) =>
      mediaTreatment(
        s.storeFor(job.channel_dir!),
        job.video_id!,
        job.payload as TreatmentInput,
        appDataDir,
      ),
  });
}

/** Tool `grade.compare`, `media.treatment` (D4 mục 2.4, 027). */
export function finishTools(s: FinishToolServices): ToolDefinition[] {
  const enqueue = (
    kind: string,
    payload: unknown,
    ctx: Parameters<ToolDefinition['handler']>[1],
  ) => {
    const job = s.queue.enqueue(kind, {
      channel_dir: ctx.store.root,
      ...(ctx.session.video_id ? { video_id: ctx.session.video_id } : {}),
      payload,
    });
    return { job_id: job.id };
  };
  return [
    {
      name: 'grade.compare',
      description:
        'So sánh các look (gói phong cách, hoặc `<gói>/<biến thể>`) trên ảnh thư viện → job → {contact_sheet} (PNG trong .sf/preview/).',
      returnsJob: true,
      input: {
        type: 'object',
        properties: {
          asset_ids: { type: 'array', items: ASSET, minItems: 1, maxItems: 4 },
          looks: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
        },
        required: ['asset_ids', 'looks'],
        additionalProperties: false,
      },
      async handler(input: GradeCompareInput, ctx) {
        return enqueue('grade.compare', input, ctx);
      },
    },
    {
      name: 'media.treatment',
      description:
        'Hiệu ứng media cho các frame dùng một ảnh: mode dry_run kiểm (HyperFrames media-treatment --dry-run, ngân sách hiệu ứng nặng); apply thêm vào sf-frame.effects. effect = khóa hiệu ứng, có thể kèm mức `bloom:0.4`.',
      returnsJob: true,
      input: {
        type: 'object',
        properties: {
          asset_id: ASSET,
          effect: { type: 'string', minLength: 1, maxLength: 64 },
          mode: { enum: ['dry_run', 'apply'] },
        },
        required: ['asset_id', 'effect', 'mode'],
        additionalProperties: false,
      },
      async handler(input: TreatmentInput, ctx) {
        if (!ctx.session.video_id)
          throw new SfError('E_CONFIG_SCOPE', 'media.treatment needs a video in this session');
        // apply sửa STORYBOARD.md; đã duyệt → hỏi người dùng như artifact.write (D5 5.1)
        const sb = `videos/${ctx.session.video_id}/STORYBOARD.md`;
        if (input.mode === 'apply' && ctx.store.protectedReason(sb)) {
          const ok = await ctx.permissions.ask(ctx.session, {
            tool: 'media.treatment',
            kind: 'overwrite_approved',
            summary: `Thêm hiệu ứng ${input.effect} vào STORYBOARD.md đã được duyệt`,
          });
          if (!ok)
            throw new SfError('E_PERMISSION_DECLINED', 'user declined changing STORYBOARD.md');
        }
        return enqueue('media.treatment', input, ctx);
      },
    },
  ];
}
