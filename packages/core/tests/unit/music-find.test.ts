// 012 · US2, US4 · FR-003, FR-005 — lọc/xếp hạng music.find, CREDITS, ducking.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCredits,
  duckExpression,
  findMusic,
  mergeIntervals,
  WriteStore,
  type MusicTrack,
} from '../../src/index.js';
import { copyChannel, fixtureVideoId, tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function track(
  id: string,
  o: {
    bpm?: number;
    ms: number;
    tags: string[];
    kind?: 'music' | 'sfx';
    energy?: number;
    used?: string[];
  },
): MusicTrack {
  return {
    id: id as MusicTrack['id'],
    kind: o.kind ?? 'music',
    file: `files/${id}.wav`,
    original_name: `${id}.wav`,
    hash: id.padEnd(64, '0'),
    tags: o.tags,
    analysis: {
      duration_ms: o.ms,
      sample_rate: 48000,
      channels: 2,
      ...(o.bpm ? { bpm: o.bpm, bpm_confidence: 0.8 } : {}),
      energy: o.energy ?? 0.5,
      energy_curve: [],
      loudness_lufs: -16,
      silence_head_ms: 0,
      silence_tail_ms: 0,
    },
    added_at: '2026-10-04T00:00:00Z',
    used_in: (o.used ?? []) as MusicTrack['used_in'],
  };
}

function libs(channelTracks: MusicTrack[], appTracks: MusicTrack[] = []) {
  const c = copyChannel();
  const a = tempDir('app-');
  cleanups.push(c.cleanup, a.cleanup);
  for (const [dir, tracks] of [
    [c.dir, channelTracks],
    [a.dir, appTracks],
  ] as const) {
    mkdirSync(path.join(dir, 'music'), { recursive: true });
    writeFileSync(
      path.join(dir, 'music', 'manifest.json'),
      JSON.stringify({ schema_version: 1, tracks }),
    );
  }
  return { channel: new WriteStore(c.dir), appDataDir: a.dir };
}

describe('music.find (012 US2)', () => {
  it('hard filters, keyword ranking, half/double tempo, channel first on ties', () => {
    const d = libs(
      [
        track('mt_slow0001', { bpm: 90, ms: 200_000, tags: ['chậm', 'piano'] }),
        track('mt_fast0001', { bpm: 140, ms: 200_000, tags: ['nhanh'] }),
        track('mt_short001', { bpm: 88, ms: 60_000, tags: ['chậm'] }),
        track('mt_sfx00001', { ms: 2000, tags: ['whoosh'], kind: 'sfx' }),
      ],
      [track('mt_appslow1', { bpm: 45, ms: 300_000, tags: ['chậm', 'piano'] })],
    );
    const r = findMusic(d, {
      query: 'nhạc chậm piano',
      bpm: { min: 85, max: 95 },
      min_duration_ms: 180_000,
    });
    expect(r.results.map((x) => x.track_id)).toEqual(['mt_slow0001', 'mt_appslow1']); // 45 × 2 = 90
    expect(r.results[0]!.reasons).toContain('BPM 90');
    expect(r.results[0]!.score).toBeGreaterThan(0.5);
    expect(findMusic(d, { tags: ['nhanh'] }).results.map((x) => x.track_id)).toEqual([
      'mt_fast0001',
    ]);
    expect(findMusic(d, { query: 'whoosh' }, 'sfx').results[0]!.track_id).toBe('mt_sfx00001');
    expect(
      findMusic(d, { exclude_ids: ['mt_slow0001'], tags: ['piano'] }).results.map(
        (x) => x.track_id,
      ),
    ).toEqual(['mt_appslow1']);
  });

  it('recently used tracks rank lower; no match → E_MUSIC_NOT_FOUND with hints', () => {
    const d = libs([
      track('mt_used0001', { bpm: 90, ms: 100_000, tags: ['chậm'], used: [fixtureVideoId] }),
      track('mt_free0001', { bpm: 90, ms: 100_000, tags: ['chậm'] }),
    ]);
    expect(findMusic(d, { query: 'chậm' }).results[0]!.track_id).toBe('mt_free0001');
    expect(() => findMusic(d, { tags: ['rock'], bpm: { min: 200 } })).toThrow(
      expect.objectContaining({
        code: 'E_MUSIC_NOT_FOUND',
        message: expect.stringContaining('nới khoảng BPM'),
      }),
    );
  });
});

describe('CREDITS and ducking (012 US3, US4)', () => {
  it('credits only list attributed items', () => {
    const t = {
      ...track('mt_aaaaaaaa', { ms: 1, tags: [] }),
      title: 'Morning',
      artist: 'Kevin',
      attribution: 'CC BY 4.0',
      url: 'https://x.y',
    };
    expect(buildCredits([t, track('mt_bbbbbbbb', { ms: 1, tags: [] })])).toBe(
      'Music:\n"Morning" — Kevin\nCC BY 4.0\nhttps://x.y\n',
    );
    expect(buildCredits([track('mt_bbbbbbbb', { ms: 1, tags: [] })])).toBe('');
    expect(
      buildCredits([], [
        {
          id: 'as_aaaaaaaa',
          file: 'a',
          kind: 'image',
          tags: [],
          source: { kind: 'library', attribution: 'Ảnh: Wikimedia' },
          hash: 'x',
          created_at: '',
        },
      ] as never),
    ).toBe('Images:\nẢnh: Wikimedia\n');
  });

  it('merges close voice intervals and builds a volume expression', () => {
    expect(
      mergeIntervals([
        { start_ms: 0, end_ms: 1000 },
        { start_ms: 1500, end_ms: 2000 },
        { start_ms: 4000, end_ms: 5000 },
      ]),
    ).toEqual([
      { start_ms: 0, end_ms: 2000 },
      { start_ms: 4000, end_ms: 5000 },
    ]);
    expect(duckExpression([], -12)).toBe('1');
    const e = duckExpression([{ start_ms: 1000, end_ms: 2000 }], -12);
    expect(e).toMatch(/^1-0\.74881\*min\(clip\(\(t-0\.950\)\/0\.05/);
  });
});
