import { readFileSync } from 'node:fs';
import type { CliCommand } from '../../cli/types.js';
import { secretDelete, secretHint, secretSet } from '../../secrets/credman.js';

const NAMES = ['openai', 'deepseek', 'anthropic'];

/** `sf secret set <name>` (khóa đọc từ stdin), `sf secret delete <name>`, `sf secret status` (014, FR-OP-07). */
export const commands: CliCommand[] = [
  {
    module: 'secret',
    name: 'set',
    summary:
      'Store an API key (read from stdin) in Windows Credential Manager as StudioFlow/<name>',
    positionals: ['name'],
    async run(input) {
      const name = String(input.name ?? '');
      secretSet(name, readFileSync(0, 'utf8').trim());
      return { name, hint: secretHint(name) };
    },
  },
  {
    module: 'secret',
    name: 'delete',
    summary: 'Remove an API key from Credential Manager',
    positionals: ['name'],
    run: async (input) => ({ name: input.name, deleted: secretDelete(String(input.name ?? '')) }),
  },
  {
    module: 'secret',
    name: 'status',
    summary: 'Which provider keys are stored (last 4 characters only)',
    run: async () => ({ secrets: NAMES.map((n) => ({ name: n, hint: secretHint(n) })) }),
  },
];
