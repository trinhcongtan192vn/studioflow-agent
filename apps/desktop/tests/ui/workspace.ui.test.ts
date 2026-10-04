// 008 · FR-CH-02/07, FR-WS-02 — vỏ desktop thật (Electron + core trong utilityProcess): mở kênh,
// danh sách video, explorer chỉ đọc, chat với Claude qua phiên `main` (record khi SF_LLM=record,
// replay khi không), lịch sử còn sau khi mở lại, tab Job/Trace.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureChannel = path.resolve(
  appDir,
  '..',
  '..',
  'packages',
  'core',
  'tests',
  'fixtures',
  'domain',
  'channel',
);
const llmFixtures = path.join(appDir, 'tests', 'fixtures', 'llm');

function launch(channel: string, appData: string): Promise<ElectronApplication> {
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      SF_APP_DATA: appData,
      SF_OPEN_CHANNEL: channel,
      SF_GPU: '0',
      SF_NO_CREDMAN: '1',
      SF_LLM: process.env.SF_LLM ?? 'replay',
      SF_LLM_FIXTURES: llmFixtures,
    }).filter((e): e is [string, string] => e[0] !== 'ELECTRON_RUN_AS_NODE' && e[1] !== undefined),
  );
  return electron.launch({ args: [appDir], cwd: appDir, env });
}

test('channel workspace: videos, read-only explorer, chat with history, jobs and traces (008)', async () => {
  test.setTimeout(600_000);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sf-ui-'));
  const channel = path.join(tmp, 'kênh');
  const appData = path.join(tmp, 'app');
  cpSync(fixtureChannel, channel, { recursive: true });
  // index.html tối thiểu để Studio có dự án để mở
  writeFileSync(
    path.join(channel, 'videos', 'vd_8m2pq7rt', 'index.html'),
    '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="1920" data-height="1080"></div></body></html>',
  );
  let app = await launch(channel, appData);
  try {
    const win = await app.firstWindow();
    // onboarding hiện khi app-data trống (thiếu thành phần) → đóng
    const close = win
      .getByRole('dialog', { name: 'Thiết lập ban đầu' })
      .getByRole('button', { name: 'Đóng' });
    await close.click({ timeout: 60_000 }).catch(() => {});
    await expect(win.getByTestId('video-list')).toContainText('Lê Lợi và năm 1428', {
      timeout: 60_000,
    });
    // explorer chỉ đọc: xem nội dung tệp
    // thư mục cấp 1 (videos/) mở sẵn
    await win
      .getByTestId('explorer')
      .getByRole('button', { name: /vd_8m2pq7rt/ })
      .click();
    await win.getByTestId('explorer').getByRole('button', { name: 'SCRIPT.md' }).click();
    await expect(win.getByTestId('file-content')).toContainText('Lê Lợi');
    await win.getByRole('button', { name: 'Đóng' }).click();
    // chọn video → chat với phiên main
    await win
      .getByTestId('video-list')
      .getByRole('button', { name: /Lê Lợi/ })
      .click();
    await win
      .getByTestId('chat-input')
      .fill('Chào bạn, hãy trả lời đúng một câu: video này có bao nhiêu line trong SCRIPT.md?');
    await win.getByTestId('chat-send').click();
    await expect(win.getByTestId('chat-send')).toHaveText('Gửi', { timeout: 300_000 });
    const messages = win.getByTestId('messages');
    await expect(messages.locator('.msg.assistant').last()).toContainText(/3|ba/i);
    // tab Xem trước: Studio nhúng (017 FR-ST-01)
    await win.getByRole('button', { name: 'Xem trước' }).click();
    await win.getByRole('button', { name: 'Mở Studio xem trước' }).click();
    await expect(win.getByTestId('studio')).toHaveAttribute('src', /#project\/vd_8m2pq7rt$/, {
      timeout: 60_000,
    });
    // tab Job / Trace
    await win.getByRole('button', { name: 'Trace' }).click();
    await expect(win.getByTestId('traces')).toContainText('sf.agent.session');
    await win.getByRole('button', { name: 'Job' }).click();
    await expect(win.getByText('Mọi video')).toBeVisible();
    // UI-10 Dung lượng (024) trong Cài đặt
    await win.getByTitle('Cài đặt').click();
    await expect(win.getByLabel('Dung lượng')).toContainText('Ổ đĩa còn', { timeout: 30_000 });
    await expect(win.getByLabel('Dung lượng')).toContainText('Cache');
  } finally {
    await app.close();
  }
  // mở lại: lịch sử chat còn (FR-CH-07)
  app = await launch(channel, appData);
  try {
    const win = await app.firstWindow();
    await win
      .getByRole('dialog', { name: 'Thiết lập ban đầu' })
      .getByRole('button', { name: 'Đóng' })
      .click({ timeout: 60_000 })
      .catch(() => {});
    await win
      .getByTestId('video-list')
      .getByRole('button', { name: /Lê Lợi/ })
      .click({ timeout: 60_000 });
    await expect(win.getByTestId('messages').locator('.msg.user').first()).toContainText(
      'bao nhiêu line',
    );
  } finally {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
