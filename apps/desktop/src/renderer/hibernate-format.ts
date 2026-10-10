/** Hẹn giờ ngủ đông máy sau khi xong hết việc (2026-10-10). Hàm thuần. */

/** Phần của `app.activity` dùng để biết app còn việc hay không. */
export interface WorkActivity {
  steps: unknown[];
  jobs: unknown[];
  queued?: number;
  chats: unknown[];
}

/** Đếm ngược trước khi ngủ đông (giây) — để kịp bấm Hủy. */
export const HIBERNATE_COUNTDOWN_S = 60;

/**
 * Còn việc: bước workflow đang chạy, job đang chạy/xếp hàng, agent đang trả lời. Studio đang mở hay video
 * Autopilot đang chờ người dùng không phải việc đang chạy.
 */
export const isBusy = (a: WorkActivity): boolean =>
  a.steps.length > 0 || a.jobs.length > 0 || (a.queued ?? 0) > 0 || a.chats.length > 0;

export interface IdleTick {
  /** Lúc bắt đầu rảnh liên tục; `null` = đang có việc. */
  idleSince: number | null;
  /** Đã rảnh đủ X phút → hỏi ngủ đông. */
  due: boolean;
  /** Còn bao lâu nữa thì đủ (ms); 0 khi `due`; `null` khi đang có việc. */
  leftMs: number | null;
}

/** Một lần kiểm tra: có việc → đặt lại; rảnh liên tục đủ `minutes` phút → `due`. */
export function idleTick(
  idleSince: number | null,
  busy: boolean,
  now: number,
  minutes: number,
): IdleTick {
  if (busy) return { idleSince: null, due: false, leftMs: null };
  const since = idleSince ?? now;
  const left = Math.max(0, since + minutes * 60_000 - now);
  return { idleSince: since, due: left === 0, leftMs: left };
}

/** Số phút hợp lệ (1–720), mặc định 15. */
export function clampMinutes(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 720) : 15;
}

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Dòng trạng thái ở thanh dưới. */
export function hibernateLabel(armed: boolean, minutes: number, tick: IdleTick | null): string {
  if (!armed) return 'Ngủ đông: tắt';
  if (!tick || tick.leftMs === null)
    return `Ngủ đông sau ${minutes} phút khi xong việc — đang chờ việc chạy xong`;
  return `Hết việc — ngủ đông sau ${mmss(tick.leftMs)}`;
}
