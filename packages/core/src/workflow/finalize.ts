import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfig } from '../config/resolve.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { SfError } from '../errors.js';
import { BuildGraph, type BuilderRegistry } from '../graph/graph.js';
import type { FrameTiming } from '../graph/timing.js';
import { hfCheck, runHf } from '../hf/cli.js';
import { renderVideo } from '../render/render.js';
import { createScratchDir } from '../store/scratch.js';
import type { WriteStore } from '../store/writer.js';
import type { StepRunContext } from './engine.js';
import { registerObjective } from './gates.js';

function failedNodes(r: {
  nodes: Record<string, { status: string; error?: { message: string } }>;
}): string {
  return Object.entries(r.nodes)
    .filter(([, n]) => n.status === 'failed')
    .map(([id, n]) => `${id}: ${n.error?.message}`)
    .join('; ');
}

/** Executor bước `captions` (D6 mục 2): nút `captions` → `caption_groups.json`. */
export function captionsExecutor(builders: BuilderRegistry) {
  return async (ctx: StepRunContext): Promise<{ outputs: string[] }> => {
    const r = await new BuildGraph({
      store: ctx.store,
      appDataDir: ctx.appDataDir,
      builders,
    }).build(ctx.videoId, { targets: ['captions'], signal: ctx.signal });
    if (r.status !== 'succeeded')
      throw new SfError('E_PROVIDER_FAILED', `captions: ${failedNodes(r) || r.status}`);
    return { outputs: ['caption_groups.json'] };
  };
}

function timingOf(store: WriteStore, videoId: string): FrameTiming | undefined {
  const f = store.abs(`videos/${videoId}/.sf/graph.json`);
  if (!existsSync(f)) return undefined;
  return (JSON.parse(readFileSync(f, 'utf8')) as { nodes: Record<string, { meta?: unknown }> })
    .nodes['frame_timing']?.meta as FrameTiming | undefined;
}

/** Thời lượng so với `BRIEF.md.target_duration_ms` trong `check.duration_tolerance` (gate `finalize`, D6 mục 2). */
export function durationCheck(
  store: WriteStore,
  videoId: string,
  appDataDir?: string,
): { pass: boolean; detail?: string } {
  const brief = parseBlocksDoc(readFileSync(store.abs(`videos/${videoId}/BRIEF.md`), 'utf8'))
    .front as { target_duration_ms?: number | null };
  const timing = timingOf(store, videoId);
  if (!brief.target_duration_ms || !timing)
    return { pass: true, ...(timing ? {} : { detail: 'no timing yet' }) };
  const tol = Number(
    resolveConfig('check.duration_tolerance', { channelDir: store.root, videoId }, { appDataDir })
      .value,
  );
  const diff = Math.abs(timing.total_ms - brief.target_duration_ms) / brief.target_duration_ms;
  return diff <= tol
    ? { pass: true }
    : {
        pass: false,
        detail: `${Math.round(timing.total_ms / 1000)} s vs target ${Math.round(brief.target_duration_ms / 1000)} s (±${Math.round(tol * 100)}%)`,
      };
}

registerObjective('duration', (g) => durationCheck(g.store, g.videoId, g.appDataDir));

/**
 * Executor bước `finalize` (D6 mục 2, FN-016): build toàn bộ graph (index), `hyperframes check`,
 * contact sheet `.sf/snapshots/`, render nháp để duyệt; tóm tắt cho thẻ duyệt.
 */
export function finalizeExecutor(builders: BuilderRegistry) {
  return async (ctx: StepRunContext): Promise<{ outputs: string[]; summary: string }> => {
    const v = `videos/${ctx.videoId}`;
    const graph = new BuildGraph({ store: ctx.store, appDataDir: ctx.appDataDir, builders });
    const r = await graph.build(ctx.videoId, { signal: ctx.signal });
    if (r.status !== 'succeeded')
      throw new SfError('E_GATE_FAILED', `build: ${failedNodes(r) || r.status}`);
    const videoDir = ctx.store.abs(v);
    const frames = existsSync(path.join(videoDir, 'compositions', 'frames'))
      ? readdirSync(path.join(videoDir, 'compositions', 'frames')).map((f) =>
          path.join(videoDir, 'compositions', 'frames', f),
        )
      : [];
    const check = await hfCheck(videoDir, { watch: frames, signal: ctx.signal });
    if (!check.ok)
      throw new SfError(
        'E_GATE_FAILED',
        `hyperframes check: ${check.errors
          .slice(0, 5)
          .map((e) => `${e.code}: ${e.message}`)
          .join('; ')}`,
      );
    // contact sheet tại điểm giữa mỗi frame
    const timing = timingOf(ctx.store, ctx.videoId);
    const mids = (timing?.frames ?? []).map((f) =>
      ((f.start_ms + f.duration_ms / 2) / 1000).toFixed(2),
    );
    const scratch = createScratchDir('sf-snap-');
    const outputs: string[] = ['index.html'];
    try {
      await runHf(
        [
          'snapshot',
          '.',
          '-o',
          scratch.dir,
          '--describe',
          'false',
          ...(mids.length ? ['--at', mids.join(',')] : []),
        ],
        {
          cwd: videoDir,
          watch: frames,
          timeoutMs: 600_000,
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        },
      );
      for (const f of readdirSync(scratch.dir).filter((x) => /\.(jpe?g|png)$/i.test(x))) {
        ctx.store.importFile(path.join(scratch.dir, f), `${v}/.sf/snapshots/${f}`, {
          by: 'finalize',
        });
        if (/contact/i.test(f)) outputs.push(`.sf/snapshots/${f}`);
      }
    } finally {
      scratch.cleanup();
    }
    const draft = await renderVideo(
      { store: ctx.store, builders, appDataDir: ctx.appDataDir },
      ctx.videoId,
      { mode: 'draft', step_id: ctx.step.id },
      { ...(ctx.signal ? { signal: ctx.signal } : {}) },
    );
    const dur = durationCheck(ctx.store, ctx.videoId, ctx.appDataDir);
    const warn = draft.gate_results
      .filter((g) => !g.pass && g.gate !== 'approvals')
      .map((g) => g.gate);
    return {
      outputs: [...outputs, draft.file!],
      summary: [
        `Bản nháp: ${draft.file} (${Math.round((draft.duration_ms ?? 0) / 1000)} s).`,
        outputs.length > 1 ? `Contact sheet: ${outputs.slice(1).join(', ')}.` : '',
        `hyperframes check: 0 lỗi.`,
        dur.pass ? '' : `Thời lượng lệch mục tiêu: ${dur.detail}.`,
        warn.length ? `Cảnh báo gate: ${warn.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    };
  };
}
