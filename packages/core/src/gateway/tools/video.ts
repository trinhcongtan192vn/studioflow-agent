import { createVideo } from '../../domain/video.js';
import { SfError } from '../../errors.js';
import type { ToolDefinition } from '../types.js';

/** 081: video agent vừa tạo từ chat kênh + yêu cầu cần chuyển sang phiên của video đó. */
export interface VideoCreated {
  channel: string;
  video: string;
  title: string;
  instruction: string;
}

/**
 * `video.create` (081): agent ở chat kênh (chưa có video) tạo video mới cho yêu cầu của người dùng thay vì bảo
 * người dùng tự tạo. Host mở video đó trong app và chuyển `instruction` sang phiên chat của video.
 */
export function videoTools(o: { onCreated: (e: VideoCreated) => void }): ToolDefinition[] {
  return [
    {
      name: 'video.create',
      description:
        'Tạo video mới trong kênh (chỉ dùng ở chat kênh, khi chưa ở trong video nào). App mở video đó và chuyển `instruction` sang phiên chat của video — agent của video làm tiếp. Gọi xong thì báo ngắn cho người dùng và dừng; không làm tiếp việc của video trong phiên kênh.',
      input: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description: 'Tên làm việc của video',
          },
          instruction: {
            type: 'string',
            minLength: 1,
            maxLength: 4000,
            description:
              'Yêu cầu đầy đủ của người dùng cho video này (kèm link nguồn, dạng video, thời lượng…) để agent của video làm tiếp',
          },
        },
        required: ['title', 'instruction'],
        additionalProperties: false,
      },
      async handler(input: { title: string; instruction: string }, ctx) {
        if (ctx.session.video_id)
          throw new SfError(
            'E_SCHEMA_INVALID',
            'this chat is already inside a video — do the work here instead of creating another video',
          );
        const st = createVideo(ctx.store, { title: input.title.trim() });
        o.onCreated({
          channel: ctx.store.root,
          video: st.video_id,
          title: input.title.trim(),
          instruction: input.instruction.trim(),
        });
        return {
          video_id: st.video_id,
          note: 'Đã tạo video; app mở video này và chuyển yêu cầu sang phiên chat của video. Dừng ở đây.',
        };
      },
    },
  ];
}
