/**
 * Tab Tiến độ (UI-04, FN-008 mục 3): trạng thái tổng, phản hồi sau mỗi thao tác (chạy tới / chạy lại /
 * quay lại / tạm dừng), nút theo ngữ cảnh từng bước. Hàm thuần.
 */
export interface StepView {
  id: string;
  title: string;
  status: string;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Chưa chạy',
  running: 'Đang chạy',
  waiting_approval: 'Chờ bạn duyệt',
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
  const failed = find('failed');
  const waiting = find('waiting_approval');
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
          text: `Sẽ tạm dừng sau khi bước "${r.title}" xong (bước đang chạy không bị ngắt).`,
          settled: true,
        }
      : { tone: 'success', text: 'Đã tạm dừng workflow.', settled: true };
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
  const failed = upto.find((s) => s.status === 'failed');
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
export function stepButtons(s: StepView, steps: readonly StepView[]): StepButton[] {
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
    case 'failed':
      return [
        {
          action: { kind: 'run_step', step: s.id },
          label: 'Chạy lại',
          title: 'Chạy lại bước bị lỗi',
          primary: true,
        },
        rewind,
      ];
    case 'done':
    case 'waiting_approval':
      return [rewind];
    default:
      return [];
  }
}
