// Bản phát hành mã lại theo chuẩn đăng: H.264 High 4:2:0, fps cố định, GOP đóng 2 s (Facebook Reels cần 2–5 s),
// AAC 48 kHz stereo — probeMedia đọc đúng khoảng cách keyframe; đạt giới hạn của cả ba nền tảng.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { finishVideo, probeMedia } from '../../src/render/post.js';
import { publishProblems } from '../../src/publish/limits.js';
import { tempDir } from '../domain-helpers.js';

const t = tempDir('rel-');
afterAll(() => t.cleanup());

it('release encode: 2 s closed GOP, yuv420p, AAC stereo 48 kHz; accepted by YouTube, Facebook and TikTok', async () => {
  const raw = path.join(t.dir, 'raw.mp4');
  // nguồn giống bản HyperFrames: một keyframe cho cả clip (GOP dài)
  spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=540x960:rate=30:duration=8',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=330:duration=8',
    '-c:v',
    'libx264',
    '-g',
    '600',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ac',
    '1',
    raw,
  ]);
  expect((await probeMedia(raw)).max_gop_s).toBeGreaterThan(7);
  const out = path.join(t.dir, 'video.mp4');
  await finishVideo(raw, out, { lufs: -14, draft: false, crf: 18, fps: 30 });
  const m = await probeMedia(out);
  expect(m).toMatchObject({
    width: 540,
    height: 960,
    fps: 30,
    vcodec: 'h264',
    pix_fmt: 'yuv420p',
    acodec: 'aac',
    sample_rate: 48000,
    channels: 2,
  });
  expect(m.max_gop_s).toBeLessThanOrEqual(2.1);
  for (const p of ['youtube', 'facebook', 'tiktok'] as const)
    expect(publishProblems(p, m), p).toEqual([]);
}, 120_000);
