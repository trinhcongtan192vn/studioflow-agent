// 016 R4 — tốc độ đọc theo giọng (không cố định): đo khi tạo giọng, học từ audio của video, cấu hình
// người dùng đặt vẫn ưu tiên.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CALIBRATION_TEXT,
  countWords,
  createCore,
  createVoiceProfile,
  learnFromVideo,
  readingRate,
  recordVoiceWpm,
  voiceWpm,
  type SessionContext,
} from '../../src/index.js';
import { FAKE_MS_PER_CHAR } from '../../src/providers/fake.js';
import { writeWav } from '../worker-helpers.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function writeProfile(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function setup() {
  const c = copyChannel();
  const t = tempDir('app-');
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const core = createCore({ appDataDir: t.dir, backoffMs: [10, 20] });
  cleanups.push(() => core.close(), c.cleanup, t.cleanup);
  return { core, dir: c.dir, app: t.dir, store: core.gateway.storeFor(c.dir) };
}

describe('reading rate per voice (016 R4)', () => {
  it('a new voice is calibrated by reading a sample paragraph', async () => {
    const { core, dir, app, store } = setup();
    mkdirSync(path.join(dir, 'uploads'), { recursive: true });
    writeWav(path.join(dir, 'uploads', 'ref.wav'), 5000);
    const v = await createVoiceProfile(core, store, {
      name: 'Thử',
      ref_audio: 'uploads/ref.wav',
      language: 'vi',
      appDataDir: app,
    });
    const text = CALIBRATION_TEXT.vi!;
    const expected = countWords(text) / ((text.length * FAKE_MS_PER_CHAR) / 60000);
    expect(voiceWpm(store, v.voice_id)).toBeCloseTo(expected, 0);
  });

  it('precedence: channel/video config > measured voice rate > default; averaging by samples', () => {
    const { store, app } = setup();
    // giọng narrator của kênh mẫu: vo_c3z8p1mn
    const prof = store.abs('voices/vo_c3z8p1mn/profile.json');
    writeProfile(prof, JSON.stringify({ voice_id: 'vo_c3z8p1mn', name: 'x' }));
    expect(readingRate(store, fixtureVideoId, 'vi', app)).toBe(150); // mặc định
    recordVoiceWpm(store, 'vo_c3z8p1mn', 240);
    recordVoiceWpm(store, 'vo_c3z8p1mn', 220, 3);
    expect(voiceWpm(store, 'vo_c3z8p1mn')).toBe(225);
    expect(readingRate(store, fixtureVideoId, 'vi', app)).toBe(225);
    const ch = JSON.parse(readFileSync(store.abs('channel.json'), 'utf8'));
    ch.config['script.wpm.vi'] = 180;
    writeFileSync(store.abs('channel.json'), JSON.stringify(ch));
    expect(readingRate(store, fixtureVideoId, 'vi', app)).toBe(180);
  });

  it('learns the real rate from a video’s audio after the voice step', async () => {
    const { core, dir, store } = setup();
    writeProfile(
      store.abs('voices/vo_c3z8p1mn/profile.json'),
      JSON.stringify({ voice_id: 'vo_c3z8p1mn' }),
    );
    // lời đủ dài cho một mẫu
    const s = store.abs(`videos/${fixtureVideoId}/SCRIPT.md`);
    writeFileSync(
      s,
      readFileSync(s, 'utf8').replace(
        'kéo dài hơn ba trăm năm.',
        `kéo dài hơn ba trăm năm. ${'Triều đại để lại nhiều dấu ấn trong văn hóa. '.repeat(4)}`,
      ),
    );
    const session: SessionContext = {
      session_id: 'ss_test0001',
      kind: 'main',
      channel_dir: dir,
      video_id: fixtureVideoId,
    };
    const r = (await core.gateway.call(session, 'tts.synthesize', { line_ids: 'all' })) as {
      job_id: string;
    };
    await core.gateway.call(session, 'job.wait', { job_id: r.job_id, timeout_ms: 20_000 });
    const wpm = learnFromVideo(store, fixtureVideoId);
    expect(wpm).toBeGreaterThan(50);
    expect(voiceWpm(store, 'vo_c3z8p1mn')).toBe(wpm);
  });
});
