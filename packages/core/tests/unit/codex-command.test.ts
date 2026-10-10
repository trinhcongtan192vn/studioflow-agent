import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { resolveCodexCommand } from '../../src/agent/codex-command.js';

it('discovers the newest VS Code Codex executable without terminal PATH', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'sf-cli-'));
  try {
    const files = ['26.9.1', '26.10.1'].map((version) => {
      const file = path.join(
        home,
        '.vscode',
        'extensions',
        `openai.chatgpt-${version}-win32-x64`,
        'bin',
        'windows-x86_64',
        'codex.exe',
      );
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, 'fixture');
      return file;
    });
    const options = { home, env: {}, platform: 'win32' as const, arch: 'x64' };
    expect(resolveCodexCommand(options)).toBe(files[1]);
    expect(resolveCodexCommand({ ...options, env: { PATH: path.dirname(files[0]!) } })).toBe(
      files[0],
    );
    expect(
      resolveCodexCommand({
        ...options,
        configured: 'custom.exe',
        env: { SF_CODEX_PATH: 'env.exe' },
      }),
    ).toBe('custom.exe');
    expect(resolveCodexCommand({ ...options, env: { SF_CODEX_PATH: 'env.exe' } })).toBe('env.exe');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
