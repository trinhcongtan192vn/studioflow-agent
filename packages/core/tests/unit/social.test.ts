// 056 · FR-AP-10 — dạng dọc 9:16, tên bí mật token, thử lại có lùi.
import { describe, expect, it } from 'vitest';
import { SfError } from '../../src/errors.js';
import { isVerticalProfile, socialTokenSecret, withRetry } from '../../src/publish/social.js';
import { SECRET_NAME } from '../../src/secrets/store.js';

describe('isVerticalProfile', () => {
  it('reads <w>x<h> from the id; falls back to well-known names', () => {
    expect(isVerticalProfile('yt-shorts-1080x1920')).toBe(true);
    expect(isVerticalProfile('yt-1080p30')).toBe(false);
    expect(isVerticalProfile('custom-1920x1080')).toBe(false);
    expect(isVerticalProfile('custom-1080x1080')).toBe(false);
    expect(isVerticalProfile('my-vertical')).toBe(true);
    expect(isVerticalProfile('yt-4k')).toBe(false);
  });
});

describe('socialTokenSecret', () => {
  it('oauth:<platform>:<channel_id>, valid secret name', () => {
    expect(socialTokenSecret('tiktok', 'ch_ab12cd34')).toBe('oauth:tiktok:ch_ab12cd34');
    expect(SECRET_NAME.test(socialTokenSecret('facebook', 'ch_ab12cd34'))).toBe(true);
  });
});

describe('withRetry', () => {
  it('backs off 1,2,4,8 s then gives up; SfError is not retried; success returns value', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);
    let n = 0;
    await expect(
      withRetry<number>(sleep, async () => (n++, { retry: true, why: 'x: HTTP 503' })),
    ).rejects.toMatchObject({ code: 'E_PROVIDER_FAILED' });
    expect(n).toBe(5);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
    let m = 0;
    await expect(
      withRetry<number>(sleep, async () => {
        m++;
        throw new SfError('E_PERMISSION_DECLINED', 'no');
      }),
    ).rejects.toMatchObject({ code: 'E_PERMISSION_DECLINED' });
    expect(m).toBe(1);
    let k = 0;
    expect(
      await withRetry<number>(sleep, async () =>
        k++ < 2 ? { retry: true, why: 'x' } : { value: 7 },
      ),
    ).toBe(7);
  });
});
