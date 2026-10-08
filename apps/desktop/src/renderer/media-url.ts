/**
 * URL đọc-only qua giao thức `sf-media:` (main chỉ cho video render, ảnh, audio xem trước). 089: scheme chuẩn
 * nên có host cố định `f`; từng đoạn đường dẫn được mã hóa (dấu tiếng Việt, khoảng trắng, `#`, `?`).
 */
export const mediaUrl = (abs: string): string =>
  `sf-media://f/${abs
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')}`;
