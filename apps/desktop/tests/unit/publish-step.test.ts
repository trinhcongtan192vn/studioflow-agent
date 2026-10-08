// 091 · FR-UI-91-05 — bước "Đăng lên nền tảng" chờ người dùng chọn: không hiện như lỗi, nút mở bộ chọn, chữ kết quả.
import { describe, expect, it } from 'vitest';
import { friendlyStepError, isPublishWaiting, stepCtas } from '../../src/renderer/chat-format';
import { stepButtons } from '../../src/renderer/progress-format';
import { pickerSummary, publishResultText } from '../../src/renderer/publish-format';

const WAIT =
  'choose the platforms in the Progress tab and press "Đăng" — waiting for you to choose where to publish';

describe('publish step UI (091)', () => {
  it('a waiting publish step reads as a choice, not an error', () => {
    expect(isPublishWaiting(WAIT)).toBe(true);
    expect(isPublishWaiting('E_PROVIDER_FAILED YouTube: lỗi')).toBe(false);
    expect(friendlyStepError(WAIT)).toMatch(/Chọn nền tảng/);
    expect(stepCtas({ id: 'publish', status: 'failed' }, [], WAIT)).toEqual([
      { kind: 'tab', label: '📤 Chọn nền tảng', tab: 'Tiến độ' },
    ]);
    const s = { id: 'publish', title: 'Đăng lên nền tảng', status: 'failed' };
    // bộ chọn trong thẻ bước thay cho nút Chạy lại / Quay lại
    expect(stepButtons(s, [s], WAIT)).toEqual([]);
  });

  it('result text per platform', () => {
    expect(publishResultText({ status: 'public' })).toBe('Đã công khai');
    expect(publishResultText({ status: 'private', note: 'Chỉ mình tôi — mở app TikTok' })).toBe(
      'Riêng tư — Chỉ mình tôi — mở app TikTok',
    );
    expect(publishResultText({ status: 'failed', error: 'hết quota' })).toBe('Lỗi: hết quota');
    expect(publishResultText({ status: 'uploading' })).toBe('Đang tải lên…');
  });

  it('picker summary names the chosen platforms', () => {
    expect(pickerSummary([])).toBe('Chưa chọn nền tảng nào');
    expect(pickerSummary(['YouTube', 'Facebook'])).toBe('Đăng lên YouTube, Facebook');
  });
});
