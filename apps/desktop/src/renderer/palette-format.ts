/** 073: thông báo nổi + bảng lệnh Ctrl+K — hàm thuần. */
import type { WorkflowNotice } from '@studioflow/core';
import { fold } from './video-list-format';

export type ToastTone = 'error' | 'warn' | 'success' | 'info';

/** Thông báo workflow của một video (không phải video đang mở) → toast; bước bắt đầu/xong thường → không. */
export function noticeToast(
  n: Pick<WorkflowNotice, 'event' | 'step_title'>,
  videoTitle: string,
): { tone: ToastTone; text: string } | null {
  switch (n.event) {
    case 'failed':
      return { tone: 'error', text: `${videoTitle} — lỗi ở bước ${n.step_title}` };
    case 'waiting':
      return { tone: 'warn', text: `${videoTitle} — chờ bạn duyệt ${n.step_title}` };
    case 'finished':
      return { tone: 'success', text: `${videoTitle} — đã làm xong video` };
    default:
      return null;
  }
}

export interface PaletteItem {
  id: string;
  label: string;
  group: string;
  hint?: string;
}

/** Mọi từ của câu tìm phải có trong nhãn (không dấu, không phân biệt hoa thường); khớp đầu nhãn lên trước. */
export function paletteFilter<T extends PaletteItem>(items: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  const hits = items.filter((x) => {
    const l = fold(x.label);
    return words.every((w) => l.includes(w));
  });
  const first = words[0]!;
  return [
    ...hits.filter((x) => fold(x.label).startsWith(first)),
    ...hits.filter((x) => !fold(x.label).startsWith(first)),
  ];
}
