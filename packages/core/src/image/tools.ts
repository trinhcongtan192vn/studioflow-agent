import type { ProviderRegistry } from '../capability/registry.js';
import { resolveConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';
import type { ToolContext, ToolDefinition } from '../gateway/types.js';
import type { JobQueue } from '../jobs/queue.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';
import {
  assetRef,
  editImage,
  generateImage,
  pickSeed,
  removeBackground,
  type EditInput,
  type GenerateInput,
} from './service.js';

export interface ImageToolServices {
  queue: JobQueue;
  providers: ProviderRegistry;
  db?: Db;
  storeFor(dir: string): WriteStore;
}

const ASSET = { type: 'string', pattern: '^as_[0-9a-z]{8}$' };
const SEED = { type: 'integer', minimum: 0, maximum: 2147483647 };

/** Loại job ảnh: engine `comfyui` (gpu-heavy, độc chiếm GPU — D4 mục 6); tách nền chạy CPU. */
export function defineImageJobs(s: ImageToolServices, appDataDir?: string): void {
  const opts = (
    job: { video_id?: string; id: string },
    ctx: { signal: AbortSignal; progress: (d: number, t: number, m?: string) => void },
  ) => ({
    ...(job.video_id ? { videoId: job.video_id } : {}),
    appDataDir,
    signal: ctx.signal,
    progress: ctx.progress,
    jobId: job.id,
  });
  s.queue.define('image.generate', {
    needsDisk: true,
    engine: 'comfyui',
    idempotent: true,
    run: (job, ctx) =>
      generateImage(s, s.storeFor(job.channel_dir!), job.payload as GenerateInput, opts(job, ctx)),
  });
  s.queue.define('image.edit', {
    needsDisk: true,
    engine: 'comfyui',
    idempotent: true,
    run: (job, ctx) =>
      editImage(s, s.storeFor(job.channel_dir!), job.payload as EditInput, opts(job, ctx)),
  });
  s.queue.define('image.remove_bg', {
    needsDisk: true,
    idempotent: true,
    run: (job, ctx) =>
      removeBackground(
        s,
        s.storeFor(job.channel_dir!),
        job.payload as { source_asset_id: string; subject: 'person' | 'object' },
        opts(job, ctx),
      ),
  });
}

/** Provider có phí (`cost.kind` ≠ free) → hỏi người dùng trước (D5 mục 5.1). */
async function askIfPaid(
  s: ImageToolServices,
  ctx: ToolContext,
  capability: string,
  summary: string,
): Promise<void> {
  const id = resolveConfig<string | null>(
    `provider.${capability}`,
    { channelDir: ctx.store.root, videoId: ctx.session.video_id },
    { appDataDir: ctx.appDataDir },
  ).value;
  const m = id ? s.providers.get(id)?.manifest : undefined;
  if (!m || m.cost.kind === 'free') return;
  const usd = Number(
    resolveConfig(
      'policy.paid_api.per_call_usd',
      { channelDir: ctx.store.root, videoId: ctx.session.video_id },
      { appDataDir: ctx.appDataDir },
    ).value,
  );
  const ok = await ctx.permissions.ask(ctx.session, {
    tool: capability,
    kind: 'paid_api',
    summary: `${summary} qua ${m.id} (có phí, ước ≤ $${usd}/ảnh)`,
    estimate: { provider: m.id, images: 1, usd },
  });
  if (!ok)
    throw new SfError(
      'E_PERMISSION_DECLINED',
      `${capability} via ${m.id} is a paid call; the user declined`,
    );
}

function enqueue(
  s: ImageToolServices,
  ctx: ToolContext,
  kind: string,
  payload: unknown,
): { job_id: string } {
  const job = s.queue.enqueue(kind, {
    channel_dir: ctx.store.root,
    ...(ctx.session.video_id ? { video_id: ctx.session.video_id } : {}),
    payload,
  });
  return { job_id: job.id };
}

/** Tool `image.generate`, `image.edit`, `image.remove_bg` (D4 mục 2.4). */
export function imageTools(s: ImageToolServices): ToolDefinition[] {
  return [
    {
      name: 'image.generate',
      description:
        'Sinh ảnh từ prompt (theo look kênh) → job → {asset_id, file, public?}. width/height làm tròn bội 32 (16:9 nên dùng 1664×928 hoặc 1344×768); transparent cho vật thể nền trong suốt; seed để tái lập.',
      returnsJob: true,
      input: {
        type: 'object',
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 4000 },
          negative_prompt: { type: 'string', maxLength: 1000 },
          width: { type: 'integer', minimum: 16, maximum: 4096 },
          height: { type: 'integer', minimum: 16, maximum: 4096 },
          transparent: { type: 'boolean' },
          reference_asset_ids: { type: 'array', items: ASSET, maxItems: 10 },
          look: { type: 'string' },
          seed: SEED,
          steps: { type: 'integer', minimum: 1, maximum: 100 },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['prompt', 'width', 'height'],
        additionalProperties: false,
      },
      async handler(input: GenerateInput, ctx) {
        for (const id of input.reference_asset_ids ?? []) assetRef(ctx.store, id);
        await askIfPaid(s, ctx, 'image.generate', `Sinh ảnh ${input.width}×${input.height}`);
        return enqueue(s, ctx, 'image.generate', { ...input, seed: pickSeed(input.seed) });
      },
    },
    {
      name: 'image.edit',
      description:
        'Sửa ảnh theo chỉ dẫn (giữ bố cục); mask_asset_id đánh dấu vùng sửa; reference_asset_ids ảnh tham chiếu → job → asset mới (ảnh nguồn giữ nguyên).',
      returnsJob: true,
      input: {
        type: 'object',
        properties: {
          source_asset_id: ASSET,
          instruction: { type: 'string', minLength: 1, maxLength: 4000 },
          mask_asset_id: ASSET,
          reference_asset_ids: { type: 'array', items: ASSET, maxItems: 9 },
          seed: SEED,
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['source_asset_id', 'instruction'],
        additionalProperties: false,
      },
      async handler(input: EditInput, ctx) {
        for (const id of [
          input.source_asset_id,
          input.mask_asset_id,
          ...(input.reference_asset_ids ?? []),
        ])
          if (id) assetRef(ctx.store, id);
        await askIfPaid(s, ctx, 'image.edit', `Sửa ảnh ${input.source_asset_id}`);
        return enqueue(s, ctx, 'image.edit', { ...input, seed: pickSeed(input.seed) });
      },
    },
    {
      name: 'image.remove_bg',
      description: 'Tách nền ảnh → job → asset PNG trong suốt mới.',
      returnsJob: true,
      input: {
        type: 'object',
        properties: { source_asset_id: ASSET, subject: { enum: ['person', 'object'] } },
        required: ['source_asset_id', 'subject'],
        additionalProperties: false,
      },
      async handler(input: { source_asset_id: string; subject: 'person' | 'object' }, ctx) {
        assetRef(ctx.store, input.source_asset_id);
        return enqueue(s, ctx, 'image.remove_bg', input);
      },
    },
  ];
}
