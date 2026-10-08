// 073 — thông báo nổi cho video khác video đang mở; lọc lệnh Ctrl+K.
import { describe, expect, it } from 'vitest';
import { noticeToast, paletteFilter } from '../../src/renderer/palette-format';

const n = (event: 'started' | 'done' | 'waiting' | 'failed' | 'finished') => ({
  event,
  step_id: 'script',
  step_title: 'Kịch bản',
  position: [2, 12] as [number, number],
});

describe('noticeToast (073)', () => {
  it('only failures, approvals and finished workflows become toasts', () => {
    expect(noticeToast(n('started'), 'Lốc xoáy')).toBeNull();
    expect(noticeToast(n('done'), 'Lốc xoáy')).toBeNull();
    expect(noticeToast(n('failed'), 'Lốc xoáy')).toEqual({
      tone: 'error',
      text: 'Lốc xoáy — lỗi ở bước Kịch bản',
    });
    expect(noticeToast(n('waiting'), 'Lốc xoáy')).toEqual({
      tone: 'warn',
      text: 'Lốc xoáy — chờ bạn duyệt Kịch bản',
    });
    expect(noticeToast(n('finished'), 'Lốc xoáy')).toEqual({
      tone: 'success',
      text: 'Lốc xoáy — đã làm xong video',
    });
  });
});

describe('paletteFilter (073)', () => {
  const items = [
    { id: 'p:settings', label: 'Cài đặt', group: 'Trang' },
    { id: 'v:1', label: 'Lốc xoáy hình thành', group: 'Video' },
    { id: 'v:2', label: 'Lê Lợi và năm 1428', group: 'Video' },
    { id: 'a:new', label: 'Tạo video mới', group: 'Thao tác' },
  ];
  it('empty query keeps everything; words match in any order without accents', () => {
    expect(paletteFilter(items, '')).toHaveLength(4);
    expect(paletteFilter(items, 'loc xoay').map((x) => x.id)).toEqual(['v:1']);
    expect(paletteFilter(items, '1428 le').map((x) => x.id)).toEqual(['v:2']);
    expect(paletteFilter(items, 'video').map((x) => x.id)).toEqual(['a:new']);
  });
  it('prefix matches come first', () => {
    expect(
      paletteFilter(items, 'l')
        .map((x) => x.id)
        .slice(0, 2),
    ).toEqual(['v:1', 'v:2']);
  });
});
