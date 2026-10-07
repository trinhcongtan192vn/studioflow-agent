import type { StepState } from '../contracts/types.js';

/**
 * Cổng chất lượng tự động thay điểm chốt cho video Autopilot (052, FR-AP-07): hàm thuần, trả quyết định
 * kèm lý do tiếng Việt (ghi vào note approval và nhật ký vận hành). Không đạt → đỗ video, không đoán.
 */
export interface Decision {
  approve: boolean;
  reason: string;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const num = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Brief: `BRIEF.md` đề xuất đúng workflow và dạng xuất của mục kế hoạch. */
export function decideBrief(
  front: {
    proposed_workflow?: { id?: string } | null;
    proposed_output_profile?: string | null;
  },
  item: { workflow_id: string; output_profile: string },
): Decision {
  const wf = front.proposed_workflow?.id;
  const profile = front.proposed_output_profile;
  if (!wf || !profile)
    return { approve: false, reason: 'BRIEF.md chưa đề xuất workflow và dạng xuất' };
  if (wf !== item.workflow_id || profile !== item.output_profile)
    return {
      approve: false,
      reason: `BRIEF.md đề xuất ${wf} / ${profile}, khác kế hoạch ${item.workflow_id} / ${item.output_profile}`,
    };
  return {
    approve: true,
    reason: `BRIEF.md đề xuất đúng workflow ${wf} / ${profile} của kế hoạch`,
  };
}

/** Điểm chốt có vòng refine (story, script): điểm cuối ≥ ngưỡng và không `incomplete`. */
export function decideRefine(
  refine: StepState['refine'] | undefined,
  o: { configured: boolean; threshold: number },
): Decision {
  if (!o.configured && !refine)
    return {
      approve: true,
      reason: 'bước không có vòng chấm điểm (refine); các gate khách quan đã qua',
    };
  if (refine?.final_score === undefined)
    return { approve: false, reason: 'vòng chấm điểm chưa có điểm cuối' };
  if (refine.incomplete)
    return {
      approve: false,
      reason: `vòng chấm điểm chưa xong (điểm ${num(refine.final_score)}, ngưỡng ${num(o.threshold)})`,
    };
  if (refine.final_score < o.threshold)
    return {
      approve: false,
      reason: `điểm ${num(refine.final_score)} thấp hơn ngưỡng ${num(o.threshold)} sau ${refine.rounds} vòng`,
    };
  return {
    approve: true,
    reason: `điểm ${num(refine.final_score)} ≥ ngưỡng ${num(o.threshold)} sau ${refine.rounds} vòng`,
  };
}

/** Finalize: mọi gate đã qua (engine chỉ tạo approval khi đó) và không line nào còn lệch ASR. */
export function decideFinalize(o: { mismatched: string[] }): Decision {
  if (o.mismatched.length)
    return {
      approve: false,
      reason: `${o.mismatched.length} line còn lệch ASR: ${o.mismatched.slice(0, 5).join(', ')}`,
    };
  return { approve: true, reason: 'mọi gate qua, không line nào lệch ASR' };
}

/** Cảnh báo `audio_duration` (043): lệch ≤ `ratio` thì tự bỏ qua, lệch hơn → đỗ. */
export function decideDuration(o: {
  actual_ms: number;
  target_ms: number;
  ratio: number;
}): Decision {
  if (!(o.target_ms > 0))
    return { approve: false, reason: 'không có thời lượng mục tiêu để so (BRIEF.md)' };
  const dev = Math.abs(o.actual_ms - o.target_ms) / o.target_ms;
  const sign = o.actual_ms >= o.target_ms ? '+' : '−';
  const s = (ms: number) => `${Math.round(ms / 1000)} giây`;
  const text = `thời lượng ${s(o.actual_ms)} so với mục tiêu ${s(o.target_ms)} (${sign}${pct(dev)}, ngưỡng ${pct(o.ratio)})`;
  // so sánh trên số nguyên phần nghìn: tránh sai số dấu phẩy động đúng ở biên
  return Math.round(dev * 1e6) <= Math.round(o.ratio * 1e6)
    ? { approve: true, reason: `${text}: trong ngưỡng, bỏ qua cảnh báo` }
    : { approve: false, reason: `${text}: lệch quá ngưỡng` };
}
