// 021 · SC-002 — vector NPY và xếp hạng FN-021 (0,6 × cosine + 0,25 × từ khóa + 0,15 × (1 − phạt)).
import { afterEach, describe, expect, it } from 'vitest';
import { findMusicSemantic, readNpyF32, WriteStore, type TextEmbedder } from '../../src/index.js';
import { copyChannel, fixtureAppData } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

/** NPY v1.0 float32 một chiều (như numpy.save). */
function npy(v: number[]): Buffer {
  let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${v.length},), }`;
  const pad = 64 - ((10 + header.length + 1) % 64);
  header = `${header}${' '.repeat(pad % 64)}\n`;
  const pre = Buffer.alloc(10);
  Buffer.from([0x93]).copy(pre, 0);
  pre.write('NUMPY', 1, 'latin1');
  pre[6] = 1;
  pre[7] = 0;
  pre.writeUInt16LE(header.length, 8);
  const data = Buffer.from(new Float32Array(v).buffer);
  return Buffer.concat([pre, Buffer.from(header, 'latin1'), data]);
}

const track = (id: string, tags: string[], vector?: string) => ({
  id,
  kind: 'music',
  file: `files/${id}.wav`,
  original_name: `${id}.wav`,
  hash: id.padEnd(64, '0').slice(0, 64),
  tags,
  analysis: {
    duration_ms: 60_000,
    sample_rate: 48000,
    channels: 2,
    energy: 0.5,
    energy_curve: [0.5],
    loudness_lufs: -14,
    silence_head_ms: 0,
    silence_tail_ms: 0,
  },
  ...(vector ? { embedding: { model: 'laion/clap-htsat-unfused', vector_file: vector } } : {}),
  added_at: '2026-10-04T00:00:00Z',
  used_in: [],
});

function library() {
  const c = copyChannel();
  cleanups.push(c.cleanup);
  const store = new WriteStore(c.dir);
  store.write('music/.index/mt_aaaaaaaa.npy', npy([1, 0, 0]), { by: 'test', validate: false });
  store.write('music/.index/mt_bbbbbbbb.npy', npy([0, 1, 0]), { by: 'test', validate: false });
  store.write(
    'music/manifest.json',
    JSON.stringify({
      schema_version: 1,
      tracks: [
        track('mt_aaaaaaaa', ['ambient'], '.index/mt_aaaaaaaa.npy'),
        track('mt_bbbbbbbb', ['piano'], '.index/mt_bbbbbbbb.npy'),
        track('mt_cccccccc', ['piano']),
      ],
    }),
    { by: 'test' },
  );
  return store;
}

const embedder: TextEmbedder = {
  model: 'laion/clap-htsat-unfused',
  embedTexts: async () => [[1, 0, 0]],
};

describe('music semantic search (021)', () => {
  it('reads a float32 NPY vector', () => {
    expect(Array.from(readNpyF32(npy([0.5, -1, 2])))).toEqual([0.5, -1, 2]);
  });

  it('ranks by 0.6 × cosine + 0.25 × keywords + 0.15 × freshness', async () => {
    const store = library();
    const r = await findMusicSemantic(
      { channel: store, appDataDir: fixtureAppData, embedder },
      { query: 'tense slow piano' },
    );
    const ids = r.results.map((x) => x.track_id);
    // A: cosine 1 → 0,6 + 0,15 = 0,75; B/C: từ khóa 1/3 → 0,083 + 0,15
    expect(ids[0]).toBe('mt_aaaaaaaa');
    expect(r.results[0]!.score).toBeCloseTo(0.75, 2);
    expect(r.results[0]!.reasons.join(' ')).toContain('khớp mô tả');
    expect(r.results.find((x) => x.track_id === 'mt_bbbbbbbb')!.score).toBeCloseTo(
      0.6 * 0 + 0.25 / 3 + 0.15,
      2,
    );
  });

  it('without an embedder (no CLAP) falls back to the keyword formula', async () => {
    const store = library();
    const r = await findMusicSemantic(
      { channel: store, appDataDir: fixtureAppData },
      { query: 'piano' },
    );
    expect(r.results[0]!.track_id).not.toBe('mt_aaaaaaaa');
  });
});
