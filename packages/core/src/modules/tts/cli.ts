import path from 'node:path';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { createCore } from '../../core.js';
import { speak } from '../../tts/tools.js';

/** `sf tts say --channel <dir> --voice <id> --text <t> [--out <rel>]` (D4 mục 12, kiểm M0). */
export const commands: CliCommand[] = [
  {
    module: 'tts',
    name: 'say',
    summary: 'Synthesize one sentence with a channel voice (cached by content)',
    options: {
      channel: { type: 'string', required: true },
      voice: { type: 'string', required: true },
      text: { type: 'string', required: true },
      out: { type: 'string' },
      emotion: { type: 'string' },
    },
    async run(input, ctx) {
      const appDataDir = defaultAppDataDir();
      const core = createCore({ appDataDir, start: false });
      try {
        const store = core.gateway.storeFor(path.resolve(ctx.cwd, input.channel as string));
        return await speak({ providers: core.providers, db: core.db }, store, {
          voice_id: input.voice as string,
          text: input.text as string,
          ...(input.emotion ? { emotion: input.emotion as string } : {}),
          ...(input.out ? { out: input.out as string } : {}),
          appDataDir,
        });
      } finally {
        core.close();
      }
    },
  },
];
