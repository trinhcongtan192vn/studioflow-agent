// Giới hạn đăng chính thức (publish/limits.ts): file đạt chuẩn đăng được mọi nơi; vượt thời lượng / GOP dài /
// sai pixel format bị nêu đúng nền tảng; trần thời lượng sớm theo nền tảng đích của kênh.
import { describe, expect, it } from 'vitest';
import {
  PLATFORM_LIMITS,
  platformMaxSeconds,
  publishProblems,
  type MediaInfo,
} from '../../src/publish/limits.js';

const ok: MediaInfo = {
  duration_ms: 60_000,
  width: 1080,
  height: 1920,
  fps: 30,
  vcodec: 'h264',
  pix_fmt: 'yuv420p',
  acodec: 'aac',
  sample_rate: 48000,
  channels: 2,
  bytes: 20 * 1024 ** 2,
  max_gop_s: 2,
};

describe('publishProblems', () => {
  it('a standard 60 s vertical H.264 render is accepted everywhere', () => {
    for (const p of ['youtube', 'facebook', 'tiktok'] as const)
      expect(publishProblems(p, ok), p).toEqual([]);
  });

  it('Facebook Reels: 3–90 s and closed GOP ≤ 5 s', () => {
    expect(publishProblems('facebook', { ...ok, duration_ms: 120_000 })[0]).toMatch(/3–90 s/);
    expect(publishProblems('facebook', { ...ok, duration_ms: 2_000 })[0]).toMatch(/3–90 s/);
    expect(publishProblems('facebook', { ...ok, max_gop_s: 8.3 })[0]).toMatch(/keyframe 8.3 s/);
    expect(
      publishProblems('facebook', { ...ok, duration_ms: 120_000 }, { ignoreDuration: true }),
    ).toEqual([]);
  });

  it('TikTok: the account limit from creator_info applies; horizontal is refused', () => {
    expect(
      publishProblems('tiktok', { ...ok, duration_ms: 200_000 }, { maxSeconds: 180 })[0],
    ).toMatch(/vượt 180 s/);
    expect(publishProblems('tiktok', { ...ok, width: 1920, height: 1080 }).join()).toMatch(/dọc/);
  });

  it('any platform: non-4:2:0 pixel format is reported', () => {
    expect(publishProblems('youtube', { ...ok, pix_fmt: 'yuv444p' })[0]).toMatch(/yuv420p/);
  });
});

describe('platformMaxSeconds', () => {
  it('the shortest cap among the channel platforms wins; YouTube only → no extra cap', () => {
    expect(platformMaxSeconds(['youtube'])).toBeUndefined();
    expect(platformMaxSeconds(['youtube', 'tiktok'])).toEqual({
      max_s: PLATFORM_LIMITS.tiktok.baseline_max_s,
      by: 'TikTok',
    });
    expect(platformMaxSeconds(['youtube', 'tiktok', 'facebook'])).toEqual({
      max_s: 90,
      by: 'Facebook Reels',
    });
  });
});
