// 010 · FR-002 — chuẩn hóa, WER, căn từ kịch bản với mốc ASR.
import { describe, expect, it } from 'vitest';
import { alignWords, normalizeTokens, wordErrorRate } from '../../src/index.js';

const w = (text: string, start_ms: number, end_ms: number) => ({ text, start_ms, end_ms });

describe('asr text (010 FR-002)', () => {
  it('normalizes case, punctuation and Unicode forms', () => {
    expect(normalizeTokens('Xin chào, THẾ GIỚI!')).toEqual(['xin', 'chào', 'thế', 'giới']);
    expect(normalizeTokens('Tiếng')).toEqual(normalizeTokens('Tiếng'));
    expect(normalizeTokens('  … — ')).toEqual([]);
  });

  it('word error rate by tokens', () => {
    expect(wordErrorRate(['a', 'b', 'c'], ['a', 'x', 'c'])).toBeCloseTo(1 / 3);
    expect(wordErrorRate(['a', 'b'], [])).toBe(1);
    expect(wordErrorRate([], [])).toBe(0);
    expect(wordErrorRate(['a', 'b'], ['a', 'b', 'c', 'd'])).toBe(1);
  });

  it('aligns script words to ASR timings, interpolating unmatched words', () => {
    const r = alignWords(
      'Bầu trời, rất xanh!',
      undefined,
      [w('bầu', 100, 300), w('trời', 300, 500), w('xanh', 900, 1200)],
      1500,
    );
    expect(r.map((x) => x.text)).toEqual(['Bầu', 'trời,', 'rất', 'xanh!']);
    expect(r[0]).toMatchObject({ i: 0, start_ms: 100, end_ms: 300 });
    expect(r[2]).toMatchObject({ start_ms: 500, end_ms: 900 }); // "rất" nằm giữa hai từ khớp
    expect(r[3]).toMatchObject({ start_ms: 900, end_ms: 1200 });
  });

  it('spreads display words over the spoken span when tts_text differs', () => {
    const r = alignWords(
      'Năm 1428',
      'Năm một nghìn bốn trăm hai mươi tám',
      [w('năm', 200, 400), w('tám', 2000, 2200)],
      2500,
    );
    expect(r).toHaveLength(2);
    expect(r[0]!.start_ms).toBe(200);
    expect(r[1]!.end_ms).toBe(2200);
    expect(r[0]!.end_ms).toBe(r[1]!.start_ms);
  });

  it('no ASR words → spread over the whole line duration', () => {
    const r = alignWords('một hai', undefined, [], 1000);
    expect(r).toEqual([
      { i: 0, text: 'một', start_ms: 0, end_ms: 500 },
      { i: 1, text: 'hai', start_ms: 500, end_ms: 1000 },
    ]);
  });
});
