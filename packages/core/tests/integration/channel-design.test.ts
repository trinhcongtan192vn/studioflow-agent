// Design system cấp kênh: frame.md của video sinh từ design kênh hợp lệ theo schema (front matter có
// generated_from) và bộ layout đọc đúng màu/font/kiểu chữ; video lệch design khi design đổi.
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import {
  designSystemExecutor,
  loadVideoModel,
  saveChannelDesign,
  setConfig,
  validateArtifact,
  videoDesignStatus,
  WriteStore,
} from '../../src/index.js';
import { parseDesignTokens } from '../../src/hf/templates.js';
import { copyChannel, fixtureVideoId } from '../domain-helpers.js';

let c: ReturnType<typeof copyChannel> | undefined;
afterEach(() => c?.cleanup());

it('frame.md from the channel design is valid and drives the layout tokens', async () => {
  c = copyChannel();
  const store = new WriteStore(c.dir);
  saveChannelDesign(store, {
    name: 'Deep Field',
    colors: {
      canvas: '#0b1020',
      surface: '#161d33',
      ink: '#f4f1ea',
      muted: '#a8b0c6',
      accent: '#ffb547',
      accent2: '#4fd1c5',
    },
    fonts: { title: 'Georgia, serif', body: 'sans-serif' },
    text: { case: 'upper', weight: 900 },
  });
  const step = { id: 'design', uses: 'design-system' as const, title: 'Design' };
  await designSystemExecutor()({
    store,
    channelDir: c.dir,
    videoId: fixtureVideoId,
    step,
    manifest: { id: 't', steps: [step] },
    signal: new AbortController().signal,
  } as never);
  const rel = `videos/${fixtureVideoId}/frame.md`;
  const md = readFileSync(store.abs(rel), 'utf8');
  expect(validateArtifact(rel, md)).toMatchObject({ valid: true });
  expect(parseDesignTokens(md)).toMatchObject({
    canvas: '#0b1020',
    accent: '#ffb547',
    font: 'Georgia, serif',
    upper: true,
    weight: 900,
  });
  expect(videoDesignStatus(store, fixtureVideoId)).toEqual({ stale: false });
  saveChannelDesign(store, {
    ...JSON.parse(readFileSync(store.abs('profile/design-system.json'), 'utf8')),
    image_style: { medium: 'flat vector illustration' },
  });
  expect(videoDesignStatus(store, fixtureVideoId)).toMatchObject({ stale: true, images: true });
});

it('voice pacing of the channel design sets TTS speed and the pause after lines; videos see it as stale', async () => {
  c = copyChannel();
  const store = new WriteStore(c.dir);
  // chưa có nhịp đọc → tốc độ giọng mẫu, không nghỉ (giữ hash audio cũ)
  const d = saveChannelDesign(store, { name: 'Calm' });
  expect(d.voice).toEqual({ speed: 1, pause_ms: 0 });
  const step = { id: 'design', uses: 'design-system' as const, title: 'Design' };
  await designSystemExecutor()({
    store,
    channelDir: c.dir,
    videoId: fixtureVideoId,
    step,
    manifest: { id: 't', steps: [step] },
    signal: new AbortController().signal,
  } as never);
  expect(loadVideoModel(c.dir, fixtureVideoId).voiceSpeed).toBe(1);
  saveChannelDesign(store, { ...d, voice: { speed: 0.5, pause_ms: 320 } });
  expect(videoDesignStatus(store, fixtureVideoId)).toMatchObject({ stale: true, voice: true });
  const m = loadVideoModel(c.dir, fixtureVideoId);
  expect(m.voiceSpeed).toBe(0.8); // giới hạn 0.8–1.2
  const plain = m.lines.find((l) => l.pause_after_ms === 320);
  expect(plain).toBeDefined();
  // đặt riêng voice.pause_after_ms (ví dụ workflow/kênh) → thắng design
  setConfig(store, 'voice.pause_after_ms', 100, { tier: 'channel' });
  expect(loadVideoModel(c.dir, fixtureVideoId).lines.some((l) => l.pause_after_ms === 320)).toBe(
    false,
  );
});
