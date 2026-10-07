import { addDays, zonedMs, zoneParts } from './plan.js';
import { isLimitHit } from './capacity.js';

/**
 * Thông báo chạm hạn mức gói Claude (052, NFR-11), ví dụ:
 * `Claude Code returned an error result: You've hit your weekly limit · resets 3am (Asia/Bangkok)`.
 * Đọc loại hạn mức và thời điểm hết hạn mức (giờ địa phương trong ngoặc, hoặc múi giờ dự phòng).
 */
export interface ParsedLimit {
  kind: 'weekly' | 'session' | 'usage';
  /** Thời điểm hết hạn mức gần nhất sau `now`; null = thông báo không có giờ đọc được. */
  resets_at: Date | null;
  time_zone: string;
}

const RESET =
  /resets\s+(?:([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const FALLBACK_MS = 60 * 60_000;
const MARGIN_MS = 60_000;

const validZone = (tz: string | undefined): tz is string => {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const pad = (n: number) => String(n).padStart(2, '0');

export function parseLimit(
  message: string | undefined,
  now: Date,
  fallbackZone: string,
): ParsedLimit | undefined {
  if (!isLimitHit(message)) return undefined;
  const text = message as string;
  const kind = /weekly/i.test(text) ? 'weekly' : /session|5-hour/i.test(text) ? 'session' : 'usage';
  const m = RESET.exec(text);
  if (!m) return { kind, resets_at: null, time_zone: fallbackZone };
  const time_zone = validZone(m[6]?.trim()) ? m[6]!.trim() : fallbackZone;
  let h = Number(m[3]);
  const min = Number(m[4] ?? 0);
  const pm = m[5]!.toLowerCase() === 'pm';
  if (h < 1 || h > 12 || min > 59) return { kind, resets_at: null, time_zone };
  h = (h % 12) + (pm ? 12 : 0);
  const today = zoneParts(now.getTime(), time_zone);
  const monthIdx = m[1] ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) : -1;
  let date: string;
  if (monthIdx >= 0) {
    // có ngày: năm hiện tại, đã qua → năm sau
    const day = Number(m[2]);
    let year = today.y;
    if (monthIdx + 1 < today.mo || (monthIdx + 1 === today.mo && day < today.d)) year += 1;
    date = `${year}-${pad(monthIdx + 1)}-${pad(day)}`;
  } else {
    date = `${today.y}-${pad(today.mo)}-${pad(today.d)}`;
  }
  let at = zonedMs(date, h, min, time_zone);
  if (monthIdx < 0 && at <= now.getTime()) at = zonedMs(addDays(date, 1), h, min, time_zone);
  return { kind, resets_at: new Date(at), time_zone };
}

/**
 * Lúc làm tiếp sau khi chạm hạn mức: giờ hết hạn mức + 1 phút đệm; không đọc được → `anchor` + 1 giờ.
 * `anchor` = lúc bước lỗi (không phải lúc đọc) để khởi động lại app vẫn tính đúng.
 */
export function limitResumeAt(message: string, anchor: Date, fallbackZone: string): Date {
  const r = parseLimit(message, anchor, fallbackZone);
  return r?.resets_at
    ? new Date(r.resets_at.getTime() + MARGIN_MS)
    : new Date(anchor.getTime() + FALLBACK_MS);
}
