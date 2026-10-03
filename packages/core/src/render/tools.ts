import { SfError } from '../errors.js';
import type { ToolDefinition } from '../gateway/types.js';
import type { BuilderRegistry } from '../graph/graph.js';
import type { JobQueue } from '../jobs/queue.js';
import type { WriteStore } from '../store/writer.js';
import type { StepRunContext } from '../workflow/engine.js';
import { markInterrupted, newRenderId, renderVideo, type RenderJobInput } from './render.js';

export interface RenderServices {
  queue: JobQueue;
  builders: BuilderRegistry;
  storeFor(dir: string): WriteStore;
}

/** Job `render` (engine `render`): không idempotent → tắt app giữa chừng = `E_JOB_INTERRUPTED` (AC-M1-05). */
export function defineRenderJob(s: RenderServices, appDataDir?: string): void {
  s.queue.define('render', {
    engine: 'render',
    idempotent: false,
    run: async (job, ctx) =>
      renderVideo(
        { store: s.storeFor(job.channel_dir!), builders: s.builders, appDataDir },
        job.video_id!,
        job.payload as RenderJobInput,
        {
          signal: ctx.signal,
          progress: ctx.progress,
        },
      ),
    onInterrupted: (job) => {
      const p = job.payload as RenderJobInput;
      if (job.channel_dir && job.video_id && p.render_id)
        markInterrupted(s.storeFor(job.channel_dir), job.video_id, p.render_id);
    },
  });
}

export function renderTools(s: RenderServices): ToolDefinition[] {
  return [
    {
      name: 'render.video',
      description:
        'Render video hiện tại ra MP4 theo output profile: draft (dấu NHÁP, gate chỉ cảnh báo) hoặc release (mọi gate phải qua, kèm CREDITS/description). Trả job → RenderRecord.',
      returnsJob: true,
      input: {
        type: 'object',
        properties: { mode: { enum: ['draft', 'release'] }, output_profile: { type: 'string' } },
        required: ['mode'],
        additionalProperties: false,
      },
      async handler(i: { mode: 'draft' | 'release'; output_profile?: string }, ctx) {
        const v = ctx.session.video_id;
        if (!v) throw new SfError('E_SCHEMA_INVALID', 'render.video needs a video session');
        const render_id = newRenderId(ctx.store, v);
        const job = s.queue.enqueue('render', {
          channel_dir: ctx.store.root,
          video_id: v,
          payload: { ...i, render_id },
        });
        return { job_id: job.id, render_id };
      },
    },
  ];
}

/** Executor bước `render` (D6 mục 2): `params.mode` (mặc định draft). */
export function renderExecutor(builders: BuilderRegistry) {
  return async (ctx: StepRunContext): Promise<{ outputs: string[]; summary: string }> => {
    const mode = ctx.step.params?.mode === 'release' ? 'release' : 'draft';
    const r = await renderVideo(
      { store: ctx.store, builders, appDataDir: ctx.appDataDir },
      ctx.videoId,
      { mode, step_id: ctx.step.id },
      { signal: ctx.signal },
    );
    const warn = r.gate_results.filter((g) => !g.pass);
    return {
      outputs: [r.file!, `renders/${r.id}/render.json`],
      summary: `Render ${mode} ${r.id}: ${Math.round((r.duration_ms ?? 0) / 1000)} s${warn.length ? `; cảnh báo gate: ${warn.map((g) => g.gate).join(', ')}` : ''}.`,
    };
  };
}
