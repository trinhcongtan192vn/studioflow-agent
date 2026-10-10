/**
 * Giới hạn đăng của từng nền tảng — tra từ tài liệu chính thức ngày `CHECKED` (không dùng số nhớ). Khi
 * nền tảng đổi giới hạn: tra lại các trang dưới, sửa số và ngày.
 *
 * - YouTube: support.google.com/youtube/answer/15424877 (Shorts ≤ 3 phút, khung vuông/dọc),
 *   answer/10059070 (Shorts tối đa 1080p), developers.google.com/youtube/v3/docs/videos (tiêu đề 100 ký tự,
 *   mô tả 5000 byte, tag 500 ký tự).
 * - Facebook Reels: developers.facebook.com/docs/video-api/guides/reels-publishing (3–90 s, 9:16, tối thiểu
 *   540×960, 24–60 fps cố định, H.264/H.265, AAC-LC 48 kHz stereo, GOP đóng 2–5 s, 30 bài API/24 giờ).
 * - TikTok: developers.tiktok.com/doc/content-posting-api-media-transfer-guide (MP4/WebM/MOV, H.264/H.265,
 *   23–60 fps, cạnh 360–4096 px, ≤ 4 GB, API ≤ 10 phút; mọi tài khoản đăng được 3 phút), …-query-creator-info
 *   (`max_video_post_duration_sec` theo tài khoản), …-direct-post (caption ≤ 2200 UTF-16).
 */
export const PLATFORM_LIMITS = {
  CHECKED: '2026-10-10',
  youtube: { shorts_max_s: 180, shorts_max_short_side: 1080 },
  facebook: { min_s: 3, max_s: 90, min_w: 540, min_h: 960, fps: [24, 60], gop_max_s: 5 },
  tiktok: {
    min_side: 360,
    max_side: 4096,
    fps: [23, 60],
    max_bytes: 4 * 1024 ** 3,
    /** Trần API; trần thật theo tài khoản lấy từ `creator_info`. */
    api_max_s: 600,
    /** Mọi tài khoản TikTok đăng được 3 phút (trần tối thiểu khi chưa hỏi `creator_info`). */
    baseline_max_s: 180,
  },
} as const;

export type PlatformId = 'youtube' | 'facebook' | 'tiktok';

/** Thông số của file video đã render (ffprobe). */
export interface MediaInfo {
  duration_ms: number;
  width: number;
  height: number;
  fps: number;
  vcodec: string;
  pix_fmt: string;
  acodec?: string;
  sample_rate?: number;
  channels?: number;
  bytes: number;
  /** Khoảng cách keyframe lớn nhất (giây). */
  max_gop_s?: number;
}

const s1 = (ms: number) => `${Math.round(ms / 100) / 10} s`;

/**
 * Trần thời lượng (giây) cho video dọc theo các nền tảng đích — để kịch bản/giọng đọc vừa ngay từ đầu.
 * TikTok: trần tối thiểu mọi tài khoản (trần riêng kiểm lại lúc đăng).
 */
export function platformMaxSeconds(
  platforms: readonly string[],
): { max_s: number; by: string } | undefined {
  const caps: [string, number][] = [];
  if (platforms.includes('facebook')) caps.push(['Facebook Reels', PLATFORM_LIMITS.facebook.max_s]);
  if (platforms.includes('tiktok')) caps.push(['TikTok', PLATFORM_LIMITS.tiktok.baseline_max_s]);
  if (!caps.length) return undefined;
  const [by, max_s] = caps.reduce((a, b) => (b[1] < a[1] ? b : a));
  return { max_s, by };
}

/**
 * Vấn đề khiến nền tảng từ chối file (rỗng = đăng được). `maxSeconds` ghi đè trần thời lượng (TikTok theo
 * `creator_info`). YouTube: video dọc > 3 phút vẫn đăng được nhưng thành video thường, không phải Shorts.
 */
export function publishProblems(
  platform: PlatformId,
  m: MediaInfo,
  o: { maxSeconds?: number; ignoreDuration?: boolean } = {},
): string[] {
  const out: string[] = [];
  const vertical = m.height > m.width;
  const fpsIn = (r: readonly number[]) => m.fps >= r[0]! && m.fps <= r[1]!;
  const h26x = /^(h264|hevc)$/.test(m.vcodec);
  if (platform === 'facebook') {
    const L = PLATFORM_LIMITS.facebook;
    const max = o.maxSeconds ?? L.max_s;
    if (!o.ignoreDuration && (m.duration_ms < L.min_s * 1000 || m.duration_ms > max * 1000))
      out.push(
        `thời lượng ${s1(m.duration_ms)} ngoài khoảng ${L.min_s}–${max} s của Facebook Reels`,
      );
    if (!vertical || Math.abs(m.width / m.height - 9 / 16) > 0.01)
      out.push(`Facebook Reels cần khung 9:16 (bản này ${m.width}×${m.height})`);
    if (m.width < L.min_w || m.height < L.min_h)
      out.push(`độ phân giải ${m.width}×${m.height} dưới tối thiểu ${L.min_w}×${L.min_h}`);
    if (!fpsIn(L.fps)) out.push(`${m.fps} fps ngoài khoảng ${L.fps[0]}–${L.fps[1]} fps`);
    if (!h26x) out.push(`codec hình ${m.vcodec} (cần H.264/H.265)`);
    if (m.acodec && m.acodec !== 'aac') out.push(`codec tiếng ${m.acodec} (cần AAC)`);
    if (m.max_gop_s !== undefined && m.max_gop_s > L.gop_max_s + 0.05)
      out.push(`khoảng cách keyframe ${m.max_gop_s.toFixed(1)} s (Facebook cần GOP 2–5 s)`);
  } else if (platform === 'tiktok') {
    const L = PLATFORM_LIMITS.tiktok;
    const max = o.maxSeconds ?? L.api_max_s;
    if (!o.ignoreDuration && m.duration_ms > max * 1000)
      out.push(`thời lượng ${s1(m.duration_ms)} vượt ${max} s tài khoản TikTok này được đăng`);
    if (!vertical) out.push(`TikTok cần video dọc (bản này ${m.width}×${m.height})`);
    if (Math.min(m.width, m.height) < L.min_side || Math.max(m.width, m.height) > L.max_side)
      out.push(`kích thước ${m.width}×${m.height} ngoài ${L.min_side}–${L.max_side} px`);
    if (!fpsIn(L.fps)) out.push(`${m.fps} fps ngoài khoảng ${L.fps[0]}–${L.fps[1]} fps`);
    if (!h26x) out.push(`codec hình ${m.vcodec} (cần H.264/H.265)`);
    if (m.bytes > L.max_bytes) out.push('file lớn hơn 4 GB');
  } else {
    if (!/^(h264|hevc|vp9|av1)$/.test(m.vcodec)) out.push(`codec hình ${m.vcodec} lạ với YouTube`);
    if (vertical && Math.min(m.width, m.height) > PLATFORM_LIMITS.youtube.shorts_max_short_side)
      out.push(`Shorts tối đa 1080p (bản này ${m.width}×${m.height})`);
  }
  if (m.pix_fmt !== 'yuv420p') out.push(`pixel format ${m.pix_fmt} (cần yuv420p / 4:2:0)`);
  return out;
}
