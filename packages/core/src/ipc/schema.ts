// Hợp đồng IPC renderer ↔ core (D10 mục 4, 008): JSON-RPC 2.0 qua MessagePort do `main` cấp.
// D10 ghi đường dẫn `packages/core/ipc/schema.ts`; đặt trong `src/` để biên dịch cùng core (008 R1).
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
  tool?: { name: string; input?: unknown; output_summary?: string };
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
  'workflow.run_to': { params: VideoRef & { step_id: string }; result: VideoStateSummary };
  'workflow.pause': { params: VideoRef; result: VideoStateSummary };
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
}

/** Sự kiện core đẩy lên renderer. */
export interface IpcEvents {
  'chat.event': AgentEvent & { session_id: string; channel: string; video?: string };
  'job.updated': JobInfo;
  'workflow.updated': VideoStateSummary & { channel: string };
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
