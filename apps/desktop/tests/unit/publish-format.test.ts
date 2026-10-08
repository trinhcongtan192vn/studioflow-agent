// 074 — màn Duyệt trước khi đăng: chữ trạng thái từng nền tảng và nút được phép.
import { describe, expect, it } from 'vitest';
import { platformActions, platformState } from '../../src/renderer/publish-format';

const now = Date.parse('2026-10-08T08:00:00Z'); // 15:00 giờ VN
const TZ = 'Asia/Ho_Chi_Minh';

describe('platformState (074)', () => {
  it('describes each publish status in Vietnamese', () => {
    expect(platformState(undefined, '2026-10-08T19:00:00+07:00', now, TZ)).toEqual({
      tone: 'idle',
      text: 'Chờ tải lên · đăng 19:00 08/10',
    });
    expect(
      platformState(
        {
          status: 'scheduled',
          veto_until: '2026-10-08T17:00:00+07:00',
          publish_at: '2026-10-08T19:00:00+07:00',
        },
        null,
        now,
        TZ,
      ),
    ).toEqual({ tone: 'warn', text: 'Chờ phản đối đến 17:00 08/10 · công khai 19:00 08/10' });
    expect(
      platformState(
        { status: 'scheduled', publish_at: '2026-10-08T19:00:00+07:00' },
        null,
        now,
        TZ,
      ),
    ).toEqual({
      tone: 'ok',
      text: 'Đã hẹn công khai 19:00 08/10',
    });
    expect(platformState({ status: 'private' }, null, now, TZ).text).toMatch(/Riêng tư/);
    expect(platformState({ status: 'public' }, null, now, TZ)).toEqual({
      tone: 'ok',
      text: 'Đã công khai',
    });
    expect(platformState({ status: 'failed', error: 'hết hạn mức' }, null, now, TZ)).toEqual({
      tone: 'error',
      text: 'Lỗi: hết hạn mức',
    });
    expect(
      platformState({ status: 'cancelled', note: 'Bỏ qua Reels: video ngang' }, null, now, TZ).text,
    ).toBe('Bỏ qua Reels: video ngang');
  });
});

describe('platformActions (074)', () => {
  it('publish now only after upload; cancel until public or cancelled', () => {
    expect(platformActions(undefined)).toEqual({ now: false, cancel: false });
    expect(platformActions({ status: 'pending' })).toEqual({ now: false, cancel: true });
    expect(platformActions({ status: 'scheduled' })).toEqual({ now: true, cancel: true });
    expect(platformActions({ status: 'private' })).toEqual({ now: true, cancel: true });
    expect(platformActions({ status: 'public' })).toEqual({ now: false, cancel: false });
    expect(platformActions({ status: 'cancelled' })).toEqual({ now: false, cancel: false });
  });
});
