// 047 — định dạng ô cài đặt Autopilot.
import { describe, expect, it } from 'vitest';
import {
  channelSummary,
  compactCount,
  formatList,
  parseList,
  percentToShare,
  shareToPercent,
  sourceLabel,
} from '../../src/renderer/autopilot-format';

describe('autopilot settings format', () => {
  it('lists: split on commas/newlines, trim, dedupe', () => {
    expect(parseList(' lịch sử, khoa học\nlịch sử ,, ')).toEqual(['lịch sử', 'khoa học']);
    expect(formatList(['19:00', 'sat 09:00'])).toBe('19:00, sat 09:00');
    expect(formatList(undefined)).toBe('');
  });
  it('budget share as percent', () => {
    expect(shareToPercent(0.7)).toBe('70');
    expect(percentToShare('55')).toBe(0.55);
    expect(percentToShare('')).toBeUndefined();
    expect(percentToShare('abc')).toBeUndefined();
  });
  it('labels and summaries', () => {
    expect(sourceLabel('channel')).toBe('kênh');
    expect(sourceLabel('default')).toBe('mặc định');
    expect(channelSummary({ autopilot: false, competitors: 3, exists: true })).toBe('Manual');
    expect(channelSummary({ autopilot: true, competitors: 2, exists: true })).toBe(
      'Autopilot · 2 đối thủ',
    );
    expect(channelSummary({ autopilot: true, competitors: 0, exists: true })).toMatch(
      /chưa có đối thủ/,
    );
    expect(compactCount(4_200_000)).toBe('4,2 Tr');
    expect(compactCount(1_000_000)).toBe('1 Tr');
    expect(compactCount(45_300)).toBe('45 N');
    expect(compactCount(null)).toBe('ẩn');
  });
});
