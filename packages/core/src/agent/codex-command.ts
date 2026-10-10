import { existsSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Electron may start without the PATH injected by the VS Code terminal. */
export function resolveCodexCommand(
  options: {
    configured?: string;
    env?: NodeJS.ProcessEnv;
    home?: string;
    platform?: NodeJS.Platform;
    arch?: string;
  } = {},
): string {
  const env = options.env ?? process.env;
  const override = options.configured?.trim() || env.SF_CODEX_PATH?.trim();
  if (override) return override;
  const platform = options.platform ?? process.platform;
  const executable = platform === 'win32' ? 'codex.exe' : 'codex';
  const isFile = (file: string) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  };
  const searchPath = env.PATH ?? env.Path ?? '';
  for (const directory of searchPath.split(platform === 'win32' ? ';' : ':')) {
    if (!directory.trim()) continue;
    const file = path.join(directory.replace(/^"|"$/g, ''), executable);
    if (isFile(file)) return file;
  }
  const home = options.home ?? os.homedir();
  const arch = options.arch ?? process.arch;
  const target =
    platform === 'win32'
      ? `windows-${arch === 'arm64' ? 'aarch64' : 'x86_64'}`
      : platform === 'darwin'
        ? `macos-${arch === 'arm64' ? 'aarch64' : 'x86_64'}`
        : `linux-${arch === 'arm64' ? 'aarch64' : 'x86_64'}`;
  for (const editor of ['.vscode', '.vscode-insiders']) {
    const root = path.join(home, editor, 'extensions');
    if (!existsSync(root)) continue;
    let extensions: string[];
    try {
      extensions = readdirSync(root);
    } catch {
      continue;
    }
    extensions = extensions
      .filter((name) => name.startsWith('openai.chatgpt-'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const extension of extensions) {
      const file = path.join(root, extension, 'bin', target, executable);
      if (isFile(file)) return file;
    }
  }
  return executable;
}
