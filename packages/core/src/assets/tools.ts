import type { ToolDefinition } from '../gateway/types.js';
import { importAsset, searchAssets } from './library.js';
import { trashAsset } from './trash.js';

/** Tool `asset.import`, `asset.search` (D4 mục 2.4, 011 FR-007). */
export function assetTools(): ToolDefinition[] {
  return [
    {
      name: 'asset.import',
      description:
        'Đưa file đính kèm (uploads/…) vào thư viện asset kênh và public/ của video hiện tại; trả {asset_id}.',
      input: {
        type: 'object',
        properties: {
          path: { type: 'string', minLength: 1 },
          tags: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      async handler(i: { path: string; tags?: string[]; description?: string }, ctx) {
        // đường dẫn tương đối video khi phiên gắn video
        const v = ctx.session.video_id;
        const rel = v && !i.path.startsWith('videos/') ? `videos/${v}/${i.path}` : i.path;
        return importAsset(ctx.store, { ...i, path: rel, ...(v ? { videoId: v } : {}) });
      },
    },
    {
      name: 'asset.search',
      description: 'Tìm asset trong thư viện kênh theo từ khóa (tag, mô tả, tên) và tag bắt buộc.',
      input: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['query'],
        additionalProperties: false,
      },
      handler: async (i: { query: string; tags?: string[]; limit?: number }, ctx) =>
        searchAssets(ctx.store, i),
    },
    {
      name: 'asset.delete',
      description:
        'Dọn ảnh/tệp rác khỏi thư viện kênh (sinh lỗi, thử không dùng): chuyển vào thùng rác .trash/assets/ (khôi phục được) và bỏ khỏi manifest. Từ chối nếu storyboard, nhân vật hay design còn dùng asset đó.',
      input: {
        type: 'object',
        properties: { asset_id: { type: 'string', pattern: '^as_[0-9a-z]{8}$' } },
        required: ['asset_id'],
        additionalProperties: false,
      },
      handler: async (i: { asset_id: string }, ctx) => trashAsset(ctx.store, i.asset_id),
    },
  ];
}
