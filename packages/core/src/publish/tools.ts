import { OPS_CHANNEL_PROP, type ToolDefinition } from '../gateway/types.js';
import type { PublishService } from './service.js';

const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const COMMON = {
  item_id: { type: 'string' },
  date: DATE,
  platform: { enum: ['youtube', 'tiktok', 'facebook'] },
  ...OPS_CHANNEL_PROP,
};

/** Tool `publish.*` (D4 2.4, 053): xem trạng thái đăng, Hủy đăng, Đăng ngay — phiên `main` và `ops`. */
export function publishTools(svc: PublishService): ToolDefinition[] {
  return [
    {
      name: 'publish.status',
      description:
        'Trạng thái đăng bài (YouTube/TikTok/Facebook) của các mục kế hoạch đã làm xong trong ngày: pending / uploading / scheduled (riêng tư + hẹn giờ công khai) / private (đã tải lên, chờ bạn công khai thủ công) / public / cancelled / failed, kèm URL, giờ công khai, hạn phản đối và lỗi.',
      input: {
        type: 'object',
        properties: { date: DATE, ...OPS_CHANNEL_PROP },
        additionalProperties: false,
      },
      handler: async (i: { date?: string }, ctx) => svc.status(ctx.store.root, i.date),
    },
    {
      name: 'publish.cancel',
      description:
        'Hủy đăng một mục trong cửa sổ phản đối: video ở lại riêng tư, bỏ hẹn giờ công khai. Chỉ làm khi người dùng yêu cầu rõ (nêu tiêu đề video trước).',
      input: {
        type: 'object',
        properties: COMMON,
        required: ['item_id'],
        additionalProperties: false,
      },
      handler: async (
        i: { item_id: string; date?: string; platform?: 'youtube' | 'tiktok' | 'facebook' },
        ctx,
      ) => svc.cancel({ ...i, channel: ctx.store.root }),
    },
    {
      name: 'publish.now',
      description:
        'Đăng công khai ngay một mục đã tải lên (không chờ giờ hẹn). Dự án API chưa kiểm duyệt thì không làm được — trả hướng dẫn công khai thủ công. Chỉ làm khi người dùng yêu cầu rõ.',
      input: {
        type: 'object',
        properties: COMMON,
        required: ['item_id'],
        additionalProperties: false,
      },
      handler: async (
        i: { item_id: string; date?: string; platform?: 'youtube' | 'tiktok' | 'facebook' },
        ctx,
      ) => svc.publishNow({ ...i, channel: ctx.store.root }),
    },
  ];
}
