import path from 'node:path';
import { usageError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';
import { resolveConfig } from '../../config/resolve.js';

/** `sf config resolve <key> --channel <dir> [--video] [--scene] [--frame]` (D3 mục 7.3, D4 mục 12). */
export const commands: CliCommand[] = [
  {
    module: 'config',
    name: 'resolve',
    summary: 'Resolve a config key across app/channel/video/scene/frame tiers',
    positionals: ['key'],
    options: {
      channel: { type: 'string', required: true },
      video: { type: 'string' },
      scene: { type: 'string' },
      frame: { type: 'string' },
    },
    async run(input, ctx) {
      if (typeof input.key !== 'string')
        throw usageError('usage: sf config resolve <key> --channel <dir>');
      return resolveConfig(input.key, {
        channelDir: path.resolve(ctx.cwd, input.channel as string),
        videoId: input.video as string | undefined,
        sceneId: input.scene as string | undefined,
        frameId: input.frame as string | undefined,
      });
    },
  },
];
