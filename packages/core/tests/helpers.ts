import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sfBin = path.join(coreDir, 'bin', 'sf.mjs');

export interface SfResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 083: thư mục dữ liệu app trống cho CLI trong test — không đọc cấu hình thật của máy (model, khóa…). */
const isolatedAppData = mkdtempSync(path.join(tmpdir(), 'sf-appdata-'));

/** Chạy CLI `sf` thật trong tiến trình con (constitution Điều X). */
export function runSf(
  args: string[],
  opts: { input?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): SfResult {
  const r = spawnSync(process.execPath, [sfBin, ...args], {
    cwd: opts.cwd ?? coreDir,
    input: opts.input ?? '',
    encoding: 'utf8',
    env: { ...process.env, SF_LOG: '', SF_APP_DATA: isolatedAppData, ...opts.env },
  });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}
