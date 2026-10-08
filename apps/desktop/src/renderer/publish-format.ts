/** 074: màn Duyệt trước khi đăng — chữ trạng thái từng nền tảng, nút được phép. Hàm thuần. */
type St = {
  status: 'pending' | 'uploading' | 'scheduled' | 'private' | 'public' | 'cancelled' | 'failed';
  publish_at?: string;
  veto_until?: string;
  error?: string;
  note?: string;
};

export const PLATFORM_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  facebook: 'Facebook',
};

/** "19:00 08/10" theo múi giờ `tz` (mặc định giờ máy). */
export function at(iso: string | null | undefined, tz?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      ...(tz ? { timeZone: tz } : {}),
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}`;
}

export function platformState(
  st: St | undefined,
  plannedAt: string | null,
  now = Date.now(),
  tz?: string,
): { tone: 'idle' | 'warn' | 'ok' | 'error'; text: string } {
  if (!st || st.status === 'pending')
    return { tone: 'idle', text: `Chờ tải lên${plannedAt ? ` · đăng ${at(plannedAt, tz)}` : ''}` };
  switch (st.status) {
    case 'uploading':
      return { tone: 'idle', text: 'Đang tải lên…' };
    case 'scheduled':
      return st.veto_until && Date.parse(st.veto_until) > now
        ? {
            tone: 'warn',
            text: `Chờ phản đối đến ${at(st.veto_until, tz)}${st.publish_at ? ` · công khai ${at(st.publish_at, tz)}` : ''}`,
          }
        : {
            tone: 'ok',
            text: `Đã hẹn công khai${st.publish_at ? ` ${at(st.publish_at, tz)}` : ''}`,
          };
    case 'private':
      return {
        tone: 'warn',
        text: 'Riêng tư — công khai thủ công trong YouTube Studio (API chưa được kiểm duyệt)',
      };
    case 'public':
      return { tone: 'ok', text: 'Đã công khai' };
    case 'cancelled':
      return { tone: 'idle', text: st.note ?? 'Đã hủy đăng' };
    case 'failed':
      return { tone: 'error', text: `Lỗi: ${st.error ?? st.note ?? 'không rõ'}` };
  }
}

/** Đăng ngay: chỉ khi video đã lên nền tảng; Hủy: tới khi công khai / đã hủy. */
export function platformActions(st: St | undefined): { now: boolean; cancel: boolean } {
  if (!st) return { now: false, cancel: false };
  return {
    now: st.status === 'scheduled' || st.status === 'private',
    cancel: !['public', 'cancelled'].includes(st.status),
  };
}
