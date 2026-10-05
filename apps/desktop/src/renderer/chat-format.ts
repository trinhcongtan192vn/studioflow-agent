/**
 * Định dạng hiển thị chat (FN-008 mục 2): tên tool thân thiện, đối tượng thao tác, kết quả/lỗi đọc được,
 * gộp chuỗi tool liền nhau. Hàm thuần, không phụ thuộc DOM.
 */

const TOOL_NAMES: Record<string, string> = {
  artifact_read: 'Đọc tệp',
  artifact_write: 'Ghi tệp',
  artifact_list: 'Liệt kê tệp',
  artifact_validate: 'Kiểm tệp',
  config_resolve: 'Đọc cấu hình',
  config_set: 'Đổi cấu hình',
  script_run: 'Chạy lệnh',
  graph_status: 'Trạng thái dựng',
  graph_plan: 'Lập kế hoạch dựng',
  graph_build: 'Dựng lại',
  workflow_list: 'Danh sách workflow',
  workflow_select: 'Chọn workflow',
  workflow_state: 'Trạng thái workflow',
  workflow_run_to: 'Chạy tới bước',
  workflow_pause: 'Tạm dừng workflow',
  workflow_rewind: 'Quay lại bước',
  workflow_step_complete: 'Báo xong bước',
  workflow_gate_check: 'Kiểm bước',
  approval_annotate: 'Ghi chú duyệt',
  studio_open: 'Mở Studio',
  studio_commit: 'Lưu Studio',
  studio_close: 'Đóng Studio',
  job_status: 'Trạng thái job',
  job_wait: 'Chờ job',
  job_cancel: 'Hủy job',
  job_list: 'Danh sách job',
  asset_import: 'Nạp ảnh',
  asset_search: 'Tìm ảnh',
  music_library_add: 'Nạp nhạc',
  music_find: 'Tìm nhạc',
  sfx_find: 'Tìm hiệu ứng âm thanh',
  voice_profile_create: 'Tạo giọng',
  voice_preview: 'Nghe thử giọng',
  tts_synthesize: 'Sinh giọng đọc',
  asr_align: 'Kiểm đọc sai',
  asr_accept: 'Chấp nhận line lệch',
  image_generate: 'Sinh ảnh',
  image_edit: 'Sửa ảnh',
  image_remove_bg: 'Tách nền',
  lipsync_cues: 'Tính khẩu hình',
  grade_compare: 'So sánh look',
  media_treatment: 'Hiệu ứng media',
  render_video: 'Render',
  Read: 'Đọc file',
  Glob: 'Tìm file',
  Grep: 'Tìm trong file',
  Skill: 'Nạp kỹ năng',
  ToolSearch: 'Tìm công cụ',
  TodoWrite: 'Cập nhật việc cần làm',
};

export const toolShort = (name: string) => name.replace(/^mcp__[^_]+__/, '');
export const toolLabel = (name: string) => TOOL_NAMES[toolShort(name)] ?? toolShort(name);

/** Tool nội bộ của agent (nạp skill, tìm tool) — hiển thị mờ. */
export const isQuietTool = (name: string) =>
  ['Skill', 'ToolSearch', 'TodoWrite'].includes(toolShort(name));

/** Đối tượng chính của thao tác (đường dẫn, khóa cấu hình, bước…) để hiện cạnh tên tool. */
export function toolTarget(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  for (const k of [
    'path',
    'file_path',
    'key',
    'step_id',
    'workflow_id',
    'skill',
    'query',
    'pattern',
    'name',
    'glob',
    'asset_id',
    'job_id',
    'prompt',
    'text',
  ]) {
    const v = o[k];
    if (typeof v === 'string' && v) return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  }
  if (Array.isArray(o.line_ids)) return `${o.line_ids.length} line`;
  if (o.line_ids === 'all') return 'mọi line';
  return '';
}

export interface ToolOutcome {
  status: 'running' | 'ok' | 'error';
  /** Thông báo ngắn để hiện (lỗi: thông điệp; ok: rỗng hoặc mô tả ngắn). */
  message: string;
  /** Nội dung đầy đủ để xem khi mở (JSON đẹp nếu đọc được). */
  detail: string;
}

const unescape = (s: string) => s.replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\\\/g, '\\');

/** Kết quả tool (`summary` ≤ 200 ký tự, có thể là JSON bị cắt) → trạng thái + thông điệp đọc được. */
export function toolOutcome(content: string, ok?: boolean): ToolOutcome {
  if (content === '…') return { status: 'running', message: '', detail: '' };
  const t = content.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    /* JSON bị cắt hoặc văn bản */
  }
  const p = parsed as
    { ok?: boolean; error?: { code?: string; message?: string }; data?: unknown } | undefined;
  if (p && typeof p === 'object' && p.ok === false)
    return {
      status: 'error',
      message: p.error?.message ?? p.error?.code ?? 'lỗi',
      detail: JSON.stringify(p, null, 2),
    };
  if (p && typeof p === 'object')
    return { status: 'ok', message: '', detail: JSON.stringify(p.data ?? p, null, 2) };
  // JSON bị cắt: đọc trường ok/message bằng regex
  if (/^\{"ok":false/.test(t)) {
    const msg = /"message":"((?:[^"\\]|\\.)*)/.exec(t)?.[1];
    const code = /"code":"([A-Z_]+)"/.exec(t)?.[1];
    return { status: 'error', message: msg ? unescape(msg) : (code ?? 'lỗi'), detail: t };
  }
  if (/^\{"ok":true/.test(t)) return { status: 'ok', message: '', detail: t };
  if (ok === false || /^(error|lỗi)/i.test(t)) return { status: 'error', message: t, detail: t };
  // văn bản (nạp skill…): câu đầu làm mô tả
  return { status: 'ok', message: t.split('\n')[0]!.slice(0, 120), detail: t };
}

/** Gộp các phần tử liền nhau thỏa `isTool` thành nhóm (khối "N thao tác"). */
export function groupRuns<T>(
  items: T[],
  isTool: (x: T) => boolean,
): (
  { kind: 'one'; item: T; index: number } | { kind: 'tools'; items: { item: T; index: number }[] }
)[] {
  const out: (
    { kind: 'one'; item: T; index: number } | { kind: 'tools'; items: { item: T; index: number }[] }
  )[] = [];
  items.forEach((item, index) => {
    if (!isTool(item)) return void out.push({ kind: 'one', item, index });
    const last = out.at(-1);
    if (last?.kind === 'tools') last.items.push({ item, index });
    else out.push({ kind: 'tools', items: [{ item, index }] });
  });
  return out;
}

/** Markdown tối giản cho câu trả lời của agent: khối (đoạn, tiêu đề, danh sách, code) + inline. */
export type MdBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'code'; text: string };

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join('\n') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^```/.test(l)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]!); i++) code.push(lines[i]!);
      out.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      flush();
      out.push({ kind: 'h', level: h[1]!.length, text: h[2]! });
      continue;
    }
    const li = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      flush();
      const kind = /\d/.test(li[1]!) ? 'ol' : 'ul';
      const last = out.at(-1);
      if (last && last.kind === kind) last.items.push(li[2]!);
      else out.push({ kind, items: [li[2]!] });
      continue;
    }
    if (!l.trim()) {
      flush();
      continue;
    }
    para.push(l);
  }
  flush();
  return out;
}

export type MdInline = { kind: 'text' | 'b' | 'i' | 'code'; text: string };

/** Inline: `code`, **đậm**, *nghiêng*. */
export function parseInline(s: string): MdInline[] {
  const out: MdInline[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ kind: 'text', text: s.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith('`')) out.push({ kind: 'code', text: t.slice(1, -1) });
    else if (t.startsWith('**')) out.push({ kind: 'b', text: t.slice(2, -2) });
    else out.push({ kind: 'i', text: t.slice(1, -1) });
    last = m.index! + t.length;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  return out;
}
