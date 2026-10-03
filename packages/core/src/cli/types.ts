import type { ParseArgsConfig } from 'node:util';

export type OptionSpec = NonNullable<ParseArgsConfig['options']>[string] & {
  /** Kiểu sau khi chuyển đổi; `number` được kiểm và ép từ chuỗi. */
  kind?: 'string' | 'number' | 'boolean';
  required?: boolean;
};

export interface CommandContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Một lệnh `sf <module> <name>`; module khai báo trong `modules/<module>/cli.ts` (export `commands`). */
export interface CliCommand {
  module: string;
  name: string;
  summary: string;
  options?: Record<string, OptionSpec>;
  /** Tên tham số vị trí, theo thứ tự. Tham số vị trí cuối có thể kết thúc bằng `...` để nhận phần còn lại. */
  positionals?: string[];
  run(input: Record<string, unknown>, ctx: CommandContext): Promise<unknown>;
}
