// 012 · US1–US3 · AC-M1-04, SC-001/002 — nạp + phân tích thật (engine audio-analysis CPU),
// music.find, bed nhạc + ducking (FFmpeg thật), index.html có phần tử nhạc.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BuildGraph,
  createCore,
  readMusicManifest,
  renderBed,
  validateArtifact,
  type Core,
  type SessionContext,
} from '../../src/index.js';
import { runSf } from '../helpers.js';
import { clickWav } from '../music-helpers.js';
import { writeValidFrames } from '../graph-helpers.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

const c = copyChannel();
const t = tempDir('app-');
let core: Core;
let session: SessionContext;
const ids: Record<string, string> = {};

const TRACKS: { name: string; bpm: number; s: number; tags: string[] }[] = [
  { name: 'slow90', bpm: 90, s: 210, tags: ['chậm', 'piano'] },
  { name: 'slow90short', bpm: 90, s: 60, tags: ['chậm'] },
  { name: 'fast140', bpm: 140, s: 210, tags: ['nhanh'] },
  { name: 'mid120', bpm: 120, s: 192, tags: ['vui'] },
  { name: 'slow60', bpm: 60, s: 192, tags: ['chậm'] },
  { name: 'a100', bpm: 100, s: 40, tags: ['nền'] },
  { name: 'b110', bpm: 110, s: 40, tags: ['nền'] },
  { name: 'c130', bpm: 130, s: 40, tags: ['vui'] },
  { name: 'd75', bpm: 75, s: 40, tags: ['buồn'] },
  { name: 'pop', bpm: 120, s: 2, tags: ['sfx'] },
];

beforeAll(async () => {
  process.env.SF_GPU = '0';
  writeFileSync(
    path.join(t.dir, 'settings.json'),
    readFileSync(path.join(fixtureAppData, 'settings.json')),
  );
  core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 1000, backoffMs: [10, 20] });
  session = {
    session_id: 'ss_test0001',
    kind: 'main',
    channel_dir: c.dir,
    video_id: fixtureVideoId,
  };
  const up = path.join(c.dir, 'videos', fixtureVideoId, 'uploads');
  mkdirSync(up, { recursive: true });
  for (const x of TRACKS) writeFileSync(path.join(up, `${x.name}.wav`), clickWav(x.bpm, x.s));
  // một lần nạp mỗi nhóm tag (tag đi theo lời gọi)
  for (const x of TRACKS) {
    const r = (await core.gateway.call(session, 'music.library.add', {
      files: [`uploads/${x.name}.wav`],
      scope: 'channel',
      tags: x.tags,
      ...(x.name === 'slow90' ? { attribution: 'Nhạc: Thử nghiệm (CC BY)', source: 'Tự tạo' } : {}),
    })) as { ok: boolean; job_id: string };
    expect(r.ok).toBe(true);
    const done = (await core.gateway.call(session, 'job.wait', {
      job_id: r.job_id,
      timeout_ms: 120_000,
    })) as {
      data: { status: string; result: { track_ids: string[]; skipped: unknown[] } };
    };
    expect(done.data).toMatchObject({ status: 'succeeded', result: { skipped: [] } });
    ids[x.name] = done.data.result.track_ids[0]!;
  }
}, 600_000);
afterAll(() => {
  core.close();
  c.cleanup();
  t.cleanup();
});

describe('music library (012 US1, US2)', () => {
  it('analyzes tracks on import; manifest is valid; duplicates reuse the id', async () => {
    const m = readMusicManifest({ scope: 'channel', store: core.gateway.storeFor(c.dir) });
    expect(validateArtifact('music/manifest.json', JSON.stringify(m)).errors).toEqual([]);
    const slow = m.tracks.find((x) => x.id === ids.slow90)!;
    expect(slow).toMatchObject({
      kind: 'music',
      tags: ['chậm', 'piano'],
      analysis: { duration_ms: 210_000, channels: 1 },
    });
    const bpm = slow.analysis.bpm!;
    expect([bpm, bpm * 2, bpm / 2].some((b) => Math.abs(b - 90) <= 3)).toBe(true);
    expect(m.tracks.find((x) => x.id === ids.pop)!.kind).toBe('sfx'); // < 10 s
    const r = (await core.gateway.call(session, 'music.library.add', {
      files: ['uploads/slow90.wav'],
      scope: 'channel',
    })) as { job_id: string };
    const done = (await core.gateway.call(session, 'job.wait', {
      job_id: r.job_id,
      timeout_ms: 60_000,
    })) as { data: { result: { track_ids: string[] } } };
    expect(done.data.result.track_ids).toEqual([ids.slow90]);
  });

  it('AC-M1-04: "nhạc chậm, ~90 BPM, dài ≥ 3 phút" finds the right track', async () => {
    const r = (await core.gateway.call(session, 'music.find', {
      query: 'nhạc chậm',
      bpm: { min: 85, max: 95 },
      min_duration_ms: 180_000,
    })) as { ok: boolean; data: { results: { track_id: string; reasons: string[] }[] } };
    expect(r.ok).toBe(true);
    expect(r.data.results[0]!.track_id).toBe(ids.slow90);
    expect(r.data.results.map((x) => x.track_id)).not.toContain(ids.slow90short);
    expect(r.data.results.map((x) => x.track_id)).not.toContain(ids.fast140);
  });

  it('sf music find from the CLI', () => {
    const r = runSf(
      [
        'music',
        'find',
        '--channel',
        c.dir,
        '--bpm-min',
        '85',
        '--bpm-max',
        '95',
        '--min-duration-ms',
        '180000',
        'chậm',
      ],
      {
        env: { SF_APP_DATA: t.dir },
      },
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).results[0].track_id).toBe(ids.slow90);
  });
});

function rmsDb(file: string, from: number, to: number): number {
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', file, '-af', `atrim=${from}:${to},astats=metadata=0`, '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const m = /Overall[\s\S]*?RMS level dB:\s*(-?[\d.]+|-inf)/.exec(r.stderr);
  return m ? Number(m[1]) : NaN;
}

describe('music bed and ducking (012 US3, SC-002)', () => {
  it('music under the voice is at least 6 dB lower than without voice', async () => {
    const lib = readMusicManifest({
      scope: 'channel',
      store: core.gateway.storeFor(c.dir),
    }).tracks.find((x) => x.id === ids.mid120)!;
    const wav = await renderBed({
      segments: [
        {
          track_id: lib.id,
          file: path.join(c.dir, 'music', lib.file),
          start_ms: 0,
          end_ms: 20_000,
          volume_db: -18,
        },
      ],
      voice: [{ start_ms: 5000, end_ms: 10_000 }],
      total_ms: 20_000,
      duck_db: -12,
    });
    const f = path.join(t.dir, 'bed.wav');
    writeFileSync(f, wav);
    const ducked = rmsDb(f, 6, 9);
    const open = rmsDb(f, 13, 17);
    expect(open - ducked).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it('index.html carries the mixed bed with D8 attributes when a scene has a track', async () => {
    const store = core.gateway.storeFor(c.dir);
    const v = `videos/${fixtureVideoId}`;
    const sb = readFileSync(store.abs(`${v}/STORYBOARD.md`), 'utf8').replace(
      /music: \{ query: "[^"]*", volume_db: -18 \}/,
      `music: { track_id: ${ids.mid120} }`,
    );
    store.write(`${v}/STORYBOARD.md`, sb, { by: 'test' });
    // frame giả hợp lệ (nút frame_html nhận vào graph, 020)
    writeValidFrames(store, fixtureVideoId);
    const r = await new BuildGraph({ store, appDataDir: t.dir, builders: core.graph }).build(
      fixtureVideoId,
      { targets: ['index'] },
    );
    expect(r.status).toBe('succeeded');
    const index = readFileSync(store.abs(`${v}/index.html`), 'utf8');
    const m =
      /<audio id="el-music" data-sf-track="([^"]+)" src="([^"]+)"[^>]*data-volume-db="-18" data-fade-in-ms="1000" data-fade-out-ms="1000" data-duck-db="-12"/.exec(
        index,
      );
    expect(m?.[1]).toBe(ids.mid120);
    expect(existsSync(store.abs(`${v}/${m![2]}`))).toBe(true);
    expect(existsSync(store.abs(`${v}/public/music/${ids.mid120}.wav`))).toBe(true);
    const used = readMusicManifest({ scope: 'channel', store }).tracks.find(
      (x) => x.id === ids.mid120,
    )!.used_in;
    expect(used).toContain(fixtureVideoId);
  }, 120_000);
});
