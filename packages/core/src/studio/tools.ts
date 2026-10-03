import { SfError } from '../errors.js';
import type { ToolDefinition } from '../gateway/types.js';
import type { StudioPreviews } from './preview.js';

/** Tool `studio.open` / `studio.close` (D4 mục 2.4, D9 mục 2): M1 chỉ chế độ xem trước. */
export function studioTools(previews: StudioPreviews): ToolDefinition[] {
  return [
    {
      name: 'studio.open',
      description:
        'Mở Studio xem trước (chỉ đọc) cho video hiện tại; trả {url}. Chế độ chỉnh có ở M3.',
      input: {
        type: 'object',
        properties: { mode: { enum: ['preview', 'edit'] } },
        required: ['mode'],
        additionalProperties: false,
      },
      async handler(i: { mode: 'preview' | 'edit' }, ctx) {
        if (!ctx.session.video_id)
          throw new SfError('E_SCHEMA_INVALID', 'studio.open needs a video session');
        if (i.mode === 'edit')
          throw new SfError(
            'E_TOOL_DENIED',
            'Studio edit mode arrives in M3 (feature 025); use preview',
          );
        return previews.open(ctx.store, ctx.session.video_id);
      },
    },
    {
      name: 'studio.close',
      description: 'Đóng Studio xem trước của video hiện tại.',
      input: { type: 'object', properties: {}, additionalProperties: false },
      async handler(_i: unknown, ctx) {
        if (!ctx.session.video_id)
          throw new SfError('E_SCHEMA_INVALID', 'studio.close needs a video session');
        return { closed: previews.close(ctx.store, ctx.session.video_id) };
      },
    },
  ];
}
