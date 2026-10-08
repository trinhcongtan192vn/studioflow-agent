import type { PlanItemStatus } from '../contracts/types.js';
import type { AutopilotStatus } from '../autopilot/runner.js';
import { escapeHtml } from './client.js';

/** Định dạng tin nhắn tiếng Việt (HTML của Telegram) cho lệnh bot và thông báo vận hành (055). */
const ICON: Record<PlanItemStatus, string> = {
  planned: '🕒',
  in_production: '🎬',
  produced: '✅',
  needs_review: '⚠️',
  failed: '❌',
  skipped: '⏭',
};
const LABEL: Record<PlanItemStatus, string> = {
  planned: 'chờ làm',
  in_production: 'đang làm',
  produced: 'đã xong',
  needs_review: 'cần bạn xem',
  failed: 'hỏng',
  skipped: 'bỏ qua',
};

const e = escapeHtml;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Giờ HH:MM theo múi giờ của giá trị ISO (giữ nguyên offset đã ghi). */
export function hhmm(iso: string | null | undefined): string {
  const m = /T(\d{2}:\d{2})/.exec(iso ?? '');
  return m ? m[1]! : '--:--';
}

/** /status: tạm dừng/đang chạy, video đang làm, hạn mức, số mục hôm nay theo trạng thái. */
export function formatStatus(s: AutopilotStatus): string {
  const lines: string[] = [];
  lines.push(
    s.paused
      ? '⏸ <b>Autopilot đang tạm dừng</b>'
      : s.running
        ? '▶️ <b>Autopilot đang chạy</b>'
        : '🟢 <b>Autopilot đang chờ lượt</b>',
  );
  if (s.waiting_until)
    lines.push(`⏳ ${e(s.waiting_reason ?? 'Chờ hạn mức Claude')} — chờ tới ${e(s.waiting_until)}`);
  if (s.current)
    lines.push(
      `🎬 Đang làm: “${e(clip(s.current.title, 80))}”${s.current.step_id ? ` (bước ${e(s.current.step_id)})` : ''}`,
    );
  if (!s.today.length) lines.push('Chưa có kênh nào bật Autopilot.');
  for (const c of s.today) {
    const n: Partial<Record<PlanItemStatus, number>> = {};
    for (const i of c.items) n[i.status] = (n[i.status] ?? 0) + 1;
    const parts = (Object.keys(LABEL) as PlanItemStatus[])
      .filter((k) => n[k])
      .map((k) => `${ICON[k]} ${n[k]} ${LABEL[k]}`);
    lines.push(
      `\n<b>${e(c.name)}</b> (${e(c.date)}): ${parts.length ? parts.join(' · ') : 'chưa có kế hoạch'}`,
    );
  }
  return lines.join('\n');
}

/** /plan: từng mục kế hoạch hôm nay (giờ đăng, tiêu đề, trạng thái, ghi chú). */
export function formatPlans(s: AutopilotStatus): string {
  if (!s.today.length) return 'Chưa có kênh nào bật Autopilot.';
  const out: string[] = [];
  for (const c of s.today) {
    out.push(`<b>${e(c.name)}</b> — kế hoạch ${e(c.date)}`);
    if (!c.items.length) out.push('  (chưa có mục nào)');
    for (const i of c.items) {
      out.push(
        `${ICON[i.status]} ${hhmm(i.publish_at)} ${e(clip(i.title, 90))} — ${LABEL[i.status]}${i.note ? `: ${e(clip(i.note, 140))}` : ''}`,
      );
    }
    out.push('');
  }
  return out.join('\n').trim();
}

export const HELP_TEXT = [
  '<b>StudioFlow Autopilot</b> — lệnh:',
  '/status — Autopilot đang làm gì',
  '/plan — kế hoạch hôm nay của các kênh',
  '/pause — tạm dừng Autopilot',
  '/resume — tiếp tục Autopilot',
  '/report — báo cáo hôm nay',
  '/help — danh sách lệnh',
  '',
  'Hỏi tự do: nhắc tên bot (@tên_bot …), trả lời một tin của bot, hoặc nhắn riêng cho bot.',
].join('\n');

/** Sự kiện vận hành gửi thành thông báo (từ nhật ký của bộ chạy Autopilot, 052). */
export interface NotifyEvent {
  /** Mã sự kiện của nhật ký vận hành (D3 5.19) hoặc của tính năng đăng bài. */
  kind: string;
  channel: string;
  channel_name?: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  item_id?: string;
  video_id?: string;
  data?: Record<string, unknown>;
}

const NOTIFY_ICON: Record<string, string> = {
  'item.parked': '⚠️',
  'item.failed': '❌',
  'limit.hit': '⏳',
  'plan.built': '🗓',
  // 053: đăng bài (bản xem trước đã có tin riêng kèm nút)
  'publish.failed': '📤❌',
  'publish.pending': '🔌',
  'publish.public': '🌐',
};

/** Các loại sự kiện được gửi; loại khác → `undefined` (không thông báo). */
export function formatNotification(ev: NotifyEvent): string | undefined {
  const icon = NOTIFY_ICON[ev.kind];
  if (!icon) return undefined;
  const who = ev.channel_name ?? ev.channel;
  return `${icon} <b>${e(who)}</b>\n${e(clip(ev.message, 600))}`;
}
