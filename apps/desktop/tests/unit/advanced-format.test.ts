// 085 — khối "Nâng cao": ô chọn tầng video và tóm tắt.
import { describe, expect, it } from 'vitest';
import {
  advancedSummary,
  choiceValue,
  inheritLabel,
  videoChoice,
} from '../../src/renderer/advanced-format';

describe('advanced-format (085)', () => {
  it('maps a video-tier value to Theo kênh / Bật / Tắt and back', () => {
    expect(videoChoice({ value: true, source: 'channel', inherited: true })).toBe('inherit');
    expect(videoChoice({ value: true, source: 'video', inherited: false })).toBe('on');
    expect(videoChoice({ value: false, source: 'video', inherited: true })).toBe('off');
    expect(choiceValue('inherit')).toBeNull();
    expect(choiceValue('on')).toBe(true);
    expect(choiceValue('off')).toBe(false);
    expect(inheritLabel({ value: false, source: 'video', inherited: true })).toBe(
      'Theo kênh (Bật)',
    );
  });
  it('summarizes what is on', () => {
    const off = { value: false, source: 'default', inherited: false };
    expect(advancedSummary({ 'advanced.refine': off })).toBe('Nâng cao: tắt hết (chế độ gọn)');
    expect(
      advancedSummary({
        'advanced.refine': off,
        'advanced.music': { ...off, value: true },
      }),
    ).toBe('Nâng cao: Nhạc nền');
  });
});
