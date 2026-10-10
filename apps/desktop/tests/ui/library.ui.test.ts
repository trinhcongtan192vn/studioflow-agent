// 097: actual Electron table, filtering and page boundaries over completed render metadata.
import { _electron as electron, expect, test } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('097 library table paginates, filters and preserves preview/export actions', async () => {
  test.setTimeout(90_000);
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const fixture = path.resolve(appDir, '../../packages/core/tests/fixtures/domain');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sf-library-ui-'));
  const channel = path.join(tmp, 'channel');
  const appData = path.join(tmp, 'app');
  cpSync(path.join(fixture, 'channel'), channel, { recursive: true });
  cpSync(path.join(fixture, 'appdata'), appData, { recursive: true });
  const settingsFile = path.join(appData, 'settings.json');
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
  settings.config['autopilot.paused'] = true;
  writeFileSync(settingsFile, JSON.stringify(settings));
  const video = path.join(channel, 'videos/vd_8m2pq7rt');
  for (let i = 0; i < 26; i++) {
    const id = `rd_test${String(i).padStart(4, '0')}`;
    const dir = path.join(video, 'renders', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'video.mp4'), 'fixture');
    writeFileSync(
      path.join(dir, 'render.json'),
      JSON.stringify({
        id,
        status: 'done',
        mode: i % 2 ? 'draft' : 'release',
        file: `renders/${id}/video.mp4`,
        output_profile: 'yt-1080p30',
        duration_ms: 1160000,
        finished_at: new Date(Date.UTC(2026, 8, i + 1)).toISOString(),
      }),
    );
  }
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      SF_APP_DATA: appData,
      SF_OPEN_CHANNEL: channel,
      SF_GPU: '0',
      SF_NO_CREDMAN: '1',
      SF_AUTOPILOT: '0',
      SF_LLM: 'replay',
      SF_LLM_FIXTURES: path.join(appDir, 'tests/fixtures/llm'),
    }).filter((e): e is [string, string] => e[0] !== 'ELECTRON_RUN_AS_NODE' && e[1] !== undefined),
  );
  const app = await electron.launch({ args: [appDir], cwd: appDir, env });
  try {
    const win = await app.firstWindow();
    await win
      .getByRole('dialog', { name: 'Thiết lập ban đầu' })
      .getByRole('button', { name: 'Đóng' })
      .click({ timeout: 15000 })
      .catch(() => {});
    await win.getByTestId('nav-library').click();
    const library = win.getByTestId('library');
    const rows = library.getByTestId('library-row');
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText('rd_test0025');
    await expect(library).toContainText('1–10 / 26');
    await expect(library.getByRole('button', { name: 'Trang trước', exact: true })).toBeDisabled();
    await win.screenshot({ path: test.info().outputPath('library-table.png') });
    await library.getByRole('button', { name: 'Trang cuối', exact: true }).click();
    await expect(rows).toHaveCount(6);
    await expect(library).toContainText('21–26 / 26');
    await expect(library.getByRole('button', { name: 'Trang sau', exact: true })).toBeDisabled();
    await library.getByLabel('Lọc bản render').selectOption('release');
    await expect(library).toContainText('1–10 / 13');
    await library.getByLabel('Số dòng mỗi trang').selectOption('25');
    await expect(rows).toHaveCount(13);
    await library.getByRole('button', { name: /Ngày hoàn tất/ }).click();
    await expect(rows.first()).toContainText('rd_test0000');
    await library.getByRole('searchbox').fill('rd_test0004');
    await expect(rows).toHaveCount(1);
    await rows.first().getByRole('button', { name: /^Xem / }).click();
    await expect(library.getByRole('dialog').locator('video')).toHaveAttribute(
      'src',
      /rd_test0004/,
    );
    await library.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
    await library.getByRole('searchbox').fill('not-a-video');
    await expect(library).toContainText('Không có video khớp bộ lọc');
    await expect(library).toContainText('0–0 / 0');
    await library.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
    await expect(rows).toHaveCount(25);
    await library.getByRole('tab', { name: 'Shorts', exact: true }).click();
    await expect(rows).toHaveCount(0);
    await library.getByRole('tab', { name: 'Video', exact: true }).click();
    await expect(rows).toHaveCount(25);
    await expect(rows.first().getByRole('button', { name: 'Xuất', exact: true })).toBeEnabled();
  } finally {
    await app.close();
  }
});
