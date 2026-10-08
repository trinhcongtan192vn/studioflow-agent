// 070 — danh sách video dạng thẻ: nhãn trạng thái, nhóm, thời gian tương đối, tìm kiếm.
import { describe, expect, it } from 'vitest';
import {
  groupVideos,
  relativeTime,
  statusLabel,
  type CardLike,
} from '../../src/renderer/video-list-format';

const v = (id: string, status: CardLike['status'], title = id): CardLike => ({
  id,
  title,
  status,
  updated_at: '2026-10-08T00:00:00Z',
});

describe('video list (070)', () => {
  it('labels statuses in Vietnamese with the step that needs attention', () => {
    expect(statusLabel({ status: 'failed', current: { id: 's', title: 'Kịch bản' } })).toBe(
      'Lỗi · Kịch bản',
    );
    expect(statusLabel({ status: 'waiting', current: { id: 's', title: 'Kịch bản' } })).toBe(
      'Chờ duyệt · Kịch bản',
    );
    expect(statusLabel({ status: 'running', current: { id: 's', title: 'Giọng' } })).toBe(
      'Đang làm · Giọng',
    );
    expect(statusLabel({ status: 'done' })).toBe('Xong');
    expect(statusLabel({ status: 'briefing' })).toBe('Đang lên ý tưởng');
    expect(statusLabel({ status: 'paused', current: { id: 's', title: 'Frame' } })).toBe(
      'Tạm dừng · Frame',
    );
  });

  it('groups: needs you, in progress, done — empty groups dropped; search by title', () => {
    const list = [
      v('a', 'done'),
      v('b', 'failed'),
      v('c', 'running'),
      v('d', 'waiting', 'Lốc xoáy'),
    ];
    expect(groupVideos(list, '').map((g) => [g.label, g.items.map((x) => x.id)])).toEqual([
      ['Cần bạn', ['b', 'd']],
      ['Đang làm', ['c']],
      ['Xong', ['a']],
    ]);
    expect(groupVideos(list, 'loc xoay').map((g) => g.items.map((x) => x.id))).toEqual([['d']]);
    expect(groupVideos([v('a', 'done')], '').map((g) => g.label)).toEqual(['Xong']);
  });

  it('formats relative time', () => {
    const now = Date.parse('2026-10-08T12:00:00Z');
    expect(relativeTime('2026-10-08T11:59:40Z', now)).toBe('vừa xong');
    expect(relativeTime('2026-10-08T11:15:00Z', now)).toBe('45 phút trước');
    expect(relativeTime('2026-10-08T07:00:00Z', now)).toBe('5 giờ trước');
    expect(relativeTime('2026-10-06T12:00:00Z', now)).toBe('2 ngày trước');
    expect(relativeTime('2026-08-01T12:00:00Z', now)).toBe('01/08/2026');
  });
});
