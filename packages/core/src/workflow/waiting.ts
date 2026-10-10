/** Đuôi lỗi của bước mà agent dừng lượt để hỏi người dùng (083). */
export const AWAITING_REPLY = 'waiting for your reply in chat';
/** Đuôi lỗi của bước Đăng khi người dùng chưa chọn nền tảng (091, chế độ thủ công). */
export const PUBLISH_CHOOSE = 'waiting for you to choose where to publish';

/**
 * Bước `failed` thật ra đang chờ người dùng (chờ bấm Đăng ở chế độ thủ công, agent chờ trả lời) — không phải lỗi:
 * giao diện hiện "Chờ bạn", thẻ video tính là đang chờ (2026-10-10).
 */
export function isWaitingUser(s: {
  status: string;
  error?: { code?: string; message?: string };
}): boolean {
  return (
    s.status === 'failed' &&
    s.error?.code === 'E_STEP_INCOMPLETE' &&
    (s.error.message?.endsWith(AWAITING_REPLY) === true ||
      s.error.message?.endsWith(PUBLISH_CHOOSE) === true)
  );
}
