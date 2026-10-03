import path from 'node:path';
import type { CliCommand } from '../../cli/types.js';
import { usageError } from '../../cli/errors.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { createCore } from '../../core.js';

/** `sf text ask --channel <dir> [--role primary|aux] <prompt...>` (009 FR-010). */
export const commands: CliCommand[] = [
  {
    module: 'text',
    name: 'ask',
    summary: 'One-shot text.generate with the configured producer/aux model',
    options: { channel: { type: 'string', required: true }, role: { type: 'string' } },
    positionals: ['prompt...'],
    async run(input, ctx) {
      const role = (input.role as string | undefined) ?? 'primary';
      if (role !== 'primary' && role !== 'aux') throw usageError('--role must be primary or aux');
      const prompt = ((input.prompt as string[] | undefined) ?? []).join(' ').trim();
      if (!prompt) throw usageError('missing <prompt>');
      const core = createCore({
        appDataDir: defaultAppDataDir(),
        dbFile: ':memory:',
        start: false,
      });
      try {
        const store = core.gateway.storeFor(path.resolve(ctx.cwd, input.channel as string));
        return await core.text.generate(
          role,
          { role, messages: [{ role: 'user', content: prompt }], max_tokens: 2000 },
          { store },
        );
      } finally {
        core.close();
      }
    },
  },
];
