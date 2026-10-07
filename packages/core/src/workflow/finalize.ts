import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { SfError } from '../errors.js';
import { BuildGraph, type BuilderRegistry } from '../graph/graph.js';
import { checkTimeoutMs, hfCheck, runHf } from '../hf/cli.js';
import { fixVideoFrames } from '../hf/clip-fix.js';
import { renderVideo } from '../render/render.js';
import { createScratchDir } from '../store/scratch.js';
import type { StepRunContext } from './engine.js';
import { audioDurationCheck, timingOf } from './duration.js';

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
    }).build(ctx.videoId, {
      targets: ['captions'],
      signal: ctx.signal,
      ...(ctx.progress ? { progress: ctx.progress } : {}),
    });
    if (r.status !== 'succeeded')
      throw new SfError('E_PROVIDER_FAILED', `captions: ${failedNodes(r) || r.status}`);
    return { outputs: ['caption_groups.json'] };
  };
}

/**
 * Executor bước `finalize` (D6 mục 2, FN-016): build toàn bộ graph (index), `hyperframes check`,
 * contact sheet `.sf/snapshots/`, render nháp để duyệt; tóm tắt cho thẻ duyệt.
 */
export function finalizeExecutor(builders: BuilderRegistry) {
  return async (ctx: StepRunContext): Promise<{ outputs: string[]; summary: string }> => {
    const v = `videos/${ctx.videoId}`;
    const graph = new BuildGraph({ store: ctx.store, appDataDir: ctx.appDataDir, builders });
    const r = await graph.build(ctx.videoId, {
      signal: ctx.signal,
      ...(ctx.progress ? { progress: ctx.progress } : {}),
    });
    if (r.status !== 'succeeded')
      throw new SfError('E_GATE_FAILED', `build: ${failedNodes(r) || r.status}`);
    // 058: autoAlpha trên phần tử clip (frame cũ / sau hoàn thiện) → opacity, ghi nhận lại rồi lắp lại index
    const fixedFrames = fixVideoFrames(ctx.store, ctx.videoId);
    if (fixedFrames.length) {
      graph.markBuilt(
        ctx.videoId,
        fixedFrames.map((id) => `frame_html:${id}`),
        { contentOnly: true },
      );
      const again = await graph.build(ctx.videoId, {
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      if (again.status !== 'succeeded')
        throw new SfError('E_GATE_FAILED', `build: ${failedNodes(again) || again.status}`);
    }
    const videoDir = ctx.store.abs(v);
    const frames = existsSync(path.join(videoDir, 'compositions', 'frames'))
      ? readdirSync(path.join(videoDir, 'compositions', 'frames')).map((f) =>
          path.join(videoDir, 'compositions', 'frames', f),
        )
      : [];
    const check = await hfCheck(videoDir, {
      watch: frames,
      signal: ctx.signal,
      timeoutMs: checkTimeoutMs(frames.length),
    });
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
      {
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        ...(ctx.progress ? { progress: ctx.progress } : {}),
      },
    );
    const dur = audioDurationCheck(ctx.store, ctx.videoId, ctx.appDataDir, 'timeline');
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
