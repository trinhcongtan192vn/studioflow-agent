/** Màn Autopilot + chạy nền (052): câu trạng thái, nhãn trạng thái mục, trạng thái gửi cho `main`. Hàm thuần. */

export interface StatusView {
  paused: boolean;
  running: boolean;
  waiting_until?: string;
  waiting_reason?: string;
  current?: { channel: string; video?: string; item_id: string; title: string; step_id?: string };
  today: { channel: string; name: string; date: string; items: { status: string }[] }[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Một câu: Autopilot đang làm gì. */
export function statusLine(s: StatusView): string {
  if (s.paused) return 'Autopilot đang tạm dừng.';
  if (s.waiting_until)
    return `${s.waiting_reason ?? 'Hết hạn mức Claude'} — chờ tới ${hhmm(s.waiting_until)} rồi làm tiếp.`;
  if (s.running && s.current)
    return `Đang làm: "${s.current.title}"${s.current.step_id ? ` — bước ${s.current.step_id}` : ''}.`;
  const left = s.today.reduce(
    (n, c) =>
      n + c.items.filter((i) => i.status === 'planned' || i.status === 'in_production').length,
    0,
  );
  if (!s.today.length) return 'Chưa có kênh nào bật Autopilot.';
  return left
    ? `Rảnh — còn ${left} video trong kế hoạch hôm nay (chạy trong khung giờ làm việc).`
    : 'Đã xong kế hoạch hôm nay.';
}

export const ITEM_STATUS: Record<string, string> = {
  planned: 'Chờ làm',
  in_production: 'Đang làm',
  produced: 'Đã làm xong',
  needs_review: 'Cần bạn xem',
  failed: 'Lỗi',
  skipped: 'Bỏ qua',
};
export const itemStatusLabel = (s: string): string => ITEM_STATUS[s] ?? s;

/** Đếm theo trạng thái cho dòng tóm tắt ("2 đã xong · 1 cần bạn xem"). */
export function itemSummary(items: { status: string }[]): string {
  const order = ['produced', 'in_production', 'planned', 'needs_review', 'failed', 'skipped'];
  const n = (st: string) => items.filter((i) => i.status === st).length;
  return order
    .filter((st) => n(st))
    .map((st) => `${n(st)} ${itemStatusLabel(st).toLowerCase()}`)
    .join(' · ');
}

/** Trạng thái gửi cho `main`: khay hệ thống, chống ngủ máy, nhãn menu khay. */
export function desktopState(
  s: StatusView | undefined,
  o: { anyAutopilot: boolean; background: boolean },
): { background: boolean; producing: boolean; paused: boolean; any: boolean } {
  return {
    background: o.anyAutopilot && o.background,
    producing: Boolean(s && !s.paused && s.running),
    paused: Boolean(s?.paused),
    any: o.anyAutopilot,
  };
}

/**
 * Bấm đóng cửa sổ: chạy nền → ẩn xuống khay; thoát hẳn (menu khay, Alt+F4 khi không chạy nền) → kiểm việc dở.
 * 090: Autopilot tạm dừng thì chạy nền vô ích → kiểm việc dở như kênh thường.
 */
export function closeAction(o: {
  quit: boolean;
  background: boolean;
  paused: boolean;
}): 'hide' | 'check' {
  return !o.quit && o.background && !o.paused ? 'hide' : 'check';
}
