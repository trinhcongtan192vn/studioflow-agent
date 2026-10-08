import type { IpcMethods } from '@studioflow/core';

export type TgStatus = IpcMethods['telegram.status']['result'];

/**
 * 083: nhãn trạng thái bot Telegram. Bật + có token mà chưa chạy = đang kết nối (không phải "đang dừng");
 * `disabled` = Telegram từ chối (token sai / nơi khác đang nhận tin).
 */
export function tgStateLabel(st: TgStatus): string {
  if (st.state === 'running') return st.last_error ? 'Đang chạy (lỗi mạng, thử lại…)' : 'Đang chạy';
  if (st.state === 'disabled') return 'Lỗi kết nối';
  if (!st.enabled) return 'Đang tắt';
  return st.has_token ? 'Đang kết nối…' : 'Chưa có token';
}

/** 083: gửi tin thử chỉ cần token + chat ID (không cần bot đang nhận lệnh). */
export function canTestTelegram(st: TgStatus | undefined): boolean {
  return Boolean(st?.has_token && st.chat_id_set);
}
