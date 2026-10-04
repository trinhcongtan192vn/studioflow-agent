import path from 'node:path';
import { usageError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';
import { validateChannel } from '../../domain/channel-validate.js';
import { SfError } from '../../errors.js';

/** `sf channel validate <channel_dir>` (D4 mục 13, D6 mục 6.3, 022): có lỗi → exit 1 `E_CHANNEL_INVALID`. */
export const commands: CliCommand[] = [
  {
    module: 'channel',
    name: 'validate',
    summary:
      'Check a channel profile: channel.json, config keys, voices, LUT, mouths, blueprints, prompts, rubrics',
    positionals: ['channel_dir'],
    async run(input, ctx) {
      if (typeof input.channel_dir !== 'string')
        throw usageError('usage: sf channel validate <channel_dir>');
      const r = validateChannel(path.resolve(ctx.cwd, input.channel_dir));
      if (!r.ok)
        throw new SfError(
          'E_CHANNEL_INVALID',
          `${r.errors.length} problem(s): ${r.errors
            .slice(0, 5)
            .map((e) => `${e.code} ${e.path}: ${e.message}`)
            .join('; ')}`,
          r.errors,
        );
      return r;
    },
  },
];
