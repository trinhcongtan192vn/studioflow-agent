import path from 'node:path';
import { usageError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { evalCompare } from '../../eval/compare.js';

/** `sf eval compare --channel --by producer_model|rubric_version [--since] [--step]` (D4 mục 12, D11 mục 4). */
export const commands: CliCommand[] = [
  {
    module: 'eval',
    name: 'compare',
    summary:
      'Compare producer models or rubric versions: approval without major edit, critic score, rounds, tokens/video',
    options: {
      channel: { type: 'string', required: true },
      by: { type: 'string', required: true },
      since: { type: 'string' },
      step: { type: 'string' },
    },
    async run(input, ctx) {
      const by = String(input.by);
      if (by !== 'producer_model' && by !== 'rubric_version')
        throw usageError('--by must be producer_model or rubric_version');
      return {
        by,
        rows: evalCompare(path.resolve(ctx.cwd, input.channel as string), by, {
          appDataDir: defaultAppDataDir(),
          ...(input.since ? { since: String(input.since) } : {}),
          ...(input.step ? { step: String(input.step) } : {}),
        }),
      };
    },
  },
];
