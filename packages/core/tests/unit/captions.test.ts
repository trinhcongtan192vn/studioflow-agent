// 010 · FR-006 — cụm caption (FN-common mục 3, D3 5.8).
import { describe, expect, it } from 'vitest';
import { buildCaptionGroups, validateValue } from '../../src/index.js';

const words = (texts: string[], step = 300) =>
  texts.map((text, i) => ({ i, text, start_ms: i * step, end_ms: (i + 1) * step }));
const line = (line_id: string, start_ms: number, texts: string[]) => ({
  line_id,
  start_ms,
  speaker: 'narrator',
  words: words(texts),
});

describe('caption groups (010 FR-006)', () => {
  it('splits by max words and punctuation, never across lines', () => {
    const g = buildCaptionGroups({
      videoId: 'vd_8m2pq7rt',
      style: 'caption-highlight',
      maxWords: 4,
      lines: [
        line('ln_aaaaaaaa', 0, ['Một', 'hai,', 'ba', 'bốn', 'năm', 'sáu', 'bảy']),
        line('ln_bbbbbbbb', 3000, ['Tám', 'chín.']),
      ],
    });
    // cụm cuối một từ ("bảy") gộp vào cụm trước (≤ max_words + 2)
    expect(g.groups.map((x) => x.text)).toEqual(['Một hai,', 'ba bốn năm sáu bảy', 'Tám chín.']);
    expect(g.groups[0]).toMatchObject({
      line_id: 'ln_aaaaaaaa',
      word_range: [0, 1],
      start_ms: 0,
      end_ms: 600,
    });
    expect(g.groups[2]).toMatchObject({
      line_id: 'ln_bbbbbbbb',
      word_range: [0, 1],
      start_ms: 3000,
      end_ms: 3600,
    });
    expect(validateValue('CaptionGroups', g)).toEqual([]);
  });

  it('marks numbers and proper nouns as emphasis; IDs are stable', () => {
    const input = {
      videoId: 'vd_8m2pq7rt',
      style: 's',
      maxWords: 7,
      lines: [line('ln_aaaaaaaa', 0, ['Năm', '1428', 'Lê', 'Lợi', 'lên', 'ngôi.'])],
    };
    const a = buildCaptionGroups(input);
    expect(a.groups[0]!.emphasis).toEqual([1, 2, 3]);
    expect(buildCaptionGroups(input).groups[0]!.id).toBe(a.groups[0]!.id);
    expect(a.groups[0]!.id).toMatch(/^cg_[0-9a-z]{8}$/);
  });

  it('skips lines without words', () => {
    expect(
      buildCaptionGroups({
        videoId: 'vd_8m2pq7rt',
        style: 's',
        maxWords: 7,
        lines: [{ line_id: 'ln_aaaaaaaa', start_ms: 0, speaker: 'narrator', words: [] }],
      }).groups,
    ).toEqual([]);
  });
});
