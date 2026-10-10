// 096 AC-01..04: real Electron + core + files; cached research, no external inference.
import { _electron as electron, expect, test } from '@playwright/test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('096 Autopilot previews a disabled channel, reports completion and merges publish review', async () => {
  test.setTimeout(120_000);
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const fixtures = path.resolve(appDir, '../../packages/core/tests/fixtures');
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sf-ap-ui-'));
  const channel = path.join(tmp, 'channel');
  const appData = path.join(tmp, 'app');
  cpSync(path.join(fixtures, 'domain/channel'), channel, { recursive: true });
  mkdirSync(appData);
  const metaFile = path.join(channel, 'channel.json');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  meta.config = {
    ...meta.config,
    'autopilot.enabled': false,
    'autopilot.max_per_day': 1,
    'autopilot.min_score': 0,
    'publish.slots': ['12:00', '19:00'],
  };
  writeFileSync(metaFile, JSON.stringify(meta));
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date()),
  );
  writeFileSync(
    path.join(appData, 'settings.json'),
    JSON.stringify({
      schema_version: 1,
      installed: { profile: 'minimal', components: [] },
      provider_fallbacks: {},
      network: { allow: [] },
      pricing: [],
      trace: { capture_content: true, retention_days: 30, phoenix_enabled: false },
      config: {
        'autopilot.paused': true,
        'autopilot.daily_tokens': 100000000,
        'autopilot.work_window': `${String(hour).padStart(2, '0')}:00-${String((hour + 23) % 24).padStart(2, '0')}:59`,
      },
      recent_channels: [],
      managed_channels: [{ path: channel, added_at: new Date().toISOString() }],
    }),
  );
  mkdirSync(path.join(channel, 'research'), { recursive: true });
  const research = JSON.parse(
    readFileSync(path.join(fixtures, 'research/research-doc.json'), 'utf8'),
  );
  research.date = date;
  writeFileSync(path.join(channel, 'research', `${date}.json`), JSON.stringify(research));
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
    const onboardingClose = win
      .getByRole('dialog', { name: 'Thiết lập ban đầu' })
      .getByRole('button', { name: 'Đóng' });
    await onboardingClose.click({ timeout: 15_000 }).catch(() => {});
    await win.getByTestId('open-autopilot').click();
    const panel = win.getByTestId('autopilot-panel');
    await expect(
      panel.getByRole('button', { name: 'Lập lại kế hoạch', exact: true }),
    ).toBeDisabled();
    const row = panel.getByTestId('autopilot-channel');
    await expect(row).toContainText(meta.name);
    await row.getByRole('button', { name: 'Xem thử kế hoạch', exact: true }).click();
    await expect(panel).toContainText('Đã xem thử', { timeout: 30_000 });
    await expect(row).toContainText('Bản xem thử');
    await expect(row.locator('.ap-item')).toHaveCount(1);
    await expect(row.getByRole('button', { name: 'Tạo video', exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Xóa', exact: true }).click();
    await expect(row.locator('.ap-item')).toHaveCount(0);
    expect(existsSync(path.join(channel, 'autopilot/plans', `${date}.json`))).toBe(false);
    await row.getByRole('button', { name: 'Xem thử kế hoạch', exact: true }).click();
    await expect(row.locator('.ap-item')).toHaveCount(1);
    await win.screenshot({ path: test.info().outputPath('autopilot-preview.png') });
    expect(existsSync(path.join(channel, 'autopilot/plans', `${date}.json`))).toBe(false);
    expect(JSON.parse(readFileSync(metaFile, 'utf8')).config['autopilot.enabled']).toBe(false);
    const toggle = row.getByRole('checkbox');
    await toggle.click();
    await expect(toggle).toBeChecked();
    await panel.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(panel).toContainText('Đã tiếp tục.');
    await panel.getByRole('button', { name: 'Lập lại kế hoạch', exact: true }).click();
    await expect(panel).toContainText('Đã lập kế hoạch', { timeout: 30_000 });
    expect(existsSync(path.join(channel, 'autopilot/plans', `${date}.json`))).toBe(true);
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    // Produced content remains reviewable after disabling its channel.
    const planFile = path.join(channel, 'autopilot/plans', `${date}.json`);
    const saved = JSON.parse(readFileSync(planFile, 'utf8'));
    saved.items[0].status = 'produced';
    saved.items[0].video_id = 'vd_8m2pq7rt';
    saved.items[0].platforms = ['youtube'];
    saved.items[0].publish = { youtube: { status: 'private', video_id: 'fixture' } };
    writeFileSync(planFile, JSON.stringify(saved));
    await panel.getByRole('tab', { name: 'Duyệt trước khi đăng' }).click();
    await expect(panel.getByTestId('publish-item')).toHaveCount(1);
    await expect(panel.getByRole('button', { name: 'Đăng ngay', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Hủy đăng', exact: true })).toBeVisible();
    await expect(panel).toContainText('Autopilot đang tắt');
    await win.getByTestId('nav-video').click();
    await win.getByTestId('open-autopilot').click();
    await panel.getByRole('tab', { name: 'Kế hoạch & kênh' }).click();
    await expect(row.getByRole('button', { name: 'Tạo video', exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Xóa', exact: true })).toHaveCount(0);
    // Real row CTAs: delete one topic and transfer another to a manual video.
    const withActions = JSON.parse(readFileSync(planFile, 'utf8'));
    const unstarted = {
      ...withActions.items[0],
      status: 'planned',
      video_id: undefined,
      publish: undefined,
    };
    withActions.items.push(
      { ...unstarted, id: 'pi_delete01', candidate_id: 'test:delete', title: 'Mục cần xóa' },
      { ...unstarted, id: 'pi_manual01', candidate_id: 'test:manual', title: 'Mục tạo thủ công' },
    );
    writeFileSync(planFile, JSON.stringify(withActions));
    const updatedMeta = JSON.parse(readFileSync(metaFile, 'utf8'));
    updatedMeta.language = 'de';
    writeFileSync(metaFile, JSON.stringify(updatedMeta));
    await win.getByTestId('nav-video').click();
    await win.getByTestId('open-autopilot').click();
    const deletedRow = row.locator('.ap-item').filter({ hasText: 'Mục cần xóa' });
    await deletedRow.getByRole('button', { name: 'Xóa', exact: true }).click();
    await expect(panel.locator('.success[role="status"]')).toContainText('Đã xóa');
    await expect(deletedRow).toHaveCount(0);
    expect(
      JSON.parse(readFileSync(planFile, 'utf8')).items.find(
        (i: { id: string }) => i.id === 'pi_delete01',
      ).status,
    ).toBe('skipped');
    const manualRow = row.locator('.ap-item').filter({ hasText: 'Mục tạo thủ công' });
    await manualRow.getByRole('button', { name: 'Tạo video', exact: true }).click();
    await expect(panel).toHaveCount(0);
    const transferred = JSON.parse(readFileSync(planFile, 'utf8')).items.find(
      (i: { id: string }) => i.id === 'pi_manual01',
    );
    expect(transferred.status).toBe('skipped');
    expect(transferred.video_id).toMatch(/^vd_/);
    expect(
      readFileSync(path.join(channel, 'videos', transferred.video_id, 'BRIEF.md'), 'utf8'),
    ).toContain('language: de');
    expect(
      JSON.parse(
        readFileSync(path.join(channel, 'videos', transferred.video_id, 'state.json'), 'utf8'),
      ).autopilot,
    ).toBeUndefined();
    await win.getByTestId('open-autopilot').click();
    await expect(manualRow).toContainText('Tạo thủ công');
    await expect(manualRow.getByRole('button', { name: 'Mở video', exact: true })).toBeVisible();
    await expect(manualRow.getByRole('button', { name: 'Tạo video', exact: true })).toHaveCount(0);
    await expect(win.getByTestId('nav-publish')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
