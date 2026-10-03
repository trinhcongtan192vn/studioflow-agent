// 001 · US3 AC2 — cửa sổ chính hiển thị phiên bản core lấy qua API của core.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import { getVersion } from '@studioflow/core';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('main window shows the core version (001 US3 AC2)', async () => {
  // VS Code/terminal tích hợp có thể đặt ELECTRON_RUN_AS_NODE=1 khiến Electron chạy như Node.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[0] !== 'ELECTRON_RUN_AS_NODE' && e[1] !== undefined,
    ),
  );
  const app = await electron.launch({ args: [appDir], cwd: appDir, env });
  try {
    const win = await app.firstWindow();
    await expect(win.getByTestId('core-version')).toHaveText(`core ${getVersion().version}`);
  } finally {
    await app.close();
  }
});
