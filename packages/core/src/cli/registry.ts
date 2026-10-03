import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError } from './errors.js';
import type { CliCommand } from './types.js';

const CLI_FILES = ['cli.js', 'cli.mjs', 'cli.ts'];

/**
 * Quét `<dir>/<module>/cli.{js,mjs,ts}` và gom `commands`. Thêm module mới không cần sửa khung
 * (001 FR-SC-010). Trùng `(module, name)` → `E_CLI_DUPLICATE_COMMAND`, không chọn ngầm.
 */
export async function loadCommands(modulesDirs: string[]): Promise<CliCommand[]> {
  const found = new Map<string, { cmd: CliCommand; file: string }>();
  for (const dir of modulesDirs) {
    if (!existsSync(dir)) continue;
    const modules = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const mod of modules) {
      const file = CLI_FILES.map((f) => path.join(dir, mod, f)).find((f) => existsSync(f));
      if (!file) continue;
      const loaded = (await import(pathToFileURL(file).href)) as { commands?: CliCommand[] };
      for (const cmd of loaded.commands ?? []) {
        const key = `${cmd.module} ${cmd.name}`;
        const prev = found.get(key);
        if (prev) {
          throw new CliError(
            'E_CLI_DUPLICATE_COMMAND',
            `command "sf ${key}" is registered by both ${prev.file} and ${file}`,
          );
        }
        found.set(key, { cmd, file });
      }
    }
  }
  return [...found.values()].map((v) => v.cmd);
}
