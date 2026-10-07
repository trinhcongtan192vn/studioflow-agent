import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AutopilotLogLine } from '../contracts/types.js';
import { listOpsSessions, getOpsSession } from '../agent/session-log.js';
import { OPS_CHANNEL_PROP, type ToolDefinition } from '../gateway/types.js';
import { readPlan } from './plan.js';
import type { AutopilotRunner } from './runner.js';

const NONE = { type: 'object', properties: {}, additionalProperties: false } as const;

/** Tool `autopilot.status` / `pause` / `resume` và nhóm `ops.*` (D4 2.4, 052/055). */
export function autopilotRunnerTools(
  runner: AutopilotRunner,
  appDataDir?: string,
): ToolDefinition[] {
  return [
    {
      name: 'autopilot.status',
      description:
        'Tình hình Autopilot của kênh: đang tạm dừng/đang chạy, mục kế hoạch hôm nay và trạng thái (planned / in_production / produced / failed / needs_review kèm ghi chú lý do), video đang làm ở bước nào, thời điểm chờ nếu hết hạn mức Claude, và 20 dòng nhật ký vận hành gần nhất. Dùng để giải thích vì sao một video dừng (needs_review) hoặc hỏng. Phiên ops: kèm channel, bỏ trống = tóm tắt mọi kênh.',
      input: { type: 'object', properties: { ...OPS_CHANNEL_PROP }, additionalProperties: false },
      handler: async (i: { channel?: string }, ctx) => {
        if (ctx.session.kind === 'ops' && !i.channel) return runner.status();
        const s = runner.status(ctx.store.root);
        const today = s.today[0];
        const current = s.current?.channel === ctx.store.root ? s.current : undefined;
        return {
          paused: s.paused,
          running: s.running,
          ...(s.waiting_until ? { waiting_until: s.waiting_until } : {}),
          ...(current ? { current } : {}),
          today: { date: today?.date ?? '', items: today?.items ?? [] },
          log: runner.recentLog(ctx.store.root),
        };
      },
    },
    {
      name: 'autopilot.pause',
      description:
        'Tạm dừng Autopilot (không bắt đầu video mới; video đang làm dở có thể xong). Chỉ làm khi người dùng yêu cầu.',
      input: NONE,
      handler: async () => runner.setPaused(true),
    },
    {
      name: 'autopilot.resume',
      description: 'Tiếp tục Autopilot sau khi tạm dừng. Chỉ làm khi người dùng yêu cầu.',
      input: NONE,
      handler: async () => runner.setPaused(false),
    },
    {
      name: 'ops.channels',
      description:
        'Các kênh quản lý đang bật Autopilot: tên, đường dẫn, và số mục kế hoạch hôm nay theo trạng thái.',
      input: NONE,
      handler: async () => {
        const s = runner.status();
        return {
          paused: s.paused,
          channels: s.today.map((c) => {
            const items: Record<string, number> = {};
            for (const it of c.items) items[it.status] = (items[it.status] ?? 0) + 1;
            return { path: c.channel, name: c.name, date: c.date, items };
          }),
        };
      },
    },
    {
      name: 'ops.log',
      description:
        'Nhật ký vận hành Autopilot của kênh (mỗi quyết định tự động một dòng kèm lý do tiếng Việt). date: YYYY-MM-DD, bỏ trống = hôm nay; limit: số dòng cuối (mặc định 50, tối đa 100).',
      input: {
        type: 'object',
        properties: {
          ...OPS_CHANNEL_PROP,
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      handler: async (i: { date?: string; limit?: number }, ctx) => {
        const date = i.date ?? runner.status(ctx.store.root).today[0]?.date;
        const lines = date ? readLogLines(ctx.store.root, date) : [];
        return { date, lines: lines.slice(-(i.limit ?? 50)) };
      },
    },
    {
      name: 'ops.sessions',
      description:
        'Nhật ký các phiên ops (hỏi đáp qua Telegram): không có id → danh sách; có id → các dòng của phiên đó.',
      input: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          id: { type: 'string' },
        },
        additionalProperties: false,
      },
      handler: async (i: { limit?: number; id?: string }) => {
        const dir = appDataDir ?? '';
        return i.id
          ? { lines: getOpsSession(dir, i.id) }
          : { sessions: listOpsSessions(dir, { limit: i.limit ?? 20 }) };
      },
    },
    // mục kế hoạch hôm nay của kênh (để agent đọc ghi chú lý do) đã có ở autopilot.plan_get
  ];
}

function readLogLines(channel: string, date: string): AutopilotLogLine[] {
  try {
    return readFileSync(path.join(channel, 'autopilot', 'log', `${date}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as AutopilotLogLine];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Cho tool khác dùng: mục kế hoạch đọc nhanh (tránh phụ thuộc vòng). */
export const planItemsOf = (channel: string, date: string) => readPlan(channel, date)?.items ?? [];
