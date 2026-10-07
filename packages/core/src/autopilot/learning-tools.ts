import { OPS_CHANNEL_PROP, type ToolDefinition } from '../gateway/types.js';
import type { LearningService } from './learning.js';

/** Tool `learning.get` (D4 2.4, 057): điều chỉnh điểm chủ đề đã học của kênh — phiên `main` và `ops`. */
export function learningTools(svc: LearningService): ToolDefinition[] {
  return [
    {
      name: 'learning.get',
      description:
        'Điều chỉnh điểm chủ đề đã học từ hiệu quả thật của video đã đăng: nhóm (dạng chủ đề, trụ cột, đối thủ nguồn, workflow, khung giờ) nào hiệu quả hơn/kém trung bình, hệ số 0,7–1,3, số video. enough_data=false nghĩa là chưa đủ dữ liệu nên chưa ảnh hưởng gì.',
      input: {
        type: 'object',
        properties: { ...OPS_CHANNEL_PROP },
        additionalProperties: false,
      },
      handler: async (_i: Record<string, never>, ctx) => svc.get(ctx.store.root),
    },
  ];
}
