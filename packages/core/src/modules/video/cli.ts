import path from 'node:path';
import { usageError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';
import { detectChannel } from '../../domain/channel.js';
import { createVideo } from '../../domain/video.js';
import { SfError } from '../../errors.js';
import { WriteStore } from '../../store/writer.js';

/** `sf video create <channel_dir> [--title]` (D4 mục 12). */
export const commands: CliCommand[] = [
  {
    module: 'video',
    name: 'create',
    summary: 'Create a video in a channel (phase: briefing)',
    positionals: ['channel_dir'],
    options: { title: { type: 'string' } },
    async run(input, ctx) {
      if (typeof input.channel_dir !== 'string')
        throw usageError('usage: sf video create <channel_dir> [--title <t>]');
      const dir = path.resolve(ctx.cwd, input.channel_dir);
      if (detectChannel(dir).kind !== 'channel')
        throw new SfError('E_SCHEMA_INVALID', `${dir} is not a channel (no channel.json)`);
      const state = createVideo(new WriteStore(dir), { title: input.title as string | undefined });
      return { video_id: state.video_id, phase: state.phase };
    },
  },
];
