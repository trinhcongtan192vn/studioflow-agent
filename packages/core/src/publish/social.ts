import { SfError } from '../errors.js';
import { jsonOf, sleepMs, type HttpFetch } from './http.js';

/** Dùng chung cho TikTok/Facebook (056): tên bí mật, dạng dọc 9:16, thử lại có lùi. */

export type SocialPlatform = 'tiktok' | 'facebook';

/** Tên bí mật token của kênh StudioFlow (D5 5.4): `oauth:tiktok:<channel_id>` / `oauth:facebook:<channel_id>`. */
export const socialTokenSecret = (platform: SocialPlatform, channelId: string): string =>
  `oauth:${platform}:${channelId}`;

/**
 * Hồ sơ xuất dọc 9:16 không? Đọc `<rộng>x<cao>` trong id (ví dụ `yt-shorts-1080x1920`), không có thì nhận các
 * tên `shorts`/`vertical`/`9x16`. Chỉ video dọc được đăng lên TikTok và Facebook Reels.
 */
export function isVerticalProfile(profile: string): boolean {
  const m = /(\d{3,5})x(\d{3,5})/.exec(profile);
  if (m) return Number(m[2]) > Number(m[1]);
  return /shorts|vertical|9x16|reels|tiktok/i.test(profile);
}

export const SOCIAL_RETRY = { RETRIES: 4, BACKOFF_MS: [1000, 2000, 4000, 8000] } as const;

/** Gọi `fn` thử lại khi lỗi mạng/5xx/429 (trả `retry`); lỗi còn lại ném ra ngay. */
export async function withRetry<T>(
  sleep: (ms: number) => Promise<void> | undefined,
  fn: () => Promise<{ retry: true; why: string } | { retry?: false; value: T }>,
): Promise<T> {
  let last = '';
  for (let i = 0; i <= SOCIAL_RETRY.RETRIES; i++) {
    const r = await fn().catch((e: unknown) => {
      if (e instanceof SfError) throw e;
      return { retry: true as const, why: 'không kết nối được' };
    });
    if (!r.retry) return r.value;
    last = r.why;
    if (i < SOCIAL_RETRY.RETRIES) await (sleep(SOCIAL_RETRY.BACKOFF_MS[i]!) ?? Promise.resolve());
  }
  throw new SfError('E_PROVIDER_FAILED', `${last} (đã thử lại ${SOCIAL_RETRY.RETRIES} lần)`);
}

export const retryable = (status: number): boolean => status === 429 || status >= 500;

export { jsonOf, sleepMs };
export type { HttpFetch };
