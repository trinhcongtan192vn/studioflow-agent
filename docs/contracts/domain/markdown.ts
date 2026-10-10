// Front matter và mô hình đã parse của artifact Markdown (D3 mục 5.1–5.6, 5.15).
// D3 chỉ cho các phần này bằng ví dụ YAML/mô tả nên file này được viết tay, bám đúng ví dụ;
// mọi kiểu dùng lại từ d3.ts (sinh tự động). Xem specs/002-domain-artifacts/research.md R2.
import type {
  Beat,
  CastId,
  CastMember,
  Frame,
  Iso8601,
  Lang,
  Line,
  Ms,
  Scene,
  Sha256,
  VideoId,
  Versioned,
} from './d3';

export type DocStatus = 'draft' | 'approved';

/** D3 5.2 */
export interface BriefFrontMatter extends Versioned {
  video_id: VideoId;
  /** Đề xuất của router; null khi chưa đề xuất. */
  proposed_workflow: { id: string; version: string } | null;
  proposed_output_profile: string | null;
  source_video_id: VideoId | null;
  language: Lang;
  target_duration_ms: Ms | null;
  title_working: string;
  approved_at: Iso8601 | null;
}

/** D3 5.3 */
export interface FrameMdFrontMatter extends Versioned {
  generated_from: Sha256;
  /** Design system cấp kênh (2026-10-10): băm phần màu/chữ/layout — để biết video lệch design kênh. */
  design_look?: string;
  /** Băm phong cách ảnh của design kênh. */
  design_images?: string;
  /** Băm nhịp đọc (tốc độ, nghỉ giữa câu) của design kênh. */
  design_voice?: string;
}

/** D3 5.3b */
export interface StoryFrontMatter extends Versioned {
  video_id: VideoId;
  status: DocStatus;
}

/** D3 5.3b — khối `sf-story` dưới mỗi heading `##`. */
export interface StoryBlock {
  title: string;
  summary: string;
  characters: string[];
  setting: string;
  beats: string[];
}

export interface StoryDoc {
  front: StoryFrontMatter;
  scenes: StoryBlock[];
}

/** D3 5.4 */
export interface ScriptFrontMatter extends Versioned {
  video_id: VideoId;
  language: Lang;
  status: DocStatus;
}

export interface ScriptDoc {
  front: ScriptFrontMatter;
  beats: Beat[];
  lines: Line[];
}

/** D3 5.5 */
export interface StoryboardFrontMatter extends Versioned {
  video_id: VideoId;
  status: DocStatus;
}

export interface StoryboardDoc {
  front: StoryboardFrontMatter;
  scenes: Scene[];
  frames: Frame[];
}

/** D3 5.6 — front matter của CAST.md (video). */
export interface CastFrontMatter extends Versioned {
  video_id: VideoId;
}

/** D3 5.6 — mục trong khối `sf-cast`: tham chiếu cast kênh theo `id`, có thể ghi đè trường. */
export type CastEntry = { id: CastId } & Partial<Omit<CastMember, 'id'>>;

export interface CastDoc {
  front: CastFrontMatter;
  cast: CastEntry[];
}

/** D3 5.15 */
export interface PublishFrontMatter extends Versioned {
  video_id: VideoId;
  title: string;
  tags: string[];
  chapters: { start_ms: Ms; title: string }[];
  status: DocStatus;
}
