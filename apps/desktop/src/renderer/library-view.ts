import type { LibraryEntry } from '@studioflow/core';
import { fold } from './video-list-format';

export interface LibraryViewOptions {
  query?: string;
  mode?: 'all' | 'release' | 'draft';
  format?: 'all' | 'horizontal' | 'vertical';
  order?: 'newest' | 'oldest';
  page?: number;
  pageSize?: number;
}

/** 097: filter and paginate the existing render list for display. */
export function libraryPage(list: readonly LibraryEntry[], o: LibraryViewOptions = {}) {
  const query = fold(o.query?.trim() ?? '');
  const rows = list
    .filter(
      (r) =>
        (!o.mode || o.mode === 'all' || r.mode === o.mode) &&
        (!o.format || o.format === 'all' || r.format === o.format) &&
        (!query || fold(`${r.title} ${r.video_id} ${r.render_id}`).includes(query)),
    )
    .sort((a, b) => {
      const time = (Date.parse(b.finished_at) || 0) - (Date.parse(a.finished_at) || 0);
      return (
        (o.order === 'oldest' ? -time : time) ||
        `${a.video_id}/${a.render_id}`.localeCompare(`${b.video_id}/${b.render_id}`)
      );
    });
  const size = [10, 25, 50].includes(o.pageSize ?? 10) ? (o.pageSize ?? 10) : 10;
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const requested = Number.isFinite(o.page) ? Math.floor(o.page!) : 1;
  const page = Math.max(1, Math.min(totalPages, requested));
  const start = (page - 1) * size;
  return {
    items: rows.slice(start, start + size),
    page,
    totalPages,
    total,
    from: total ? start + 1 : 0,
    to: Math.min(start + size, total),
  };
}

export function renderDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
    : `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
}
