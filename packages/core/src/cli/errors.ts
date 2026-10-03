import { SfError } from '../errors.js';

/** Lỗi CLI theo D4 mục 12: in ra stderr `{code, message}`; exit 1 = nghiệp vụ, 2 = tham số. */
export class CliError extends SfError {
  constructor(code: string, message: string, exit: 1 | 2 = 1) {
    super(code, message, undefined, exit);
    this.name = 'CliError';
  }
}

export const usageError = (message: string): CliError => new CliError('E_CLI_USAGE', message, 2);
