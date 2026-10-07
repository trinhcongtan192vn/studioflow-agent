import type { ToolDefinition } from '../gateway/types.js';
import type { AutopilotRunner } from './runner.js';

/** Tool `autopilot.status` (D4 2.4, 052): tình hình Autopilot của kênh đang mở — chỉ đọc, phiên `main`. */
export function autopilotRunnerTools(runner: AutopilotRunner): ToolDefinition[] {
  return [
    {
      name: 'autopilot.status',
      description:
        'Tình hình Autopilot của kênh: đang tạm dừng/đang chạy, mục kế hoạch hôm nay và trạng thái (planned / in_production / produced / failed / needs_review kèm ghi chú lý do), video đang làm ở bước nào, thời điểm chờ nếu hết hạn mức Claude, và 20 dòng nhật ký vận hành gần nhất. Dùng để giải thích vì sao một video dừng (needs_review) hoặc hỏng.',
      input: { type: 'object', properties: {}, additionalProperties: false },
      handler: async (_i: Record<string, never>, ctx) => {
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
  ];
}
