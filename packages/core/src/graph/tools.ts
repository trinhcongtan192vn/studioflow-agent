import { resolveConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';
import type { ToolContext, ToolDefinition } from '../gateway/types.js';
import type { JobQueue } from '../jobs/queue.js';
import { BuildGraph, type BuilderRegistry } from './graph.js';

export interface GraphServices {
  queue: JobQueue;
  builders: BuilderRegistry;
}

function videoOf(ctx: ToolContext): string {
  if (!ctx.session.video_id)
    throw new SfError('E_SCOPE_DENIED', 'no video selected in this session');
  return ctx.session.video_id;
}

export function graphTools(s: GraphServices): ToolDefinition[] {
  const graphFor = (ctx: ToolContext) =>
    new BuildGraph({ store: ctx.store, appDataDir: ctx.appDataDir, builders: s.builders });
  return [
    {
      name: 'graph.status',
      description: 'Trạng thái các nút build graph của video (fresh/stale/missing/failed…).',
      input: {
        type: 'object',
        properties: { scope: { type: 'string' } },
        additionalProperties: false,
      },
      async handler(input: { scope?: string }, ctx) {
        const nodes = graphFor(ctx).status(videoOf(ctx));
        return {
          nodes: input.scope
            ? nodes.filter(
                (n) =>
                  n.id === input.scope ||
                  n.id.startsWith(`${input.scope}:`) ||
                  n.type === input.scope,
              )
            : nodes,
        };
      },
    },
    {
      name: 'graph.plan',
      description: 'Kế hoạch job theo pha để làm mới các nút (không chạy), kèm ước tính.',
      input: {
        type: 'object',
        properties: { targets: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
      async handler(input: { targets?: string[] }, ctx) {
        return graphFor(ctx).plan(videoOf(ctx), input.targets);
      },
    },
    {
      name: 'graph.build',
      description:
        'Chạy kế hoạch build graph dưới dạng job; sinh hàng loạt vượt ngưỡng sẽ hỏi người dùng.',
      returnsJob: true,
      input: {
        type: 'object',
        properties: { targets: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
      handler: (input: { targets?: string[] }, ctx) =>
        startGraphBuild(s, ctx, input.targets, 'graph.build'),
    },
  ];
}

/** Đăng ký loại job `graph.build` vào hàng đợi. */
export function defineGraphJob(
  queue: JobQueue,
  builders: BuilderRegistry,
  storeFor: (dir: string) => import('../store/writer.js').WriteStore,
): void {
  queue.define('graph.build', {
    idempotent: true,
    async run(job, ctx) {
      const p = job.payload as { targets: string[] | null; appDataDir: string | null };
      const graph = new BuildGraph({
        store: storeFor(job.channel_dir!),
        appDataDir: p.appDataDir ?? undefined,
        builders,
      });
      const r = await graph.build(job.video_id!, {
        targets: p.targets ?? undefined,
        signal: ctx.signal,
        progress: ctx.progress,
      });
      if (r.status !== 'succeeded') ctx.outcome(r.status);
      return r;
    },
  });
}

/**
 * Lập kế hoạch, hỏi người dùng nếu số line audio vượt `policy.batch.tts_lines` (D5 mục 5.1),
 * rồi xếp job `graph.build`. Dùng chung cho `graph.build` và `tts.synthesize`.
 */
export async function startGraphBuild(
  s: GraphServices,
  ctx: ToolContext,
  targets: string[] | undefined,
  tool: string,
): Promise<{ job_id: string; plan: ReturnType<BuildGraph['plan']> }> {
  const videoId = videoOf(ctx);
  const plan = new BuildGraph({
    store: ctx.store,
    appDataDir: ctx.appDataDir,
    builders: s.builders,
  }).plan(videoId, targets);
  const lines = plan.jobs.filter((j) => j.type === 'audio.line').length;
  const limit = Number(
    resolveConfig(
      'policy.batch.tts_lines',
      { channelDir: ctx.store.root, videoId },
      { appDataDir: ctx.appDataDir },
    ).value,
  );
  if (lines > limit) {
    const ok = await ctx.permissions.ask(ctx.session, {
      tool,
      kind: 'batch_gen',
      summary: `Sinh ${lines} line audio (ngưỡng ${limit})`,
      estimate: plan.estimate,
    });
    if (!ok) throw new SfError('E_PERMISSION_DECLINED', `user declined generating ${lines} lines`);
  }
  const job = s.queue.enqueue('graph.build', {
    video_id: videoId,
    channel_dir: ctx.store.root,
    payload: { targets: targets ?? null, appDataDir: ctx.appDataDir ?? null },
  });
  return { job_id: job.id, plan };
}
