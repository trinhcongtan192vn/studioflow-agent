/**
 * URL đọc-only qua giao thức `sf-media:` (main chỉ cho video render, ảnh, audio xem trước). 089: scheme chuẩn
 * nên có host cố định `f`; từng đoạn đường dẫn được mã hóa (dấu tiếng Việt, khoảng trắng, `#`, `?`).
 */
export const mediaUrl = (abs: string): string => {
  // máy chủ media cục bộ (HTTP thật — video phát ổn định qua nhiều đoạn Range)
  const base = (globalThis as { studioflow?: { mediaBase?: string } }).studioflow?.mediaBase;
  if (base) return `${base}/${encodeURIComponent(abs.replace(/\\/g, '/'))}`;
  return sfMediaUrl(abs);
};

/** URL `sf-media:` (dự phòng khi chưa có máy chủ media). */
export const sfMediaUrl = (abs: string): string =>
  `sf-media://f/${abs
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`;
