import { CliError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';

/** Lệnh mẫu/chẩn đoán phủ đủ mã thoát 0/1/2 để kiểm quy ước CLI (001 FR-009). */
export const commands: CliCommand[] = [
  {
    module: 'diag',
    name: 'echo',
    summary: 'Echo a message N times (CLI convention check)',
    options: {
      message: { type: 'string', required: true },
      repeat: { type: 'string', kind: 'number' },
    },
    async run(input) {
      const message = input.message as string;
      const repeat = (input.repeat as number | undefined) ?? 1;
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) {
        throw new CliError('E_CLI_USAGE', '--repeat must be an integer in 1..100', 2);
      }
      return { message, repeat, echo: Array.from({ length: repeat }, () => message) };
    },
  },
  {
    module: 'diag',
    name: 'fail',
    summary: 'Always fails with a business error (exit 1)',
    async run() {
      throw new CliError('E_DIAG_FAIL', 'diagnostic failure requested');
    },
  },
];
