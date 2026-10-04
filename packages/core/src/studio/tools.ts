import { SfError } from '../errors.js';
import type { ToolDefinition } from '../gateway/types.js';
import type { StudioEdits } from './edit.js';
import type { StudioPreviews } from './preview.js';
import type { PinnedDecider } from './pinned.js';

function videoOf(ctx: { session: { video_id?: string } }, tool: string): string {
  if (!ctx.session.video_id) throw new SfError('E_SCHEMA_INVALID', `${tool} needs a video session`);
  return ctx.session.video_id;
}

/** Tool `studio.open|commit|close` (D4 mục 2.4, D9 mục 2–3) và `frame.pinned_decide` (D9 mục 5, 025). */
export function studioTools(
  previews: StudioPreviews,
  edits?: StudioEdits,
  pinned?: PinnedDecider,
): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: 'studio.open',
      description:
        'Mở Studio cho video hiện tại; mode "preview" chỉ xem, mode "edit" cho người dùng chỉnh vị trí/kích thước/timing/keyframe/grade/âm lượng (agent không ghi file cảnh tới khi đóng); trả {url}.',
      input: {
        type: 'object',
        properties: { mode: { enum: ['preview', 'edit'] } },
        required: ['mode'],
        additionalProperties: false,
      },
      async handler(i: { mode: 'preview' | 'edit' }, ctx) {
        const vd = videoOf(ctx, 'studio.open');
        if (i.mode === 'edit') {
          if (!edits)
            throw new SfError('E_TOOL_DENIED', 'Studio edit mode is not available in this app');
          return edits.open(ctx.store, vd);
        }
        return previews.open(ctx.store, vd);
      },
    },
    {
      name: 'studio.close',
      description:
        'Đóng Studio của video hiện tại; còn thay đổi chưa lưu thì báo E_STUDIO_UNCOMMITTED (hỏi người dùng, rồi gọi lại với discard: true hoặc studio.commit).',
      input: {
        type: 'object',
        properties: { discard: { type: 'boolean' } },
        additionalProperties: false,
      },
      async handler(i: { discard?: boolean }, ctx) {
        const vd = videoOf(ctx, 'studio.close');
        const edited = edits?.session(ctx.store, vd);
        if (edited) return edits!.close(ctx.store, vd, i);
        return { closed: previews.close(ctx.store, vd) };
      },
    },
  ];
  if (edits)
    tools.push({
      name: 'studio.commit',
      description:
        'Lưu thay đổi trong Studio (chế độ chỉnh) vào video: chỉ nhận vị trí/kích thước/timing/keyframe/grade/âm lượng; thay đổi khác bị từ chối kèm giải thích.',
      input: {
        type: 'object',
        properties: { message: { type: 'string' } },
        additionalProperties: false,
      },
      async handler(_i: { message?: string }, ctx) {
        return edits.commit(ctx.store, videoOf(ctx, 'studio.commit'));
      },
    });
  if (pinned)
    tools.push({
      name: 'frame.pinned_decide',
      description:
        'Quyết định cho frame đã chỉnh tay mà đầu vào đổi (pinned_stale): keep (giữ bản chỉnh tay), reapply (sinh lại rồi áp lại chỉnh tay), discard (sinh lại, bỏ chỉnh tay). Chỉ gọi khi người dùng đã chọn.',
      input: {
        type: 'object',
        properties: {
          frame_id: { type: 'string', pattern: '^fr_[0-9a-z]{8}$' },
          decision: { enum: ['keep', 'reapply', 'discard'] },
        },
        required: ['frame_id', 'decision'],
        additionalProperties: false,
      },
      async handler(i: { frame_id: string; decision: 'keep' | 'reapply' | 'discard' }, ctx) {
        const vd = videoOf(ctx, 'frame.pinned_decide');
        return pinned.decide(ctx.store, vd, i.frame_id, i.decision);
      },
    });
  return tools;
}
