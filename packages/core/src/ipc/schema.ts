// Hợp đồng IPC renderer ↔ core (D10 mục 4, 008): JSON-RPC 2.0 qua MessagePort do `main` cấp.
// D10 ghi đường dẫn `packages/core/ipc/schema.ts`; đặt trong `src/` để biên dịch cùng core (008 R1).
import type { WorkflowNotice } from '../workflow/notices.js';
import type {
  AgentEvent,
  CaptionOverrides,
  ContextRef,
  JobInfo,
  VideoStateSummary,
} from '../contracts/types.js';
import type { CaptionsPanelData } from '../captions/panel.js';
import type { CostReport } from '../trace/cost.js';

export interface ChannelRef {
  channel: string;
}
export interface VideoRef extends ChannelRef {
  video: string;
}

export interface ChatLine {
  ts: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool?: { name: string; input?: unknown; output_summary?: string; ok?: boolean };
  /** Thông báo workflow do app đăng (041): giao diện vẽ thẻ có nút hành động. */
  notice?: WorkflowNotice;
  /** Dòng đầu nhật ký phiên con (048): loại phiên, video/frame. */
  session?: { id: string; kind: string; video_id?: string; frame_id?: string };
  /** Token của lượt (dòng kết thúc phiên con, 048). */
  usage?: { input_tokens: number; output_tokens: number };
}

export interface ExplorerNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size?: number;
  children?: ExplorerNode[];
}

/** Phương thức renderer gọi (tham số → kết quả). */
export interface IpcMethods {
  'app.status': {
    params: Record<string, never>;
    result: {
      core_version: string;
      auth: { ok: boolean; method: string; detail?: string };
      install: { profile: string; total_bytes: number; missing: string[] };
    };
  };
  'channel.open': {
    params: ChannelRef;
    result: {
      config: unknown;
      videos: { id: string; title: string; phase: string; updated_at: string }[];
    };
  };
  'channel.init': {
    params: ChannelRef & { name: string; language: 'vi' | 'de' | 'en' };
    result: { config: unknown };
  };
  /** Kênh app quản lý (047, Autopilot M6): mở kênh lần đầu → thêm; Autopilot / Manual theo kênh. */
  'channels.managed': {
    params: Record<string, never>;
    result: {
      channels: {
        path: string;
        name: string;
        exists: boolean;
        autopilot: boolean;
        competitors: number;
        added_at: string;
      }[];
    };
  };
  'channels.managed.add': { params: ChannelRef; result: { ok: boolean } };
  'channels.managed.remove': { params: ChannelRef; result: { ok: boolean } };
  /** Cài đặt Autopilot tầng kênh đã giải (giá trị + nguồn). */
  'channel.autopilot.get': {
    params: ChannelRef;
    result: { settings: Record<string, { value: unknown; source: string }> };
  };
  'channel.autopilot.set': {
    params: ChannelRef & { key: string; value: unknown };
    result: { ok: boolean };
  };
  /** Kênh YouTube (đối thủ) từ URL / @handle / ID. */
  'youtube.resolve_channel': {
    params: { input: string };
    result: {
      id: string;
      title: string;
      handle: string | null;
      thumbnail: string | null;
      subscribers: number | null;
      videos: number | null;
    };
  };
  /** Nhật ký phiên agent (048, FR-AP-14): chat chính, phiên con, phiên chỉ còn trace — mới trước. */
  'sessions.list': {
    params: ChannelRef & { video?: string; limit?: number };
    result: {
      sessions: {
        id: string;
        kind: string;
        source: 'chat' | 'session' | 'trace';
        video?: string;
        frame_id?: string;
        title: string;
        started_at: string;
        ended_at?: string;
        lines: number;
        error?: string;
        tokens?: number;
      }[];
    };
  };
  'sessions.get': {
    params: ChannelRef & { id: string; video?: string };
    result: { lines: ChatLine[] };
  };
  'channel.list_recent': {
    params: Record<string, never>;
    result: { channels: { path: string; opened_at: string }[] };
  };
  'video.list': {
    params: ChannelRef;
    result: { videos: { id: string; title: string; phase: string; updated_at: string }[] };
  };
  'video.create': { params: ChannelRef & { title?: string }; result: { video_id: string } };
  'video.open': { params: VideoRef; result: { state: VideoStateSummary; history: ChatLine[] } };
  'chat.send': {
    params: ChannelRef & {
      video?: string;
      text: string;
      attachments?: { path: string; mime: string }[];
      /** FR-CH-04 (028): ngữ cảnh chọn trong xem trước. */
      context_refs?: ContextRef[];
    };
    result: { session_id: string };
  };
  'chat.interrupt': { params: ChannelRef & { video?: string }; result: Record<string, never> };
  'chat.history': { params: ChannelRef & { video?: string }; result: { history: ChatLine[] } };
  'upload.ingest': {
    params: ChannelRef & { video?: string; path_on_disk: string };
    result: { rel_path: string; mime: string };
  };
  'approval.decide': {
    params: VideoRef & {
      approval_id: string;
      decision: 'approve' | 'changes_requested';
      note?: string;
    };
    result: VideoStateSummary;
  };
  'permission.decide': {
    params: { request_id: string; allow: boolean; remember?: boolean };
    result: { ok: boolean };
  };
  'workflow.list': {
    params: Record<string, never>;
    result: { workflows: { id: string; title: string; version: string }[] };
  };
  'workflow.select': {
    params: VideoRef & { workflow_id: string; output_profile: string };
    result: VideoStateSummary;
  };
  'workflow.state': { params: VideoRef; result: VideoStateSummary };
  /** Việc đang chạy dở — giao diện hỏi xác nhận trước khi đóng app (045). */
  'app.activity': {
    params: Record<string, never>;
    result: {
      studio: { channel: string; video: string }[];
      steps: { channel: string; video: string; step_id: string; title: string }[];
      jobs: { kind: string; video?: string }[];
      chats: { channel: string; video: string }[];
    };
  };
  'workflow.run_to': { params: VideoRef & { step_id: string }; result: VideoStateSummary };
  'workflow.pause': { params: VideoRef; result: VideoStateSummary };
  /** Kiểm tra lại gate của bước trên file đã sửa tay, không sinh lại (036). */
  'workflow.recheck': {
    params: VideoRef & { step_id: string };
    result: {
      pass: boolean;
      results: { gate: string; target: string; pass: boolean; detail?: string }[];
      state: VideoStateSummary;
    };
  };
  /** Bỏ qua cảnh báo của kiểm mềm (audio_duration) ở bước lỗi rồi kiểm tra lại (043). */
  'workflow.waive': {
    params: VideoRef & { step_id: string; check: string };
    result: {
      pass: boolean;
      results: { gate: string; target: string; pass: boolean; detail?: string; waived?: boolean }[];
      state: VideoStateSummary;
    };
  };
  'workflow.rewind': { params: VideoRef & { step_id: string }; result: VideoStateSummary };
  'workflow.run_step': { params: VideoRef & { step_id: string }; result: VideoStateSummary };
  'job.list': { params: { video?: string; limit?: number }; result: { jobs: JobInfo[] } };
  'job.cancel': { params: { job_id: string }; result: { ok: boolean } };
  'job.retry': { params: { job_id: string }; result: { job_id: string } };
  'render.start': { params: VideoRef & { mode: 'draft' | 'release' }; result: { job_id: string } };
  'music.list': { params: ChannelRef; result: { tracks: unknown[] } };
  'music.find': {
    params: ChannelRef & {
      query?: string;
      bpm?: { min?: number; max?: number };
      min_duration_ms?: number;
      tags?: string[];
    };
    result: unknown;
  };
  'music.add': {
    params: ChannelRef & {
      paths_on_disk: string[];
      scope: 'channel' | 'app';
      tags?: string[];
      attribution?: string;
    };
    result: { job_id: string };
  };
  'settings.get': { params: Record<string, never>; result: unknown };
  'settings.set': { params: { key: string; value: unknown }; result: { ok: boolean } };
  'install.plan': { params: { profile: 'minimal' | 'standard' | 'full' }; result: unknown };
  'install.start': {
    /** accept_licenses: người dùng đã xác nhận giấy phép phi thương mại hiện trong kế hoạch (018). */
    params: { profile: 'minimal' | 'standard' | 'full'; accept_licenses?: boolean };
    result: { job_ids: string[] };
  };
  'disk.usage': { params: { channel?: string }; result: unknown };
  'disk.clean': {
    params: { channel: string; targets: ('cache' | 'drafts' | 'backups' | 'snapshots')[] };
    result: { freed_bytes: number; removed: string[] };
  };
  'trace.list': { params: { video?: string; limit?: number }; result: { traces: unknown[] } };
  'trace.get': { params: { trace_id: string }; result: { spans: unknown[] } };
  'explorer.tree': { params: ChannelRef; result: ExplorerNode };
  'explorer.read': {
    params: ChannelRef & { path: string };
    result: { kind: 'text' | 'json' | 'binary'; content?: string; size: number };
  };
  'studio.open': {
    params: VideoRef & { mode: 'preview' | 'edit' };
    result: { url: string; port?: number; session_id?: string; project_id?: string };
  };
  'studio.close': { params: VideoRef & { discard?: boolean }; result: { closed: boolean } };
  'studio.commit': {
    params: VideoRef;
    result: { changed_files: string[]; pinned_frames: string[]; readback_changes: unknown[] };
  };
  'frame.pinned_decide': {
    params: VideoRef & { frame_id: string; decision: 'keep' | 'reapply' | 'discard' };
    result: unknown;
  };
  'cost.report': { params: VideoRef; result: CostReport & { csv: string } };
  /** Bật/tắt Phoenix cục bộ (FR-OB-04, 028); lưu `settings.trace.phoenix_enabled`. */
  'trace.phoenix': { params: { enabled: boolean }; result: { enabled: boolean; url: string } };
  'captions.load': { params: VideoRef; result: CaptionsPanelData };
  'captions.save': {
    params: VideoRef & { overrides: CaptionOverrides; base_hash: string | null };
    result: { hash: string };
  };
  'asr.accept': { params: VideoRef & { line_ids: string[] }; result: Record<string, never> };
  /** Giá trị cấu hình đã giải theo tầng (chỉ đọc; 034 hiển thị chế độ tự động). */
  'config.resolve': {
    params: ChannelRef & { video?: string; key: string };
    result: { value: unknown; source: string };
  };
  /** Tiến độ hiện tại của các bước đang chạy (008 UI-04). */
  'workflow.progress': {
    params: VideoRef;
    result: { steps: Record<string, { done: number; total: number; message?: string }> };
  };
  /** Bật/tắt chế độ tự động cho video (034, ghi `state.json.config_overrides` qua module ghi). */
  'workflow.set_autopilot': { params: VideoRef & { on: boolean }; result: { on: boolean } };
}

/** Sự kiện core đẩy lên renderer. */
export interface IpcEvents {
  'chat.event': AgentEvent & { session_id: string; channel: string; video?: string };
  'job.updated': JobInfo;
  'workflow.updated': VideoStateSummary & { channel: string };
  /** Agent báo tình trạng workflow trong chat (041); dòng đã được ghi vào lịch sử. */
  'workflow.notice': { channel: string; video: string; line: ChatLine };
  /** Tiến độ bước đang chạy (008 UI-04); `done`/`total` null = bước đã kết thúc. */
  'workflow.progress': {
    channel: string;
    video: string;
    step_id: string;
    done: number | null;
    total: number | null;
    message?: string;
  };
  'approval.requested': {
    channel: string;
    video: string;
    approval_id: string;
    step_id: string;
    title: string;
    note?: string;
    files: string[];
  };
  'permission.requested': {
    request_id: string;
    tool: string;
    kind: string;
    summary: string;
    estimate?: unknown;
  };
  'core.health': { ok: boolean };
  /** File trong video đang mở được ghi qua module ghi (D10 mục 4; bảng caption tải lại, 026). */
  'artifact.changed': { channel: string; path: string; hash: string };
  /** File trong video bị sửa ngoài app (FR-WS-06, 025). */
  'file.external_change': { channel: string; video: string; path: string };
}

export type IpcMethod = keyof IpcMethods;
export type IpcRequest = { jsonrpc: '2.0'; id: number; method: IpcMethod; params: unknown };
export type IpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: string; message: string };
};
export type IpcNotification = { jsonrpc: '2.0'; method: keyof IpcEvents; params: unknown };

/** Bí mật do `main` đọc từ Credential Manager rồi chuyển cho core (D5 mục 5.4) — không đi qua renderer. */
export type HostControl = { type: 'secrets'; secrets: Record<string, string> };

export const UPLOAD_LIMIT = 200 * 1024 * 1024;
/** Loại file đính kèm cho phép (FN-008 mục 2). */
export const UPLOAD_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
};
