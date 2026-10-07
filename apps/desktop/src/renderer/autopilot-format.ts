/** Cài đặt Autopilot (047): chuyển ô nhập ↔ giá trị khóa D3, nhãn nguồn, mô tả chế độ. Hàm thuần. */

/** "a, b ,c" / xuống dòng → ["a","b","c"] (bỏ rỗng, bỏ trùng, giữ thứ tự). */
export function parseList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
}

export const formatList = (v: unknown): string => (Array.isArray(v) ? v.join(', ') : '');

/** Nguồn giá trị (D3 7.1) → nhãn tiếng Việt. */
export function sourceLabel(source: string): string {
  return source === 'channel' ? 'kênh' : source === 'app' ? 'cài đặt app' : 'mặc định';
}

/** % ngân sách ↔ tỉ lệ 0–1. */
export const shareToPercent = (v: unknown): string =>
  typeof v === 'number' ? String(Math.round(v * 100)) : '';
export const percentToShare = (s: string): number | undefined => {
  const n = Number(s);
  return s.trim() && Number.isFinite(n) ? n / 100 : undefined;
};

export const PLATFORM_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  facebook: 'Facebook',
};

/** Một dòng tóm tắt kênh cho danh sách kênh quản lý. */
export function channelSummary(c: {
  autopilot: boolean;
  competitors: number;
  exists: boolean;
}): string {
  if (!c.exists) return 'Không tìm thấy thư mục kênh';
  if (!c.autopilot) return 'Manual';
  return c.competitors
    ? `Autopilot · ${c.competitors} đối thủ`
    : 'Autopilot · chưa có đối thủ (vào Cài đặt kênh để thêm)';
}

/** Số người đăng ký gọn (1,2 Tr / 45 N). */
export function compactCount(n: number | null): string {
  if (n === null) return 'ẩn';
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace('.', ',').replace(/,0$/, '')} Tr`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} N`;
  return String(n);
}
