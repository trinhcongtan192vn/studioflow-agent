// 021 · SC-001 — CLAP thật (CPU): nạp 3 clip tổng hợp, tìm bằng mô tả. Bỏ qua khi CLAP chưa cài.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createCore,
  defaultAppDataDir,
  enginePython,
  type SessionContext,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

const real = defaultAppDataDir();
const ready =
  existsSync(enginePython('clap', real)) &&
  existsSync(path.join(real, 'models', 'hf', 'hub', 'models--laion--clap-htsat-unfused')) &&
  Boolean(process.env.SF_PYTHON_AUDIO_ANALYSIS);

const SR = 48_000;
function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) =>
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2),
  );
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
function piano(sec: number): Float32Array {
  const y = new Float32Array(SR * sec);
  const notes = [261.6, 329.6, 392.0, 523.3, 392.0, 329.6];
  for (let i = 0; i * 0.5 < sec - 1.5; i++) {
    const f = notes[i % notes.length]!;
    const s0 = Math.floor(i * 0.5 * SR);
    for (let n = 0; n < 1.5 * SR && s0 + n < y.length; n++) {
      let v = 0;
      for (let k = 1; k <= 5; k++) v += Math.sin((2 * Math.PI * f * k * n) / SR) / k ** 1.5;
      y[s0 + n]! += v * Math.exp((-n / SR) * 3) * 0.25;
    }
  }
  return y;
}
function drums(sec: number): Float32Array {
  const y = new Float32Array(SR * sec);
  for (let b = 0; b * 0.5 < sec; b++) {
    const s0 = Math.floor(b * 0.5 * SR);
    const len = Math.floor(0.25 * SR);
    for (let n = 0; n < len && s0 + n < y.length; n++) {
      const v =
        b % 2 === 0
          ? Math.sin((2 * Math.PI * 60 * n * (1 - (n / len) * 0.5)) / SR) * Math.exp((-n / SR) * 18)
          : rand() * Math.exp((-n / SR) * 25);
      y[s0 + n]! += v * 0.8;
    }
  }
  return y;
}
const noise = (sec: number) => Float32Array.from({ length: SR * sec }, () => rand() * 0.2);

const cleanups: (() => void)[] = [];
afterAll(() => cleanups.splice(0).forEach((c) => c()));

describe('music.find by description with real CLAP (021 SC-001)', () => {
  it.skipIf(!ready)(
    'piano / drums / noise clips rank first for matching descriptions',
    async () => {
      process.env.SF_PYTHON_CLAP ??= enginePython('clap', real);
      process.env.HF_HOME ??= path.join(real, 'models', 'hf');
      const c = copyChannel();
      const t = tempDir('app-');
      copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
      const core = createCore({ appDataDir: t.dir, backoffMs: [10, 20] });
      cleanups.push(() => core.close(), c.cleanup, t.cleanup);
      // phiên gắn video → đường dẫn tương đối video (uploads của video)
      const up = path.join(c.dir, 'videos', fixtureVideoId, 'uploads');
      mkdirSync(up, { recursive: true });
      writeFileSync(path.join(up, 'piano.wav'), wav(piano(14)));
      writeFileSync(path.join(up, 'drums.wav'), wav(drums(14)));
      writeFileSync(path.join(up, 'noise.wav'), wav(noise(14)));
      const session: SessionContext = {
        session_id: 'ss_test0001',
        kind: 'main',
        channel_dir: c.dir,
        video_id: fixtureVideoId,
      };
      const add = (await core.gateway.call(session, 'music.library.add', {
        files: ['uploads/piano.wav', 'uploads/drums.wav', 'uploads/noise.wav'],
        scope: 'channel',
        kind: 'music',
      })) as { job_id: string };
      const done = (await core.gateway.call(session, 'job.wait', {
        job_id: add.job_id,
        timeout_ms: 300_000,
      })) as {
        data: { status: string; result: { track_ids: string[] } };
      };
      expect(done.data.status, JSON.stringify(done.data.result)).toBe('succeeded');
      expect(done.data.result.track_ids).toHaveLength(3);
      const [pianoId, drumsId] = done.data.result.track_ids;
      const manifest = JSON.parse(readFileSync(path.join(c.dir, 'music', 'manifest.json'), 'utf8'));
      expect(manifest.tracks.every((x: { embedding?: unknown }) => x.embedding)).toBe(true);
      const top = async (query: string) =>
        (
          (await core.gateway.call(session, 'music.find', { query })) as {
            data: { results: { track_id: string }[] };
          }
        ).data.results[0]!.track_id;
      expect(await top('solo piano melody')).toBe(pianoId);
      expect(await top('drum beat')).toBe(drumsId);
      expect(await top('tense slow piano')).toBe(pianoId);
    },
    600_000,
  );
});
