// Trần thời lượng sớm theo nền tảng đích: video dọc của kênh có đăng Facebook Reels phải ≤ 90 s ngay ở gate
// `max_duration` (bước voice), không đợi tới lúc đăng; kênh chỉ YouTube → trần của profile (Shorts 3 phút).
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { maxDurationCheck, setConfig, WriteStore } from '../../src/index.js';
import { copyChannel, fixtureVideoId } from '../domain-helpers.js';

let c: ReturnType<typeof copyChannel> | undefined;
afterEach(() => c?.cleanup());

it('a 120 s vertical short fails early at the 90 s Shorts cap, whatever the channel platforms', () => {
  c = copyChannel();
  const store = new WriteStore(c.dir);
  const rel = `videos/${fixtureVideoId}/audio_meta.json`;
  const meta = JSON.parse(readFileSync(store.abs(rel), 'utf8')) as {
    lines: { duration_ms: number }[];
  };
  meta.lines[0]!.duration_ms = 120_000;
  store.write(rel, `${JSON.stringify(meta, null, 2)}\n`, { by: 'test', validate: false });
  setConfig(store, 'output.profile', 'yt-shorts-1080x1920', {
    tier: 'video',
    videoId: fixtureVideoId,
  });
  const check = () => maxDurationCheck(store, fixtureVideoId, undefined, 'audio');
  setConfig(store, 'publish.platforms', ['youtube'], { tier: 'channel' });
  expect(check().detail).toMatch(/exceeds yt-shorts-1080x1920 max 90/);
  setConfig(store, 'publish.platforms', ['youtube', 'facebook'], { tier: 'channel' });
  expect(check()).toMatchObject({ pass: false, detail: expect.stringMatching(/max 90/) });
});
