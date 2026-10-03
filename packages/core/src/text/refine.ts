import type { ReviewRound, TextGenerateOutput, TextReviewOutput } from '../contracts/types.js';
import { SfError } from '../errors.js';
import type { ObjectiveResult } from './objectives.js';

export type Issue = ReviewRound['issues'][number];

export interface RefineDeps {
  min: number;
  max: number;
  threshold: number;
  produce(): Promise<TextGenerateOutput>;
  /** Sửa bản nháp theo vấn đề của critic + kiểm khách quan không qua. */
  revise(draft: string, issues: Issue[]): Promise<TextGenerateOutput>;
  review(draft: string, priorIssues: Issue[]): Promise<TextReviewOutput>;
  checks(draft: string): ObjectiveResult[];
  /** Ngân sách còn đủ cho một vòng nữa (D6 4.1). */
  canSpend(): boolean;
  /** Chuẩn hóa nháp (ví dụ gán ID line) trước khi kiểm/chấm; mặc định giữ nguyên. */
  normalize?(draft: string): string;
}

export interface RoundRecord {
  round: number;
  draft: string;
  objective_checks: { id: string; pass: boolean; detail?: string }[];
  score: number;
  criteria: ReviewRound['criteria'];
  issues: Issue[];
  tokens: { input: number; output: number };
  cost_usd: number;
  producer_model: string;
  critic_model: string;
}

export interface RefineResult {
  draft: string;
  rounds: RoundRecord[];
  final_score: number;
  incomplete: boolean;
}

const blocking = (i: Issue) => i.severity === 'critical' || i.severity === 'major';

/** `refine-loop` (D6 mục 4.1). Producer/critic/kiểm khách quan được tiêm vào (test được bằng hàm thuần). */
export async function runRefine(d: RefineDeps): Promise<RefineResult> {
  const norm = d.normalize ?? ((s: string) => s);
  if (!d.canSpend())
    throw new SfError('E_BUDGET_EXCEEDED', 'video budget cannot cover a refine round');
  const rounds: RoundRecord[] = [];
  let gen = await d.produce();
  let draft = norm(gen.text);
  let incomplete = false;
  let prior: Issue[] = [];
  for (let r = 1; r <= d.max; r++) {
    const checks = d.checks(draft);
    const review = await d.review(draft, prior);
    rounds.push({
      round: r,
      draft,
      objective_checks: checks,
      score: review.score,
      criteria: review.criteria,
      issues: review.issues,
      tokens: {
        input: gen.usage.input + review.usage.input,
        output: gen.usage.output + review.usage.output,
      },
      cost_usd: gen.cost_usd + review.cost_usd,
      producer_model: gen.model,
      critic_model: review.model,
    });
    const failing = checks.filter((c) => !c.pass);
    const stop =
      r >= d.min &&
      review.score >= d.threshold &&
      !review.issues.some(blocking) &&
      failing.length === 0;
    if (stop || r === d.max) break;
    if (!d.canSpend()) {
      incomplete = true;
      break;
    }
    prior = [
      ...review.issues,
      ...failing.map((c): Issue => ({
        severity: 'major',
        location: `check:${c.id}`,
        text: `Kiểm ${c.id} không qua: ${c.detail ?? ''}`.trim(),
      })),
    ];
    gen = await d.revise(draft, prior);
    draft = norm(gen.text);
  }
  const last = rounds[rounds.length - 1]!;
  return {
    draft: last.draft,
    rounds,
    final_score: last.score,
    incomplete: incomplete || rounds.length < d.min,
  };
}

/** Tóm tắt cho thẻ duyệt (FR-SC-03): điểm từng vòng, vấn đề đã sửa/còn lại. */
export function refineSummary(r: RefineResult, opts: { sameVendor: boolean }): string {
  const parts = r.rounds.map(
    (x) =>
      `Vòng ${x.round}: ${x.score.toFixed(1)} (${x.issues.length} vấn đề${x.objective_checks.some((c) => !c.pass) ? ', kiểm khách quan chưa qua' : ''})`,
  );
  const last = r.rounds[r.rounds.length - 1]!;
  const fixed = r.rounds.slice(0, -1).reduce((s, x) => s + x.issues.length, 0);
  const remaining = last.issues.map((i) => `[${i.severity}] ${i.text}`);
  return [
    parts.join(' → '),
    `Đã xử lý ${fixed} vấn đề qua các vòng; còn lại ${remaining.length}${remaining.length ? `: ${remaining.slice(0, 5).join('; ')}` : ''}.`,
    ...(opts.sameVendor ? ['Lưu ý: critic cùng hãng với producer (khác tầng model).'] : []),
    ...(r.incomplete
      ? ['Chưa đủ vòng (ngân sách) — duyệt để chấp nhận, hoặc yêu cầu sửa để chạy thêm.']
      : []),
  ].join('\n');
}
