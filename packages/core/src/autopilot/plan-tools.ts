import { SfError } from '../errors.js';
import { OPS_CHANNEL_PROP, type ToolDefinition } from '../gateway/types.js';
import type { JobQueue } from '../jobs/queue.js';
import { researchDate } from '../research/scan.js';
import { resolveConfig } from '../config/resolve.js';
import type { WriteStore } from '../store/writer.js';
import type { FetchFn } from '../youtube/data-api.js';
import type { CapacityChannel, CapacityResult } from './capacity.js';
import { planToday, readPlan, updatePlanItem, type PlanPatch, type PlanWorkflow } from './plan.js';

export interface PlanDeps {
  queue: JobQueue;
  storeFor: (channelDir: string) => WriteStore;
  /** Mô hình năng lực (050) cho nhóm kênh. */
  capacity: (channels: CapacityChannel[]) => CapacityResult;
  /** Workflow đã cài (đọc lúc chạy). */
  installed: () => PlanWorkflow[];
  /** Khóa YouTube Data API cho lần quét nghiên cứu (đọc lúc chạy). */
  apiKey: () => string | undefined;
  fetch?: FetchFn;
  now?: () => Date;
  appDataDir?: string;
}

const JOB = 'autopilot.plan';

/** Job lập kế hoạch ngày (có thể quét nghiên cứu qua mạng → chạy nền, D4 2.3); một lần mỗi lúc. */
export function defineAutopilotPlanJob(d: PlanDeps): void {
  d.queue.define(JOB, {
    engine: 'autopilot',
    idempotent: true,
    run: async (job) => {
      const payload = (job.payload ?? {}) as { channels?: string[] };
      const channels = payload.channels ?? (job.channel_dir ? [job.channel_dir] : []);
      const r = await planToday({
        channels,
        storeFor: d.storeFor,
        capacity: d.capacity,
        installed: d.installed(),
        apiKey: d.apiKey(),
        ...(d.fetch ? { fetch: d.fetch } : {}),
        ...(d.now ? { now: d.now() } : {}),
        ...(d.appDataDir ? { appDataDir: d.appDataDir } : {}),
      });
      return {
        paused: r.paused,
        plans: r.plans.map((p) => ({
          channel: p.channel,
          path: p.path,
          date: p.plan.date,
          items: p.plan.items.length,
          added: p.added,
          kept: p.kept,
          carried: p.carried,
          notes: p.plan.notes ?? [],
        })),
      };
    },
  });
}

/** Ngày "hôm nay" của kênh theo `publish.timezone`. */
export function planDateOf(channelDir: string, now: Date, appDataDir?: string): string {
  const tz = resolveConfig<string>('publish.timezone', { channelDir }, { appDataDir }).value;
  return researchDate(now, tz);
}

/** Xếp job lập kế hoạch hôm nay cho các kênh; `date` (nếu có) phải là hôm nay — chỉ lập được kế hoạch hôm nay. */
export function enqueuePlanRun(
  d: Pick<PlanDeps, 'queue' | 'now' | 'appDataDir'>,
  channels: string[],
  date?: string,
): { job_id: string } {
  if (date) {
    const now = d.now?.() ?? new Date();
    for (const c of channels) {
      const today = planDateOf(c, now, d.appDataDir);
      if (date !== today)
        throw new SfError(
          'E_SCHEMA_INVALID',
          `date ${date}: only today's plan (${today}) can be generated`,
        );
    }
  }
  const job = d.queue.enqueue(JOB, { payload: { channels }, max_attempts: 1 });
  return { job_id: job.id };
}

const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

/** Tool `autopilot.plan_*` (D4 2.4, 051): xem, lập lại, sửa kế hoạch ngày của kênh đang mở. */
export function autopilotPlanTools(d: PlanDeps): ToolDefinition[] {
  return [
    {
      name: 'autopilot.plan_get',
      description:
        'Kế hoạch ngày Autopilot của kênh (chủ đề, góc nhìn, workflow, giờ đăng, lý do, trạng thái từng mục). date: YYYY-MM-DD; bỏ trống = hôm nay.',
      input: {
        type: 'object',
        properties: { date: DATE, ...OPS_CHANNEL_PROP },
        additionalProperties: false,
      },
      handler: async (i: { date?: string }, ctx) => {
        const date = i.date ?? planDateOf(ctx.store.root, d.now?.() ?? new Date(), d.appDataDir);
        const plan = readPlan(ctx.store.root, date);
        if (!plan)
          throw new SfError('E_FILE_NOT_FOUND', `no plan for ${date}; run autopilot.plan_run`);
        return plan;
      },
    },
    {
      name: 'autopilot.plan_run',
      description:
        'Lập (hoặc lập lại) kế hoạch hôm nay cho kênh: dùng kết quả quét nghiên cứu hôm nay (chưa có thì quét), chọn chủ đề + workflow + giờ đăng trong giới hạn năng lực. Giữ mọi mục đã có, chỉ lấp chỗ trống. Chạy nền → job; xong thì đọc bằng autopilot.plan_get.',
      input: { type: 'object', properties: {}, additionalProperties: false },
      returnsJob: true,
      handler: async (_i: Record<string, never>, ctx) => enqueuePlanRun(d, [ctx.store.root]),
    },
    {
      name: 'autopilot.plan_update',
      description:
        'Sửa một mục kế hoạch: patch.status (skipped / planned), title, angle, workflow_id (phải thuộc danh sách cho phép của kênh), publish_at (ISO 8601 có offset hoặc null). Không sửa mục đang/đã làm.',
      input: {
        type: 'object',
        properties: {
          date: DATE,
          ...OPS_CHANNEL_PROP,
          item_id: { type: 'string' },
          patch: {
            type: 'object',
            properties: {
              status: { enum: ['skipped', 'planned'] },
              title: { type: 'string' },
              angle: { type: 'string' },
              workflow_id: { type: 'string' },
              publish_at: { type: ['string', 'null'] },
            },
            additionalProperties: false,
          },
        },
        required: ['date', 'item_id', 'patch'],
        additionalProperties: false,
      },
      handler: async (i: { date: string; item_id: string; patch: PlanPatch }, ctx) =>
        updatePlanItem(ctx.store, {
          date: i.date,
          item_id: i.item_id,
          patch: i.patch,
          installed: d.installed(),
          ...(d.appDataDir ? { appDataDir: d.appDataDir } : {}),
          ...(d.now ? { now: d.now() } : {}),
        }),
    },
  ];
}
