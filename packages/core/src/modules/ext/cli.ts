import path from 'node:path';
import { usageError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';
import { SfError } from '../../errors.js';
import { loadPack } from '../../workflow/packs.js';

/** `sf ext validate <pack_dir>` (D4 mục 12, D13) — gói workflow ở 007; loại gói khác thêm sau. */
export const commands: CliCommand[] = [
  {
    module: 'ext',
    name: 'validate',
    summary: 'Validate an extension pack manifest (workflow packs)',
    positionals: ['pack_dir'],
    async run(input, ctx) {
      if (typeof input.pack_dir !== 'string') throw usageError('usage: sf ext validate <pack_dir>');
      const pack = loadPack(path.resolve(ctx.cwd, input.pack_dir));
      if (pack.errors.length) {
        const first = pack.errors[0]!;
        throw new SfError(
          first.code,
          `${pack.errors.length} problem(s); first: ${first.message}`,
          pack.errors,
        );
      }
      return { valid: true, id: pack.manifest.id, kind: 'workflow', errors: [] };
    },
  },
];
