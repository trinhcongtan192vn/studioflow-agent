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
  // 078: chưa kết nối nền tảng → nói rõ thay vì "chờ tải lên"
  if (st?.status === 'pending' && st.error) return { tone: 'warn', text: st.error };
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

/** 091: kết quả một nền tảng ở bước "Đăng lên nền tảng" (đăng ngay, không hẹn giờ). */
export function publishResultText(st: St): string {
  switch (st.status) {
    case 'public':
      return 'Đã công khai';
    case 'private':
      return `Riêng tư${st.note ? ` — ${st.note}` : ''}`;
    case 'uploading':
      return 'Đang tải lên…';
    case 'failed':
      return `Lỗi: ${st.error ?? st.note ?? 'không rõ'}`;
    case 'scheduled':
      return `Đã hẹn công khai${st.publish_at ? ` ${at(st.publish_at)}` : ''}`;
    case 'cancelled':
      return st.note ?? 'Đã hủy';
    default:
      return 'Chờ tải lên';
  }
}

/** 091: dòng tóm tắt dưới bộ chọn nền tảng. */
export function pickerSummary(labels: string[]): string {
  return labels.length ? `Đăng lên ${labels.join(', ')}` : 'Chưa chọn nền tảng nào';
}
