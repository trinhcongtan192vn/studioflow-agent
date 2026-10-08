/** 070: danh sách video dạng thẻ ở sidebar — hàm thuần (nhãn, nhóm, thời gian, tìm kiếm). */
import type { VideoStatus } from '@studioflow/core';

export interface CardLike {
  id: string;
  title: string;
  status: VideoStatus;
  updated_at: string;
  current?: { id: string; title: string };
}

const LABEL: Record<VideoStatus, string> = {
  failed: 'Lỗi',
  waiting: 'Chờ duyệt',
  running: 'Đang làm',
  paused: 'Tạm dừng',
  briefing: 'Đang lên ý tưởng',
  done: 'Xong',
};

export function statusLabel(v: Pick<CardLike, 'status' | 'current'>): string {
  const base = LABEL[v.status];
  return v.current && v.status !== 'done' && v.status !== 'briefing'
    ? `${base} · ${v.current.title}`
    : base;
}

const GROUPS: { label: string; of: VideoStatus[] }[] = [
  { label: 'Cần bạn', of: ['failed', 'waiting'] },
  { label: 'Đang làm', of: ['running', 'paused', 'briefing'] },
  { label: 'Xong', of: ['done'] },
];

/** Bỏ dấu tiếng Việt để tìm "loc xoay" ra "Lốc xoáy". */
export const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export function groupVideos<T extends CardLike>(
  list: readonly T[],
  query: string,
): { label: string; items: T[] }[] {
  const q = fold(query.trim());
  const hit = q ? list.filter((v) => fold(`${v.title} ${v.id}`).includes(q)) : list;
  return GROUPS.map((g) => ({
    label: g.label,
    items: hit.filter((v) => g.of.includes(v.status)),
  })).filter((g) => g.items.length);
}

export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày trước`;
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
