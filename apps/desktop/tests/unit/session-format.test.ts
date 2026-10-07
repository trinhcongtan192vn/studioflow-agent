// 048 (FR-AP-14) — nhật ký phiên agent: nhãn, nhóm theo ngày, thời lượng, lọc.
import { describe, expect, it } from 'vitest';
import {
  dayLabel,
  durationLabel,
  filterSessions,
  groupByDay,
  kindLabel,
} from '../../src/renderer/session-format';

const now = new Date(2026, 9, 7, 15, 0, 0);
const at = (d: number, h: number) => new Date(2026, 9, d, h, 0, 0).toISOString();

describe('session history format', () => {
  it('labels kinds and days', () => {
    expect(kindLabel('frame')).toBe('Dựng frame');
    expect(kindLabel('ops')).toBe('Vận hành (Telegram)');
    expect(kindLabel('x')).toBe('x');
    expect(dayLabel(at(7, 9), now)).toBe('Hôm nay');
    expect(dayLabel(at(6, 23), now)).toBe('Hôm qua');
    expect(dayLabel(at(2, 8), now)).toBe('02/10/2026');
  });
  it('groups newest-first rows by day', () => {
    const g = groupByDay(
      [{ started_at: at(7, 10) }, { started_at: at(7, 8) }, { started_at: at(5, 8) }],
      now,
    );
    expect(g.map((x) => [x.day, x.items.length])).toEqual([
      ['Hôm nay', 2],
      ['05/10/2026', 1],
    ]);
  });
  it('durations and filters', () => {
    expect(durationLabel('2026-10-07T01:00:00Z', '2026-10-07T01:00:45Z')).toBe('45 giây');
    expect(durationLabel('2026-10-07T01:00:00Z', '2026-10-07T02:05:00Z')).toBe('1 giờ 5 phút');
    expect(durationLabel('2026-10-07T01:00:00Z')).toBe('');
    const rows = [
      { video: 'vd_a', kind: 'main' },
      { video: 'vd_a', kind: 'frame' },
      { video: 'vd_b', kind: 'frame' },
    ];
    expect(filterSessions(rows, { video: 'vd_a' })).toHaveLength(2);
    expect(filterSessions(rows, { kind: 'frame' })).toHaveLength(2);
    expect(filterSessions(rows, { video: 'vd_b', kind: 'frame' })).toHaveLength(1);
  });
});
