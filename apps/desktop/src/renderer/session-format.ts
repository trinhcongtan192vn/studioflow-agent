/** Nhật ký phiên agent (048, FR-AP-14): nhãn loại phiên, nhóm theo ngày, thời lượng. Hàm thuần. */

export interface SessionRow {
  id: string;
  kind: string;
  source: 'chat' | 'session' | 'trace';
  video?: string;
  frame_id?: string;
  title: string;
  started_at: string;
  ended_at?: string;
  lines: number;
  error?: string;
  tokens?: number;
}

const KIND: Record<string, string> = {
  main: 'Chat',
  frame: 'Dựng frame',
  producer: 'Viết (producer)',
  critic: 'Chấm (critic)',
  ops: 'Vận hành (Telegram)',
  agent: 'Agent',
};
export const kindLabel = (k: string): string => KIND[k] ?? k;

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Nhãn ngày: Hôm nay / Hôm qua / dd/mm/yyyy (giờ máy). */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Không rõ ngày';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return 'Hôm nay';
  if (dayKey(d) === dayKey(y)) return 'Hôm qua';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Nhóm phiên (đã xếp mới trước) theo ngày, giữ thứ tự. */
export function groupByDay<T extends { started_at: string }>(
  rows: T[],
  now = new Date(),
): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const r of rows) {
    const day = dayLabel(r.started_at, now);
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(r);
    else out.push({ day, items: [r] });
  }
  return out;
}

export const timeOf = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Thời lượng phiên "2 phút", "45 giây", "1 giờ 5 phút". */
export function durationLabel(start: string, end?: string): string {
  if (!end) return '';
  const s = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 60) return `${s} giây`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút`;
  return `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ''}`;
}

/** Lọc theo video và loại phiên ('' = tất cả). */
export function filterSessions<T extends { video?: string; kind: string }>(
  rows: T[],
  f: { video?: string; kind?: string },
): T[] {
  return rows.filter((r) => (!f.video || r.video === f.video) && (!f.kind || r.kind === f.kind));
}
