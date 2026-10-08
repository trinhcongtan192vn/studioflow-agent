/**
 * 089: đoạn byte trả cho một yêu cầu `sf-media:` có Range. Đoạn mở (`bytes=N-`) giới hạn `MEDIA_CHUNK` byte:
 * trình phát xin tiếp đoạn sau. Trả cả file trong một luồng mở làm Chromium hủy giữa chừng rồi xin đoạn mới,
 * và luồng đọc file lỗi → video dừng sau 1–2 giây (`PIPELINE_ERROR_READ`).
 */
export const MEDIA_CHUNK = 2 * 1024 * 1024;

export type MediaSlice =
  | { status: 200; start: 0; end: number }
  | { status: 206; start: number; end: number }
  | { status: 416 };

export function mediaSlice(range: string | null, size: number, chunk = MEDIA_CHUNK): MediaSlice {
  const m = /^bytes=(\d*)-(\d*)$/.exec((range ?? '').trim());
  if (!m || (!m[1] && !m[2])) return { status: 200, start: 0, end: size - 1 };
  let start: number;
  let end: number;
  if (!m[1]) {
    // hậu tố: N byte cuối
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || end < start) return { status: 416 };
  return { status: 206, start, end: Math.min(end, start + chunk - 1) };
}
