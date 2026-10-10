// 008 · FR-CH-02/07, FR-WS-02 — vỏ desktop thật (Electron + core trong utilityProcess): mở kênh,
// danh sách video, explorer chỉ đọc, chat với Claude qua phiên `main` (record khi SF_LLM=record,
// replay khi không), lịch sử còn sau khi mở lại, tab Job/Trace.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      SF_AUTOPILOT: '0',
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
  // 008: câu mẫu giọng (wav 2 s, 24 kHz mono) để thử trình phát trong app
  const sr = 24000;
  const n = sr * 2;
  const wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + n * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sr, 24);
  wav.writeUInt32LE(sr * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 8000), 44 + i * 2);
  mkdirSync(path.join(channel, 'voices', 'vo_c3z8p1mn'), { recursive: true });
  writeFileSync(path.join(channel, 'voices', 'vo_c3z8p1mn', 'ref.wav'), wav);
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
    // 008: kéo thanh chia đổi độ rộng sidebar và khung tab phải; nhấp đúp về mặc định
    const left = win.locator('aside.left');
    const w0 = (await left.boundingBox())!.width;
    const sp = (await win.getByTestId('splitter-left').boundingBox())!;
    await win.mouse.move(sp.x + sp.width / 2, sp.y + 200);
    await win.mouse.down();
    await win.mouse.move(sp.x + sp.width / 2 + 80, sp.y + 200, { steps: 5 });
    await win.mouse.up();
    expect((await left.boundingBox())!.width).toBeCloseTo(w0 + 80, -1);
    await win.getByTestId('splitter-left').dblclick();
    expect((await left.boundingBox())!.width).toBeCloseTo(260, -1);
    const right = win.locator('aside.right');
    const r0 = (await right.boundingBox())!.width;
    await win.getByTestId('splitter-right').focus();
    await win.keyboard.press('Shift+ArrowLeft');
    expect((await right.boundingBox())!.width).toBeCloseTo(r0 + 64, -1);
    await win.getByTestId('splitter-right').dblclick();
    // tạo video mới bằng ô nhập ngay trong danh sách (Electron không có window.prompt)
    await win.getByTestId('new-video').click();
    await win.getByPlaceholder('Tên video tạm (có thể đổi sau)').fill('Lốc xoáy vòi rồng');
    await win.getByPlaceholder('Tên video tạm (có thể đổi sau)').press('Enter');
    await expect(win.getByTestId('video-list')).toContainText('Lốc xoáy vòi rồng', {
      timeout: 30_000,
    });
    // 064: xóa video vào thùng rác rồi khôi phục
    const item = win.getByTestId('video-list').locator('li', { hasText: 'Lốc xoáy vòi rồng' });
    await item.hover();
    await item.getByTestId('delete-video').click();
    await win
      .getByTestId('delete-confirm')
      .getByRole('button', { name: 'Xóa', exact: true })
      .click();
    await expect(win.getByTestId('video-list')).not.toContainText('Lốc xoáy vòi rồng');
    await win.getByTestId('open-trash').click();
    const trashDlg = win.getByTestId('trash-dialog');
    await expect(trashDlg).toContainText('Lốc xoáy vòi rồng');
    await trashDlg.getByRole('button', { name: 'Khôi phục' }).click();
    await expect(win.getByTestId('video-list')).toContainText('Lốc xoáy vòi rồng');
    await trashDlg.getByRole('button', { name: 'Đóng' }).click();
    // 066: xuất video từ tab Xem trước — video chưa render thì hộp thoại nói rõ
    await item.getByRole('button', { name: /Lốc xoáy vòi rồng/ }).click();
    await win.getByRole('button', { name: 'Xem trước', exact: true }).click();
    await win.getByTestId('open-export').click();
    await expect(win.getByTestId('export-empty')).toBeVisible();
    await win.getByTestId('export-dialog').getByRole('button', { name: 'Đóng' }).click();
    await win.getByRole('button', { name: 'Tiến độ', exact: true }).click();
    // 048: mở thẳng giao diện chính; bộ chọn kênh hiện kênh đang mở (Manual)
    await expect(win.getByTestId('channel-switcher')).toContainText('Manual');
    // explorer chỉ đọc (048: trong "Chi tiết kênh"): xem nội dung tệp
    // thư mục cấp 1 (videos/) mở sẵn
    await win.getByTestId('open-channel-details').click();
    await win
      .getByTestId('explorer')
      .getByRole('button', { name: /vd_8m2pq7rt/ })
      .click();
    await win.getByTestId('explorer').getByRole('button', { name: 'SCRIPT.md' }).click();
    await expect(win.getByTestId('file-content')).toContainText('Lê Lợi');
    // 008: md hiển thị dạng đọc — line có người nói, chú thích kỹ thuật ẩn
    await expect(win.getByTestId('file-content').locator('.script-line')).toHaveCount(3);
    await expect(win.getByTestId('file-content')).not.toContainText('sf:line');
    await win.getByRole('button', { name: 'Đóng' }).last().click();
    // 008: phát âm thanh trong app (explorer → wav)
    await win
      .getByTestId('explorer')
      .getByRole('button', { name: /vo_c3z8p1mn/ })
      .click();
    await win.getByTestId('explorer').getByRole('button', { name: 'ref.wav' }).click();
    const player = win.getByTestId('audio-player');
    await player.getByRole('button', { name: /^Phát/ }).click();
    await expect(player.getByTestId('audio-time')).toContainText('/ 0:02', { timeout: 15_000 });
    await expect(player.getByRole('button', { name: 'Tạm dừng' })).toBeVisible();
    await win.getByRole('button', { name: 'Đóng' }).last().click();
    await win
      .getByRole('dialog', { name: 'Chi tiết kênh' })
      .getByRole('button', { name: 'Đóng' })
      .click();
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
    // chỉ báo "đang xử lý" tắt khi agent trả lời xong
    await expect(win.getByTestId('activity')).toHaveCount(0);
    const messages = win.getByTestId('messages');
    await expect(messages.locator('.msg.assistant').last()).toContainText(/3|ba/i);
    // 048 (FR-AP-14): lịch sử phiên — phiên chat vừa rồi xem lại được
    await expect(win.getByTestId('recent-sessions')).toContainText('Chat', { timeout: 15_000 });
    await win.getByTestId('open-session-history').click();
    const hist = win.getByTestId('session-history');
    await hist.getByTestId('session-list').getByRole('button', { name: /Chat/ }).first().click();
    await expect(hist.getByTestId('session-view')).toContainText('bao nhiêu line');
    await hist.getByRole('button', { name: 'Đóng' }).click();
    // 008: approval đang chờ (agent xin duyệt khi chat chưa mở) → thẻ ghim ở đáy khung chat, có nút xem file
    const statePath = path.join(channel, 'videos', 'vd_8m2pq7rt', 'state.json');
    const st = JSON.parse(readFileSync(statePath, 'utf8'));
    st.approvals = [];
    st.approvals.push({
      id: 'ap_p3nd1ng0',
      step_id: 'script',
      status: 'pending',
      requested_at: '2026-10-03T11:00:00+07:00',
      artifact_hashes: { 'SCRIPT.md': '0'.repeat(64) },
    });
    writeFileSync(statePath, JSON.stringify(st, null, 2));
    await win
      .getByTestId('video-list')
      .getByRole('button', { name: /Lốc xoáy/ })
      .click();
    await win
      .getByTestId('video-list')
      .getByRole('button', { name: /Lê Lợi/ })
      .click();
    const dock = win.getByTestId('approval-dock');
    await expect(dock).toContainText('Kịch bản', { timeout: 30_000 });
    await dock.getByRole('button', { name: 'Xem kịch bản' }).click();
    await expect(win.getByTestId('file-content').locator('.script-line')).toHaveCount(3);
    await win.getByRole('button', { name: 'Đóng' }).click();
    // tab Xem trước: Studio nhúng (017 FR-ST-01)
    await win.getByRole('button', { name: 'Xem trước' }).click();
    await win.getByRole('button', { name: 'Mở Studio xem trước' }).click();
    await expect(win.getByTestId('studio')).toHaveAttribute('src', /#project\/vd_8m2pq7rt$/, {
      timeout: 60_000,
    });
    // FR-CH-04 (028): mốc đầu phát của Studio → chip ngữ cảnh trên ô chat (WebMCP qua postMessage)
    await win.getByRole('button', { name: 'Đính kèm mốc hiện tại' }).click();
    await expect(win.getByTestId('context-chips')).toContainText(/Mốc \d+\.\d{2} s/, {
      timeout: 60_000,
    });
    // UI-11 bảng caption dưới khung xem trước (026): audio xem trước qua sf-media:, sửa chữ → tự lưu
    const captions = win.getByTestId('captions');
    await expect(captions.getByTestId('cg-cg_m1x8d0rq')).toBeVisible({ timeout: 30_000 });
    const dur = await captions
      .locator('audio')
      .evaluate(
        (a: HTMLAudioElement) =>
          new Promise<number>((r) =>
            a.readyState >= 1
              ? r(a.duration)
              : a.addEventListener('loadedmetadata', () => r(a.duration)),
          ),
      );
    expect(dur).toBeCloseTo(2.7, 1);
    await captions.getByTestId('cg-cg_m1x8d0rq').click();
    await captions.getByLabel('Chữ hiển thị').fill('Năm 1428 — sửa tay');
    await expect(captions).toContainText('Đã lưu caption.', { timeout: 10_000 });
    const ov = JSON.parse(
      readFileSync(path.join(channel, 'videos', 'vd_8m2pq7rt', 'caption-overrides.json'), 'utf8'),
    );
    expect(ov.groups.cg_m1x8d0rq).toEqual({ end_ms: 1300, text: 'Năm 1428 — sửa tay' });
    // 072: tab Tệp — thư mục của video đang mở
    await win.getByRole('button', { name: 'Tệp', exact: true }).click();
    await expect(win.getByTestId('video-files')).toContainText('SCRIPT.md');
    // 072: đầu trang video có nút Xuất video
    await expect(win.getByTestId('head-export')).toBeVisible();
    // UI-12 Chi phí (028) — 072: trong tab Kỹ thuật cùng Job / Trace
    await win.getByRole('button', { name: 'Kỹ thuật', exact: true }).click();
    await win.getByRole('tab', { name: 'Chi phí' }).click();
    await expect(win.getByTestId('cost')).toContainText('Tổng');
    // tab Job / Trace
    await win.getByRole('tab', { name: 'Trace' }).click();
    await expect(win.getByTestId('traces')).toContainText('sf.agent.session');
    await win.getByRole('tab', { name: 'Job' }).click();
    await expect(win.getByText('Mọi video')).toBeVisible();
    // 008: tab Tiến độ — trạng thái tổng; "Quay lại" hỏi xác nhận rồi báo kết quả
    await win.getByRole('button', { name: 'Tiến độ' }).click();
    const progress = win.getByTestId('progress');
    await expect(progress).toContainText('/1 bước');
    await expect(win.getByTestId('progress-now')).toContainText(/Sẵn sàng|Chờ bạn duyệt/);
    // 034: "Tự duyệt bước" bật mặc định; tắt được ngay trong tab
    await expect(win.getByTestId('autopilot')).toContainText('Tự duyệt bước');
    await win.getByTestId('autopilot').click();
    await expect(win.getByTestId('autopilot')).toContainText('Duyệt từng bước');
    await expect(win.getByTestId('progress-feedback')).toContainText('Đã tắt Tự duyệt bước');
    // 088: nút "Nâng cao" thấy ngay ở đầu tab; mở bảng, đặt riêng cho video
    await expect(win.getByTestId('advanced-toggle')).toContainText('Nâng cao: tắt hết');
    await win.getByTestId('advanced-toggle').click();
    await expect(win.getByTestId('advanced')).toContainText('Frame tùy biến bằng AI');
    await win.getByTestId('adv-music').getByRole('combobox').selectOption('on');
    await expect(win.getByTestId('advanced-toggle')).toContainText('Nâng cao: Nhạc nền');
    // 092: đổi model mạnh khi Kịch bản đã xong → gợi ý chạy lại từ Kịch bản; đổi về như cũ → hết gợi ý
    await win.getByTestId('adv-reasoning').getByRole('combobox').selectOption('on');
    await expect(win.getByTestId('adv-rerun')).toContainText('Chạy lại từ "Kịch bản"');
    // Nhạc nền đổi ở trên cũng được nêu (video mẫu chưa có bước nhạc nên không quyết định bước)
    await expect(win.getByTestId('adv-rerun')).toContainText('Đã đổi: Nhạc nền, Model mạnh');
    await win.getByTestId('adv-reasoning').getByRole('combobox').selectOption('inherit');
    await expect(win.getByTestId('adv-rerun')).toHaveCount(0);
    await win.getByTestId('advanced-toggle').click();
    await expect(win.getByTestId('advanced')).toHaveCount(0);
    const scriptRow = progress.getByTestId('step-script');
    await scriptRow.hover();
    await scriptRow.getByRole('button', { name: 'Quay lại' }).click();
    await expect(win.getByTestId('progress-confirm')).toContainText('Quay lại và chạy lại từ bước');
    await win.getByTestId('progress-confirm').getByRole('button', { name: 'Xác nhận' }).click();
    await expect(win.getByTestId('progress-feedback')).toContainText('Đã quay lại bước', {
      timeout: 15_000,
    });
    // UI-10 Dung lượng (024) trong Cài đặt
    await win.getByTitle('Cài đặt app').click();
    // 068: Cài đặt là trang — vùng video tạm ẩn, thanh điều hướng đánh dấu mục đang mở
    await expect(win.getByRole('region', { name: 'Cài đặt' })).toBeVisible();
    await expect(win.getByTestId('video-list')).toBeHidden();
    await expect(win.getByLabel('Dung lượng')).toContainText('Ổ đĩa còn', { timeout: 30_000 });
    await expect(win.getByLabel('Dung lượng')).toContainText('Cache');
    await expect(win.getByTestId('autopilot-app')).toContainText('Khung giờ máy làm việc');
    // 052: chạy nền khi đóng cửa sổ — bật mặc định
    await expect(win.getByTestId('autopilot-background')).toBeChecked();
    // 076: ngân sách Claude/ngày đặt tay được
    await expect(win.getByTestId('daily-tokens')).toBeVisible();
    // 083: đủ ba vai model text
    for (const r of ['producer', 'critic', 'aux'])
      await expect(win.getByTestId(`model-${r}`)).toBeAttached();
    // 071: Cài đặt chia mục; Telegram ở mục Kết nối
    await win
      .getByRole('navigation', { name: 'Mục cài đặt' })
      .getByRole('button', { name: 'Kết nối' })
      .click();
    await expect(win.getByTestId('telegram-settings')).toContainText('Bot token');
    await win.getByRole('button', { name: 'Đóng', exact: true }).last().click();
    await expect(win.getByTestId('video-list')).toBeVisible();
    // 047 (FR-AP-01/02): cài đặt kênh → bật Autopilot → trang chủ hiện kênh quản lý ở chế độ Autopilot
    await win.getByTestId('channel-switcher-toggle').click();
    await win.getByTestId('open-channel-settings').click();
    const cs = win.getByTestId('channel-settings');
    await expect(cs).toContainText('Kênh đối thủ');
    // 082: ngôn ngữ mặc định của kênh
    await expect(cs.getByTestId('channel-language')).toHaveValue('vi');
    // 071: kết nối tài khoản đăng video theo kênh
    await expect(cs.getByTestId('channel-connections')).toContainText('YouTube');
    await expect(cs.getByTestId('youtube-connect')).toBeVisible();
    await cs.getByTestId('mode-autopilot').check();
    await expect(cs).toContainText('Đã bật Autopilot cho kênh.');
    await cs.getByRole('button', { name: 'Đóng', exact: true }).click();
    // 048: không còn trang chủ riêng — bộ chọn kênh và "Quản lý tất cả kênh" hiện chế độ Autopilot
    await expect(win.getByTestId('channel-switcher')).toContainText('Autopilot');
    await win.getByTestId('channel-switcher-toggle').click();
    await win.getByRole('menuitem', { name: 'Quản lý tất cả kênh…' }).click();
    await expect(win.getByTestId('managed-channels')).toContainText('Autopilot');
    // 068: các màn mở như trang của khung app (không chồng hộp thoại)
    await expect(win.getByRole('region', { name: 'Quản lý kênh' })).toBeVisible();
    await win.getByTestId('channels-overview').getByRole('button', { name: 'Đóng' }).last().click();
    // 052: màn Autopilot hôm nay — trạng thái + kênh Autopilot (chưa lập kế hoạch)
    await win.getByTestId('open-autopilot').click();
    const ap = win.getByTestId('autopilot-panel');
    await expect(ap.getByTestId('autopilot-status')).toBeVisible();
    await expect(ap.getByTestId('autopilot-channel')).toContainText('chưa lập kế hoạch');
    await ap.getByRole('button', { name: 'Đóng' }).click();
    // 073: Thư viện (kênh mẫu chưa render) và bảng lệnh Ctrl+K
    await win.getByTestId('nav-library').click();
    await expect(win.getByTestId('library')).toContainText('Chưa có bản render nào');
    // 074: Duyệt trước khi đăng (kênh mẫu chưa có video Autopilot)
    await win.getByTestId('open-autopilot').click();
    await win.getByRole('tab', { name: 'Duyệt trước khi đăng' }).click();
    await expect(win.getByTestId('publish-review')).toContainText('Chưa có video nào chờ đăng');
    // 075: Tổng quan kênh — số video theo trạng thái, lối tắt
    await win.getByTestId('nav-overview').click();
    const overview = win.getByTestId('channel-overview');
    await expect(overview.getByTestId('overview-stat')).toHaveCount(4);
    await expect(overview).toContainText('Chưa kết nối');
    await win.keyboard.press('Control+K');
    await win.getByTestId('palette').getByRole('textbox').fill('le loi');
    await win.keyboard.press('Enter');
    await expect(win.getByTestId('video-list')).toBeVisible();
    await expect(win.locator('.video-head')).toContainText('Lê Lợi');
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
