import type { ToolDefinition } from '../gateway/types.js';
import { importAsset, searchAssets } from './library.js';

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
  ];
}
