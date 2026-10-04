// 026 · FR-ST-05 — áp caption-overrides (tách/gộp/mốc/chữ), bất biến khi lưu, giải mã WAV cho dạng sóng.
import { describe, expect, it } from 'vitest';
import {
  captionViolations,
  decodeWav,
  effectiveCaptions,
  encodeWav,
  type AudioMeta,
  type CaptionGroups,
  type CaptionOverrides,
} from '../../src/index.js';

const words = ['Năm', '1428,', 'Lê', 'Lợi', 'lên', 'ngôi.'].map((text, i) => ({
  i,
  text,
  start_ms: i * 200,
  end_ms: i * 200 + 150,
}));
const meta = {
  schema_version: 1,
  video_id: 'vd_8m2pq7rt',
  sample_rate: 48000,
  total_duration_ms: 1500,
  lines: [
    {
      line_id: 'ln_2r7c4kxm',
      file: 'audio/lines/ln_2r7c4kxm.wav',
      start_ms: 300,
      duration_ms: 1200,
      speaker: 'narrator',
      voice_id: 'vo_c3z8p1mn',
      words,
      content_hash: '0'.repeat(64),
    },
  ],
} as unknown as AudioMeta;
const cg = {
  schema_version: 1,
  video_id: 'vd_8m2pq7rt',
  style: 'caption-highlight',
  groups: [
    {
      id: 'cg_aaaaaaaa',
      line_id: 'ln_2r7c4kxm',
      word_range: [0, 1],
      text: 'Năm 1428,',
      start_ms: 300,
      end_ms: 650,
      emphasis: [1],
    },
    {
      id: 'cg_bbbbbbbb',
      line_id: 'ln_2r7c4kxm',
      word_range: [2, 5],
      text: 'Lê Lợi lên ngôi.',
      start_ms: 700,
      end_ms: 1450,
      emphasis: [2, 3],
    },
  ],
} as unknown as CaptionGroups;
const ov = (o: Partial<CaptionOverrides>) =>
  ({
    schema_version: 1,
    video_id: 'vd_8m2pq7rt',
    groups: {},
    splits: [],
    merges: [],
    ...o,
  }) as CaptionOverrides;
const lines = new Map([['ln_2r7c4kxm', { start_ms: 300, words }]]);

describe('effectiveCaptions (026)', () => {
  it('split at a word uses word timings and divides emphasis', () => {
    const e = effectiveCaptions(
      cg,
      ov({ splits: [{ group_id: 'cg_bbbbbbbb', at_word: 4, new_id: 'cg_cccccccc' }] } as never),
      lines,
    );
    expect(e.groups.map((g) => [g.id, g.text, g.start_ms, g.end_ms, g.emphasis])).toEqual([
      ['cg_aaaaaaaa', 'Năm 1428,', 300, 650, [1]],
      ['cg_bbbbbbbb', 'Lê Lợi', 700, 1050, [2, 3]],
      ['cg_cccccccc', 'lên ngôi.', 1100, 1450, undefined],
    ]);
    expect(e.orphans).toEqual([]);
  });

  it('merge joins adjacent groups of one line; invalid split/merge/group become orphans', () => {
    const e = effectiveCaptions(
      cg,
      ov({
        merges: [{ group_ids: ['cg_bbbbbbbb', 'cg_aaaaaaaa'], new_id: 'cg_dddddddd' }],
        groups: { cg_dddddddd: { end_ms: 1400 }, cg_zzzzzzzz: { text: 'x' } },
        splits: [{ group_id: 'cg_aaaaaaaa', at_word: 0, new_id: 'cg_eeeeeeee' }],
      } as never),
      lines,
    );
    expect(e.groups).toEqual([
      expect.objectContaining({
        id: 'cg_dddddddd',
        word_range: [0, 5],
        text: 'Năm 1428, Lê Lợi lên ngôi.',
        start_ms: 300,
        end_ms: 1400,
        emphasis: [1, 2, 3],
      }),
    ]);
    expect(e.orphans).toEqual(['split:cg_aaaaaaaa', 'cg_zzzzzzzz']);
  });

  it('text override marks the group; without word timings a split is proportional', () => {
    const e = effectiveCaptions(
      cg,
      ov({
        groups: { cg_aaaaaaaa: { text: 'Năm 1428' } },
        splits: [{ group_id: 'cg_bbbbbbbb', at_word: 4, new_id: 'cg_cccccccc' }],
      } as never),
    );
    expect(e.groups[0]).toMatchObject({ text: 'Năm 1428', text_override: true });
    expect(e.groups[2]).toMatchObject({ text: 'lên ngôi.', start_ms: 1075 });
  });

  it('captionViolations: start<end, inside the line audio, no overlap within a line', () => {
    const g = effectiveCaptions(cg, ov({}), lines).groups;
    expect(captionViolations(g, meta)).toEqual([]);
    const bad = effectiveCaptions(
      cg,
      ov({ groups: { cg_aaaaaaaa: { start_ms: 200, end_ms: 800 }, cg_bbbbbbbb: { end_ms: 700 } } }),
      lines,
    ).groups;
    expect(captionViolations(bad, meta)).toEqual([
      expect.stringMatching(/cg_aaaaaaaa: 200–800 ms is outside line/),
      'cg_bbbbbbbb: start_ms must be < end_ms',
      'cg_aaaaaaaa overlaps cg_bbbbbbbb',
    ]);
  });
});

describe('decodeWav (026 waveform)', () => {
  it('decodes PCM16 mono and float32 stereo to mono samples', () => {
    const a = decodeWav(encodeWav(100, { sampleRate: 24000 }));
    expect(a.sampleRate).toBe(24000);
    expect(a.samples.length).toBe(2400);
    expect(Math.max(...a.samples)).toBeCloseTo(0.3, 2);

    const n = 10;
    const f = Buffer.alloc(44 + n * 8);
    f.write('RIFF', 0);
    f.writeUInt32LE(36 + n * 8, 4);
    f.write('WAVEfmt ', 8);
    f.writeUInt32LE(16, 16);
    f.writeUInt16LE(3, 20);
    f.writeUInt16LE(2, 22);
    f.writeUInt32LE(48000, 24);
    f.writeUInt32LE(48000 * 8, 28);
    f.writeUInt16LE(8, 32);
    f.writeUInt16LE(32, 34);
    f.write('data', 36);
    f.writeUInt32LE(n * 8, 40);
    for (let i = 0; i < n; i++) {
      f.writeFloatLE(0.5, 44 + i * 8);
      f.writeFloatLE(-0.1, 48 + i * 8);
    }
    const b = decodeWav(f);
    expect(b.samples.length).toBe(n);
    expect(b.samples[0]).toBeCloseTo(0.2, 5);
  });
});
