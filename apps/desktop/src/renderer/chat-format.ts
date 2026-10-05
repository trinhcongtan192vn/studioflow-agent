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

/** Nút hành động ngay trong chat sau mỗi bước (FN-008 mục 2: CTA). */
export type StepCta =
  | { kind: 'file'; label: string; path: string }
  | { kind: 'tab'; label: string; tab: string }
  | { kind: 'retry'; label: string; step: string }
  /** Chọn file giọng mẫu rồi soạn sẵn lời nhờ agent tạo giọng (FR-VO-01). */
  | { kind: 'voice'; label: string; step: string; prompt: string }
  /** Gửi ngay một lời nhờ agent (ví dụ gợi ý giọng khi chưa có file mẫu, 033). */
  | { kind: 'say'; label: string; text: string };

const DOC_LABELS: Record<string, string> = {
  'BRIEF.md': 'Xem brief',
  'SCRIPT.md': 'Xem kịch bản',
  'STORYBOARD.md': 'Xem storyboard',
  'STORY.md': 'Xem truyện',
  'CAST.md': 'Xem nhân vật',
  'publish.md': 'Xem tiêu đề & mô tả',
  'frame.md': 'Xem design system',
};

/** Bước có kết quả hình/tiếng xem được ở tab Xem trước. */
const PREVIEW_STEPS = new Set([
  'voice',
  'assets',
  'look',
  'frames',
  'effects',
  'overlays',
  'captions',
  'finalize',
  'animatic',
  'lipsync',
  'cut',
]);

/** Nhãn nút cho một tệp kết quả (đường dẫn tương đối trong video), `undefined` nếu không có. */
export function fileCtaLabel(rel: string): string | undefined {
  const base = rel.split(/[\\/]/).pop() ?? rel;
  if (DOC_LABELS[base]) return DOC_LABELS[base];
  if (/\.mp4$/i.test(base)) return 'Xem video';
  if (/\.md$/i.test(base)) return `Xem ${base}`;
  return undefined;
}

/** CTA cho một bước vừa xong/lỗi, dựa trên tệp kết quả của bước. */
export function stepCtas(
  step: { id: string; status: string; title?: string },
  outputs: readonly string[] = [],
  error?: string,
): StepCta[] {
  if (step.status === 'failed') {
    const retry: StepCta = { kind: 'retry', label: 'Chạy lại bước', step: step.id };
    if (error && isMissingVoice(error))
      return [
        {
          kind: 'say',
          label: '✨ Gợi ý giọng',
          text: `Tôi chưa có file giọng mẫu. Hãy gợi ý 2–3 giọng khác nhau (voice.design) cho từng người nói còn thiếu giọng, hợp với nội dung kênh và nhân vật, để tôi nghe thử và chọn; chọn xong thì chạy lại bước ${step.title ?? step.id}.`,
        },
        {
          kind: 'voice',
          label: '📎 Chọn file giọng mẫu',
          step: step.id,
          prompt: `Tạo giọng đọc cho kênh từ file mẫu đính kèm, đặt làm giọng mặc định, rồi chạy lại bước ${step.title ?? step.id}.`,
        },
        retry,
      ];
    return [retry];
  }
  const out: StepCta[] = [];
  const seen = new Set<string>();
  for (const p of outputs) {
    const label = fileCtaLabel(p);
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push({ kind: 'file', label, path: p });
    }
  }
  if (PREVIEW_STEPS.has(step.id))
    out.push({ kind: 'tab', label: 'Mở xem trước', tab: 'Xem trước' });
  if (step.id === 'music') out.push({ kind: 'tab', label: 'Xem nhạc', tab: 'Nhạc' });
  return out;
}

/** Bước đổi sang done/failed/waiting_approval so với lần trước (để hiện thẻ trong chat). */
export function changedSteps<S extends { id: string; status: string }>(
  prev: Record<string, string>,
  steps: readonly S[],
): S[] {
  return steps.filter(
    (s) =>
      prev[s.id] !== undefined &&
      prev[s.id] !== s.status &&
      (s.status === 'done' || s.status === 'failed'),
  );
}

/** Dòng "agent đang làm gì" dưới cùng khung chat khi agent đang xử lý. */
export function activityLabel(
  a: { kind: 'thinking' } | { kind: 'writing' } | { kind: 'tool'; name: string; input?: unknown },
): string {
  if (a.kind === 'thinking') return 'Đang suy nghĩ';
  if (a.kind === 'writing') return 'Đang viết câu trả lời';
  const label = toolLabel(a.name);
  const target = toolTarget(a.input);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}${target ? `: ${target}` : ''}`;
}

const isMissingVoice = (e: string) =>
  /has no voice|no voice for|not cloned yet|voice\.profile_create/.test(e);

/** Lỗi bước dễ đọc cho người dùng (lỗi kỹ thuật vẫn xem được khi mở chi tiết). */
export function friendlyStepError(e: string): string {
  if (isMissingVoice(e)) {
    const who = /no voice for ([^:]+):/.exec(e)?.[1];
    const names = who
      ?.split(', ')
      .map((x) => (x === 'narrator' ? 'người dẫn' : x))
      .join(', ');
    return `Chưa có giọng đọc${names ? ` cho ${names}` : ''}. Hãy chọn một file giọng mẫu 3–10 giây (wav/mp3, giọng bạn được phép dùng); agent sẽ tạo giọng rồi chạy lại bước.`;
  }
  // gộp lỗi lặp theo từng line: "audio.line:ln_…: <msg>; …"
  const parts = e.split('; ');
  if (parts.length > 3) {
    const first = parts[0]!.replace(/^[\w.]+:\w+:\s*/, '');
    return `${first} (và ${parts.length - 1} lỗi tương tự)`;
  }
  return e;
}

const TRAITS: Record<string, string> = {
  male: 'Nam',
  female: 'Nữ',
  child: 'Trẻ em',
  teenager: 'Thiếu niên',
  'young adult': 'Thanh niên',
  'middle-aged': 'Trung niên',
  elderly: 'Cao tuổi',
  'very low pitch': 'Rất trầm',
  'low pitch': 'Trầm',
  'moderate pitch': 'Cao độ vừa',
  'high pitch': 'Cao',
  'very high pitch': 'Rất cao',
  whisper: 'Thì thầm',
};

export interface VoiceSuggestion {
  voice_id: string;
  name: string;
  for?: string;
  /** "người dẫn" hoặc mã nhân vật. */
  forLabel?: string;
  /** Câu mẫu (tương đối kênh) để nghe thử. */
  preview: string;
  traits: string[];
  /** Lời gửi agent khi bấm "Chọn giọng này". */
  pick: string;
}

/** Job `voice.design` xong → thẻ giọng gợi ý trong chat (033 FR-003). */
export function voiceSuggestion(job: {
  kind: string;
  status: string;
  result?: unknown;
}): VoiceSuggestion | undefined {
  if (job.kind !== 'voice.design' || job.status !== 'succeeded' || !job.result) return undefined;
  const r = job.result as {
    voice_id: string;
    name: string;
    for?: string;
    preview: string;
    design?: { instruct?: string };
  };
  const forLabel = r.for ? (r.for === 'narrator' ? 'người dẫn' : r.for) : undefined;
  return {
    voice_id: r.voice_id,
    name: r.name,
    ...(r.for ? { for: r.for, forLabel } : {}),
    preview: r.preview,
    traits: (r.design?.instruct ?? '')
      .split(', ')
      .filter(Boolean)
      .map((t) => TRAITS[t] ?? t),
    pick: `Chọn giọng "${r.name}" (${r.voice_id})${forLabel ? ` cho ${forLabel}` : ''}.`,
  };
}
