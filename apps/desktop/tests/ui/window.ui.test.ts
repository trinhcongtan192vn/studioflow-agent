// 001 · US3 AC2 — cửa sổ chính hiển thị phiên bản core lấy qua API của core.
// 008 — test chạy trên app-data tạm (không đụng DB thật của người dùng); một bản app mỗi thư mục dữ liệu.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import { getVersion } from '@studioflow/core';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('main window shows the core version (001 US3 AC2); one instance per data dir (008)', async () => {
  const appData = mkdtempSync(path.join(os.tmpdir(), 'sf-ui-win-'));
  // VS Code/terminal tích hợp có thể đặt ELECTRON_RUN_AS_NODE=1 khiến Electron chạy như Node.
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      SF_APP_DATA: appData,
      SF_GPU: '0',
      SF_NO_CREDMAN: '1',
    }).filter((e): e is [string, string] => e[0] !== 'ELECTRON_RUN_AS_NODE' && e[1] !== undefined),
  );
  const app = await electron.launch({ args: [appDir], cwd: appDir, env });
  try {
    const win = await app.firstWindow();
    await expect(win.getByTestId('core-version')).toHaveText(`core ${getVersion().version}`);
    // bản thứ hai cùng thư mục dữ liệu thoát ngay (hai core cùng DB làm hỏng job đang chạy)
    const bin = createRequire(import.meta.url)('electron') as unknown as string;
    const second = spawn(bin, [appDir], { cwd: appDir, env, stdio: 'ignore' });
    const code = await new Promise<number | null>((resolve, reject) => {
      const t = setTimeout(() => {
        second.kill();
        reject(new Error('second instance did not exit'));
      }, 30_000);
      second.on('exit', (c) => {
        clearTimeout(t);
        resolve(c);
      });
    });
    expect(code).toBe(0);
    await expect(win.getByTestId('core-version')).toBeVisible();
  } finally {
    await app.close();
    rmSync(appData, { recursive: true, force: true });
  }
});
