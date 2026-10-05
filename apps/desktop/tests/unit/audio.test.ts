// 008 — trình phát âm thanh trong app: định dạng thời gian.
import { describe, expect, it } from 'vitest';
import { fmtClock } from '../../src/renderer/AudioPlayer';

describe('fmtClock', () => {
  it('formats m:ss', () => {
    expect(fmtClock(0)).toBe('0:00');
    expect(fmtClock(7.41)).toBe('0:07');
    expect(fmtClock(65)).toBe('1:05');
    expect(fmtClock(NaN)).toBe('0:00');
    expect(fmtClock(Infinity)).toBe('0:00');
  });
});
