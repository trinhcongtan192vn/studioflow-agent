// 089 — video render phát trong khung xem tệp không dừng sau 1–2 giây: khung xem tải trước siêu dữ liệu
// (preload mặc định), Chromium ngắt yêu cầu Range đầu rồi nối lại; với scheme `sf-media:` không chuẩn lần
// nối lại lỗi `PIPELINE_ERROR_READ` (Tan, vd_rbxtpyp5).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

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

test('a render keeps playing in the file viewer (089)', async () => {
  test.setTimeout(240_000);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sf ui media '));
  const ch = path.join(tmp, 'Kênh thử #1');
  cpSync(fixtureChannel, ch, { recursive: true });
  const rd = path.join(ch, 'videos', 'vd_8m2pq7rt', 'renders', 'rd_media001');
  mkdirSync(rd, { recursive: true });
  const mp4 = path.join(rd, 'video.mp4');
  // 20 s, bitrate cao (nhiều MB) để trình phát phải xin nhiều đoạn Range
  execFileSync(process.env.SF_FFMPEG ?? 'ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440',
    '-t',
    '20',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '12',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    mp4,
  ]);
  expect(statSync(mp4).size).toBeGreaterThan(4 * 1024 * 1024);
  const appData = path.join(tmp, 'app');
  mkdirSync(appData);
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      SF_APP_DATA: appData,
      SF_OPEN_CHANNEL: ch,
      SF_GPU: '0',
      SF_NO_CREDMAN: '1',
      SF_AUTOPILOT: '0',
      // không gọi model; SF_LLM=replay của verify mà thiếu SF_LLM_FIXTURES làm lõi không khởi động
    }).filter(
      (e): e is [string, string] =>
        !['ELECTRON_RUN_AS_NODE', 'SF_LLM'].includes(e[0]) && e[1] !== undefined,
    ),
  );
  const app = await electron.launch({ args: [appDir], cwd: appDir, env });
  try {
    const win = await app.firstWindow();
    // chờ kênh mở sẵn trước (lõi có thể khởi động chậm), rồi mới đóng onboarding nếu có
    const item = win.getByTestId('video-list').locator('li', { hasText: 'Lê Lợi và năm 1428' });
    await expect(item).toBeVisible({ timeout: 120_000 });
    const onboarding = win.getByRole('dialog', { name: 'Thiết lập ban đầu' });
    if (await onboarding.isVisible())
      await onboarding.getByRole('button', { name: 'Đóng' }).click();
    await item.click();
    await win.getByRole('button', { name: 'Tệp', exact: true }).click();
    const files = win.getByTestId('video-files');
    await files.getByRole('button', { name: /renders/ }).click();
    await files.getByRole('button', { name: /rd_media001/ }).click();
    await files.getByRole('button', { name: 'video.mp4' }).click();
    const vid = win.locator('video.viewer-media');
    await vid.waitFor();
    // để khung xem tải trước siêu dữ liệu rồi mới bấm phát (như người dùng)
    await win.waitForTimeout(1500);
    await vid.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
    });
    await win.waitForTimeout(7000);
    const r = await vid.evaluate((v: HTMLVideoElement) => ({
      t: v.currentTime,
      d: v.duration,
      err: v.error?.message ?? null,
    }));
    expect(r.err).toBeNull();
    expect(r.d).toBeCloseTo(20, 0);
    expect(r.t).toBeGreaterThan(5);
  } finally {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
