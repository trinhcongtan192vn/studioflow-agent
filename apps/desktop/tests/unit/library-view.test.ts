// 097 AC-02/03: presentation filters and pagination boundaries, without changing the source list.
import { expect, it } from 'vitest';
import type { LibraryEntry } from '@studioflow/core';
import { libraryPage, renderDuration } from '../../src/renderer/library-view';

const rows: LibraryEntry[] = Array.from({ length: 26 }, (_, i) => ({
  video_id: `vd_${i}`,
  render_id: `rd_${i}`,
  title: i === 3 ? 'Đại Việt và lịch sử' : `Video ${i}`,
  mode: i % 2 ? 'draft' : 'release',
  format: i % 2 ? 'vertical' : 'horizontal',
  finished_at: new Date(Date.UTC(2026, 9, i + 1)).toISOString(),
  output_profile: 'yt-1080p30',
  file: `/renders/${i}.mp4`,
}));
it('097 pages sorted results without losing or repeating rows, clamps after filters shrink the list', () => {
  const first = libraryPage(rows, { page: 1, pageSize: 10 });
  const last = libraryPage(rows, { page: 99, pageSize: 10 });
  expect(first.items[0]!.render_id).toBe('rd_25');
  expect(last).toMatchObject({ page: 3, totalPages: 3, total: 26, from: 21, to: 26 });
  const ids = [1, 2, 3].flatMap((page) =>
    libraryPage(rows, { page, pageSize: 10 }).items.map((r) => r.render_id),
  );
  expect(new Set(ids).size).toBe(26);
  expect(rows[0]!.render_id).toBe('rd_0');
  expect(libraryPage(rows, { page: 3, pageSize: 10, query: 'dai viet' })).toMatchObject({
    page: 1,
    total: 1,
    from: 1,
    to: 1,
  });
  expect(libraryPage(rows, { query: 'không tồn tại' })).toMatchObject({
    page: 1,
    total: 0,
    from: 0,
    to: 0,
  });
});
it('097 combines format/mode/search before pagination and supports oldest-first', () => {
  expect(libraryPage(rows, { format: 'vertical', mode: 'release' }).total).toBe(0);
  expect(
    libraryPage(rows, { format: 'vertical', mode: 'draft', order: 'oldest' }).items[0]!.render_id,
  ).toBe('rd_1');
  expect(libraryPage(rows, { pageSize: 25 }).items).toHaveLength(25);
  expect(libraryPage(rows, { query: 'vd_25' }).items[0]!.render_id).toBe('rd_25');
  expect(renderDuration(59999)).toBe('0:59');
  expect(renderDuration(3661000)).toBe('1:01:01');
});
