/** Lỗi CLI theo D4 mục 12: in ra stderr `{code, message}`; exit 1 = nghiệp vụ, 2 = tham số. */
export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exit: 1 | 2 = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export const usageError = (message: string): CliError => new CliError('E_CLI_USAGE', message, 2);
