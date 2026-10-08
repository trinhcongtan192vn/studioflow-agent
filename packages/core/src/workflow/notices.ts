import { isAutoApproval } from '../domain/autopilot.js';

/**
 * Thông báo workflow trong khung chat (041): agent báo tình trạng (bắt đầu / xong → tiếp theo / cần duyệt /
 * lỗi / render xong) như một tin nhắn, lưu vào lịch sử chat; giao diện gắn nút hành động theo loại.
 */
export interface WorkflowNotice {
  event: 'started' | 'done' | 'waiting' | 'failed' | 'finished';
  step_id: string;
  step_title: string;
  /** Vị trí bước trong workflow [i, n] (1-based). */
  position: [number, number];
  /** Bước chạy tiếp ngay sau (gộp "xong X → đang làm Y"). */
  next?: { id: string; title: string };
  /** Điểm duyệt của bước được engine tự duyệt (chế độ tự động, 034). */
  auto_approved?: boolean;
  /** Điểm duyệt đang chờ người dùng. */
  approval_id?: string;
  outputs?: string[];
  error?: string;
}

interface StepView {
  id: string;
  title: string;
  status: string;
}
interface StateView {
  steps?: Record<string, { outputs?: string[]; error?: { message: string } }>;
  approvals?: { id: string; step_id: string; status: string; note?: string }[];
}

/** Thông báo cho các bước đổi trạng thái giữa hai lần cập nhật. `prev` rỗng (lần đầu) → không báo. */
export function workflowNotices(
  prev: Record<string, string>,
  steps: readonly StepView[],
  state: StateView,
): WorkflowNotice[] {
  if (!Object.keys(prev).length) return [];
  const n = steps.length;
  const out: WorkflowNotice[] = [];
  const started: WorkflowNotice[] = [];
  steps.forEach((s, i) => {
    if (prev[s.id] === s.status) return;
    const base = { step_id: s.id, step_title: s.title, position: [i + 1, n] as [number, number] };
    const st = state.steps?.[s.id];
    if (s.status === 'running') started.push({ event: 'started', ...base });
    else if (s.status === 'done') {
      const last = [...(state.approvals ?? [])].reverse().find((a) => a.step_id === s.id);
      out.push({
        event: 'done',
        ...base,
        ...(last?.status === 'approved' && isAutoApproval(last) ? { auto_approved: true } : {}),
        ...(st?.outputs?.length ? { outputs: st.outputs } : {}),
      });
      if (i === n - 1)
        out.push({
          event: 'finished',
          ...base,
          ...(st?.outputs?.length ? { outputs: st.outputs } : {}),
        });
    } else if (s.status === 'waiting_approval') {
      const ap = state.approvals?.find((a) => a.step_id === s.id && a.status === 'pending');
      out.push({
        event: 'waiting',
        ...base,
        ...(ap ? { approval_id: ap.id } : {}),
        ...(st?.outputs?.length ? { outputs: st.outputs } : {}),
      });
    } else if (s.status === 'failed')
      out.push({
        event: 'failed',
        ...base,
        ...(st?.error?.message ? { error: st.error.message } : {}),
      });
  });
  // "xong X" + "bắt đầu Y" cùng lúc → một tin "xong X → đang làm Y"
  const lastDone = [...out].reverse().find((x) => x.event === 'done');
  for (const s of started) {
    if (lastDone && !lastDone.next) lastDone.next = { id: s.step_id, title: s.step_title };
    else out.push(s);
  }
  return out;
}

/** Câu chữ của thông báo (lưu trong lịch sử chat; giao diện vẽ thẻ có nút từ `notice`). */
export function noticeText(n: WorkflowNotice): string {
  const at = `(${n.position[0]}/${n.position[1]})`;
  switch (n.event) {
    case 'started':
      return `▶ Đang làm bước **${n.step_title}** ${at}…`;
    case 'done':
      return `✓ Xong bước **${n.step_title}** ${at}${n.auto_approved ? ' — tự duyệt bước' : ''}.${n.next ? ` Đang làm tiếp **${n.next.title}**…` : ''}`;
    case 'waiting':
      return `⏸ Bước **${n.step_title}** đã xong và cần bạn duyệt. Xem kết quả rồi bấm **Duyệt** (hoặc ghi điều cần sửa).`;
    case 'failed':
      // 083: agent dừng lượt để hỏi người dùng (chọn giọng…) — không phải lỗi
      if (n.error?.endsWith('waiting for your reply in chat'))
        return `💬 Bước **${n.step_title}** ${at} đang chờ bạn trả lời agent ở trên. Trả lời xong, agent hoàn tất bước và app làm tiếp.`;
      return `✕ Bước **${n.step_title}** gặp lỗi${n.error ? `: ${n.error}` : '.'}`;
    case 'finished':
      return '🎬 Video đã render xong.';
  }
}
