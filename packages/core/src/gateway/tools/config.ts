import { resolveConfig, setConfig } from '../../config/resolve.js';
import { SfError } from '../../errors.js';
import type { ToolDefinition } from '../types.js';

export const configTools: ToolDefinition[] = [
  {
    name: 'config.resolve',
    description:
      'Giải giá trị một khóa cấu hình theo tầng app → kênh → video → scene → frame (D3 mục 7).',
    input: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        scene_id: { type: 'string' },
        frame_id: { type: 'string' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    async handler(input: { key: string; scene_id?: string; frame_id?: string }, ctx) {
      return resolveConfig(
        input.key,
        {
          channelDir: ctx.store.root,
          videoId: ctx.session.video_id,
          sceneId: input.scene_id,
          frameId: input.frame_id,
        },
        { appDataDir: ctx.appDataDir },
      );
    },
  },
  {
    name: 'config.set',
    description: 'Đặt khóa cấu hình ở tầng kênh hoặc video (kiểm tầng cho phép, D3 mục 7.2).',
    input: {
      type: 'object',
      properties: { key: { type: 'string' }, value: {}, tier: { enum: ['channel', 'video'] } },
      required: ['key', 'value', 'tier'],
      additionalProperties: false,
    },
    async handler(input: { key: string; value: unknown; tier: 'channel' | 'video' }, ctx) {
      if (input.tier === 'video' && !ctx.session.video_id) {
        throw new SfError('E_CONFIG_SCOPE', 'no video selected in this session');
      }
      setConfig(ctx.store, input.key, input.value, {
        tier: input.tier,
        videoId: ctx.session.video_id,
      });
      return {};
    },
  },
];
