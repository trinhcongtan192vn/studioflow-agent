/**
 * Tab Tiến độ (UI-04, FN-008 mục 3): trạng thái tổng, phản hồi sau mỗi thao tác (chạy tới / chạy lại /
 * quay lại / tạm dừng), nút theo ngữ cảnh từng bước. Hàm thuần.
 */
import {
  asrWarningLines,
  canRecheck,
  hasDurationWarning,
  isDurationWarning,
  isPublishWaiting,
} from './chat-format';
export interface StepView {
  id: string;
  title: string;
  status: string;
  /** Loại bước trong thư viện (voice, media…) khi id khác loại. */
  uses?: string;
  /** Bước "lỗi" thật ra đang chờ người dùng (chờ bấm Đăng, agent chờ trả lời) — 2026-10-10. */
  waiting_user?: boolean;
}

/** Trạng thái hiển thị: bước chờ người dùng hiện "Chờ bạn", không phải "Lỗi". */
export const shownStatus = (s: { status: string; waiting_user?: boolean }): string =>
  s.waiting_user ? 'waiting_user' : s.status;

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Chưa chạy',
  running: 'Đang chạy',
  waiting_approval: 'Chờ bạn duyệt',
  waiting_user: 'Chờ bạn',
  done: 'Xong',
  failed: 'Lỗi',
  skipped: 'Bỏ qua',
  stale: 'Cần chạy lại',
};

export type Overall =
  | { kind: 'running'; step: StepView }
  | { kind: 'waiting'; step: StepView }
  | { kind: 'failed'; step: StepView }
  | { kind: 'done' }
  | { kind: 'idle'; next?: StepView };

/** Bước xong/bỏ qua trên tổng và trạng thái chung của workflow. */
export function overall(steps: readonly StepView[]): {
  done: number;
  total: number;
  state: Overall;
} {
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const find = (st: string) => steps.find((s) => s.status === st);
  const running = find('running');
  const failed = steps.find((s) => s.status === 'failed' && !s.waiting_user);
  const waiting = find('waiting_approval') ?? steps.find((s) => s.waiting_user);
  const next = steps.find((s) => s.status === 'pending' || s.status === 'stale');
  const state: Overall = running
    ? { kind: 'running', step: running }
    : failed
      ? { kind: 'failed', step: failed }
      : waiting
        ? { kind: 'waiting', step: waiting }
        : next
          ? { kind: 'idle', next }
          : { kind: 'done' };
  return { done, total: steps.length, state };
}

export type Action =
  | { kind: 'run_to'; step: string }
  | { kind: 'run_step'; step: string }
  /** 036: kiểm gate lại trên file đã sửa tay, không sinh lại. */
  | { kind: 'recheck'; step: string }
  /** 061: chấp nhận các line ASR đọc sai rồi kiểm tra lại. */
  | { kind: 'asr_accept'; step: string; line_ids: string[] }
  /** 043: bỏ qua cảnh báo kiểm mềm (audio_duration) rồi kiểm tra lại. */
  | { kind: 'waive'; step: string; check: string }
  | { kind: 'rewind'; step: string }
  | { kind: 'pause' };

export interface Feedback {
  tone: 'progress' | 'success' | 'info' | 'error';
  text: string;
  /** Thao tác đã xong (không cần theo dõi tiếp). */
  settled: boolean;
}

const title = (steps: readonly StepView[], id: string) =>
  steps.find((s) => s.id === id)?.title ?? id;

/**
 * Phản hồi cho thao tác vừa bấm theo trạng thái hiện tại. `run_to`/`run_step` chạy nền ở core nên
 * theo dõi qua các lần cập nhật trạng thái tới khi bước đích xong, dừng chờ duyệt hoặc lỗi.
 */
export function feedbackFor(
  a: Action,
  steps: readonly StepView[],
  stepError?: (id: string) => string | undefined,
): Feedback {
  if (a.kind === 'pause') {
    const r = steps.find((s) => s.status === 'running');
    return r
      ? {
          tone: 'info',
          text: ['voice', 'media'].includes(r.uses ?? r.id)
            ? `Bước "${r.title}" làm nốt câu/ảnh đang sinh rồi dừng; bấm Chạy tiếp để làm tiếp phần còn lại.`
            : `Sẽ tạm dừng sau khi bước "${r.title}" xong (bước đang chạy không bị ngắt).`,
          settled: true,
        }
      : { tone: 'success', text: 'Đã tạm dừng workflow.', settled: true };
  }
  if (a.kind === 'recheck' || a.kind === 'waive' || a.kind === 'asr_accept') {
    const f = feedbackFor({ kind: 'run_step', step: a.step }, steps, stepError);
    const t = title(steps, a.step);
    const head =
      a.kind === 'waive'
        ? `Đã bỏ qua cảnh báo ở bước "${t}"`
        : a.kind === 'asr_accept'
          ? `Đã chấp nhận ${a.line_ids.length} dòng ở bước "${t}"`
          : `Kiểm tra lại bước "${t}": đạt`;
    return {
      ...f,
      text: f.settled
        ? f.tone === 'success'
          ? `${head}, dùng file hiện có.`
          : `${head}. ${f.text}`
        : `${head}, đang chạy tiếp…`,
    };
  }
  if (a.kind === 'rewind') {
    // core chạy lại ngay từ bước đó → theo dõi như "chạy lại bước"
    const f = feedbackFor({ kind: 'run_step', step: a.step }, steps, stepError);
    const t = title(steps, a.step);
    return {
      ...f,
      text: f.settled
        ? f.tone === 'success'
          ? `Đã quay lại và chạy lại xong bước "${t}".`
          : `Đã quay lại bước "${t}". ${f.text}`
        : `Đã quay lại bước "${t}", đang chạy lại…`,
    };
  }
  const i = steps.findIndex((s) => s.id === a.step);
  const upto = i < 0 ? steps : steps.slice(0, i + 1);
  const target = title(steps, a.step);
  const failed = upto.find((s) => s.status === 'failed' && !s.waiting_user);
  if (failed) {
    const msg = stepError?.(failed.id);
    return {
      tone: 'error',
      text: `Lỗi ở bước "${failed.title}"${msg ? `: ${msg}` : ''}.`,
      settled: true,
    };
  }
  const waiting = upto.find((s) => s.status === 'waiting_approval');
  if (waiting)
    return {
      tone: 'info',
      text: `Dừng ở bước "${waiting.title}": chờ bạn duyệt (thẻ duyệt ở cuối khung chat).`,
      settled: true,
    };
  const tgt = steps[i];
  if (tgt && (tgt.status === 'done' || tgt.status === 'skipped'))
    return {
      tone: 'success',
      text:
        a.kind === 'run_step'
          ? `Đã chạy lại xong bước "${target}".`
          : `Đã chạy xong tới bước "${target}".`,
      settled: true,
    };
  const running = upto.find((s) => s.status === 'running');
  const pos = running ? steps.indexOf(running) + 1 : 0;
  return {
    tone: 'progress',
    text: running
      ? `Đang chạy bước "${running.title}" (${pos}/${steps.length})${running.id === a.step ? '' : ` — đích: "${target}"`}…`
      : `Đã gửi lệnh ${a.kind === 'run_step' ? `chạy lại bước "${target}"` : `chạy tới bước "${target}"`}, đang bắt đầu…`,
    settled: false,
  };
}

export interface StepButton {
  action: Action;
  label: string;
  title: string;
  primary?: boolean;
  /** Cần xác nhận trước (quay lại làm các bước sau phải chạy lại). */
  confirm?: string;
}

/** Nút theo ngữ cảnh của một bước. */
export function stepButtons(
  s: StepView,
  steps: readonly StepView[],
  /** Lỗi của bước (state.json) — cảnh báo thời lượng có nút bỏ qua (043). */
  error?: string,
): StepButton[] {
  const later = steps.slice(steps.indexOf(s) + 1).filter((x) => x.status === 'done').length;
  const rewind: StepButton = {
    action: { kind: 'rewind', step: s.id },
    label: 'Quay lại',
    title: 'Làm lại từ bước này (các bước sau sẽ cần chạy lại)',
    confirm: later
      ? `Quay lại và chạy lại từ bước "${s.title}"? ${later} bước đã xong phía sau sẽ cần chạy lại.`
      : `Quay lại và chạy lại từ bước "${s.title}"?`,
  };
  switch (s.status) {
    case 'pending':
    case 'stale':
      return [
        {
          action: { kind: 'run_to', step: s.id },
          label: 'Chạy tới đây',
          title: 'Chạy các bước còn lại tới hết bước này',
          primary: s.status === 'stale',
        },
      ];
    case 'failed': {
      // 091: bước Đăng chờ chọn nền tảng — bộ chọn trong thẻ bước thay cho các nút
      if (error !== undefined && isPublishWaiting(error)) return [];
      // 065: lỗi provider/agent hoặc chưa có file đầu ra → không có gì để kiểm tra lại, Chạy lại là chính
      if (error !== undefined && !canRecheck(error))
        return [
          {
            action: { kind: 'run_step', step: s.id },
            label: 'Chạy lại',
            title: 'Sinh lại bước từ đầu',
            primary: true,
          },
          rewind,
        ];
      const warn = error !== undefined && isDurationWarning(error);
      // 061: dòng đọc sai → nút chấp nhận lên đầu
      const asr = error !== undefined ? asrWarningLines(error) : [];
      // 046: cảnh báo thời lượng kèm lỗi khác → vẫn có nút bỏ qua (không phải nút chính)
      const mixed = !warn && error !== undefined && hasDurationWarning(error);
      return [
        ...(asr.length
          ? [
              {
                action: { kind: 'asr_accept', step: s.id, line_ids: asr } as Action,
                label: `Chấp nhận ${asr.length} dòng đọc sai`,
                title:
                  'Đã nghe lại và thấy ổn: chấp nhận audio hiện tại của các dòng ASR báo lệch, rồi kiểm tra lại',
                primary: true,
              },
            ]
          : []),
        ...(warn || mixed
          ? [
              {
                action: { kind: 'waive', step: s.id, check: 'audio_duration' } as Action,
                label: 'Bỏ qua cảnh báo',
                title: 'Giữ thời lượng hiện tại (không sinh lại); lỗi khác của bước vẫn cần xử lý',
                primary: warn,
              },
            ]
          : []),
        {
          action: { kind: 'recheck', step: s.id },
          label: 'Kiểm tra lại',
          title: 'Đã sửa file của bước? Kiểm tra lại trên file hiện có, không viết lại',
          primary: !warn,
        },
        {
          action: { kind: 'run_step', step: s.id },
          label: 'Chạy lại',
          title: 'Sinh lại bước từ đầu (viết đè file của bước)',
          confirm: `Chạy lại bước "${s.title}" từ đầu? File của bước sẽ được viết lại, chỉnh sửa tay sẽ mất. Nếu đã sửa file, dùng "Kiểm tra lại".`,
        },
        rewind,
      ];
    }
    case 'done':
    case 'waiting_approval':
      return [rewind];
    default:
      return [];
  }
}

/** Nút build graph / chặng render → tên việc tiếng Việt. */
const NODE_LABEL: [RegExp, string][] = [
  [/^audio\.line\b/, 'Sinh giọng từng câu'],
  [/^asr\.line\b/, 'Kiểm đọc sai'],
  [/^audio_meta\b/, 'Tổng hợp audio'],
  [/^captions\b/, 'Dựng phụ đề'],
  [/^asset\b/, 'Chuẩn bị ảnh'],
  [/^frame_timing\b/, 'Canh thời gian frame'],
  [/^frame_html\b/, 'Dựng frame'],
  [/^lipsync\.line\b/, 'Tính khẩu hình'],
  [/^index\b/, 'Lắp video'],
  [/^credits\b/, 'Ghi nguồn'],
  [/^render\b/, 'Render'],
  [/^gates$/, 'Kiểm tra trước render'],
  [/^build graph$/, 'Dựng các phần'],
];

export function progressLabel(message?: string): string | undefined {
  if (!message) return undefined;
  for (const [re, label] of NODE_LABEL) if (re.test(message)) return label;
  return message;
}

export interface StepProgressView {
  /** 0–100; `null` = không xác định (thanh chạy liên tục). */
  pct: number | null;
  text: string;
  elapsed?: string;
}

/** Thanh tiến trình của bước đang chạy: tiến độ bước, hoặc việc agent đang làm, + thời gian đã chạy. */
export function stepProgressView(o: {
  progress?: { done: number; total: number; message?: string };
  activity?: string;
  startedAt?: string;
  now: number;
}): StepProgressView {
  const p = o.progress;
  const pct =
    p && p.total > 0 ? Math.max(0, Math.min(100, Math.round((p.done / p.total) * 100))) : null;
  const label = progressLabel(p?.message);
  // thêm "(x/y)" khi nhãn chưa tự mang số đếm (vòng refine, "Dựng frame 3/5" đã có)
  const counted =
    p && p.total > 0 && label && !/\d+\/\d+/.test(label)
      ? `${label} (${p.done}/${p.total})`
      : label;
  const text = counted ?? o.activity ?? 'Đang xử lý';
  let elapsed: string | undefined;
  if (o.startedAt) {
    const s = Math.max(0, Math.floor((o.now - Date.parse(o.startedAt)) / 1000));
    elapsed =
      s >= 3600
        ? `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`
        : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  return { pct, text, ...(elapsed ? { elapsed } : {}) };
}
