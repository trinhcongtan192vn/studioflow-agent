import { OPS_CHANNEL_PROP, type ToolDefinition } from '../gateway/types.js';
import type { ReportService } from './reporter.js';

/** Tool `report.get` (D4 2.4, 054): báo cáo ngày của kênh — phiên `main` và `ops`. */
export function reportTools(svc: ReportService): ToolDefinition[] {
  return [
    {
      name: 'report.get',
      description:
        'Báo cáo ngày của kênh: lượt xem YouTube so với hôm trước và trung bình 7 ngày, video nổi bật, sản xuất hôm nay (xong / cần xem / hỏng), đăng bài, Claude đã dùng so với ngân sách, quota YouTube. date: YYYY-MM-DD, bỏ trống = hôm nay (chưa lập thì tính ngay từ số liệu hiện có).',
      input: {
        type: 'object',
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          ...OPS_CHANNEL_PROP,
        },
        additionalProperties: false,
      },
      handler: async (i: { date?: string }, ctx) => svc.get(ctx.store.root, i.date),
    },
  ];
}
