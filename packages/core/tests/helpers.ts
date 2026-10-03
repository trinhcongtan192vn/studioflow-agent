import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sfBin = path.join(coreDir, 'bin', 'sf.mjs');

export interface SfResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Chạy CLI `sf` thật trong tiến trình con (constitution Điều X). */
export function runSf(
  args: string[],
  opts: { input?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): SfResult {
  const r = spawnSync(process.execPath, [sfBin, ...args], {
    cwd: opts.cwd ?? coreDir,
    input: opts.input ?? '',
    encoding: 'utf8',
    env: { ...process.env, SF_LOG: '', ...opts.env },
  });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}
