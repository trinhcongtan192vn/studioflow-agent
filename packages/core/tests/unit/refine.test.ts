// 009 · US1, US4 · FR-007 — thuật toán refine-loop (D6 4.1) với producer/critic giả (hàm thuần).
import { describe, expect, it } from 'vitest';
import { refineProgress, runRefine, validateValue, type RefineDeps } from '../../src/index.js';

type Review = Awaited<ReturnType<RefineDeps['review']>>;
const review = (score: number, issues: Review['issues'] = []): Review => ({
  score,
  criteria: [{ id: 'hook', score, weight: 1 }],
  issues,
  usage: { input: 100, output: 50 },
  cost_usd: 0.01,
  model: 'critic-m',
});

function deps(scores: number[], over: Partial<RefineDeps> = {}): RefineDeps & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    min: 2,
    max: 3,
    threshold: 8,
    produce: async () => {
      calls.push('produce');
      return { text: 'v1', usage: { input: 10, output: 10 }, cost_usd: 0.01, model: 'prod-m' };
    },
    revise: async (draft, issues) => {
      calls.push(`revise:${issues.length}`);
      return {
        text: `${draft}+`,
        usage: { input: 10, output: 10 },
        cost_usd: 0.01,
        model: 'prod-m',
      };
    },
    review: async () => {
      calls.push('review');
      return review(
        scores[i++] ?? 0,
        scores[i - 1]! < 8 ? [{ severity: 'major', text: 'yếu' }] : [],
      );
    },
    checks: () => [{ id: 'schema', pass: true }],
    canSpend: () => true,
    ...over,
  };
}

describe('runRefine (009 US1)', () => {
  it('runs at least min rounds even when the first score passes', async () => {
    const d = deps([9, 9]);
    const r = await runRefine(d);
    expect(r.rounds).toHaveLength(2);
    expect(d.calls).toEqual(['produce', 'review', 'revise:0', 'review']);
    expect(r).toMatchObject({ draft: 'v1+', incomplete: false, final_score: 9 });
  });

  it('stops at max rounds when the threshold is never reached', async () => {
    const d = deps([5, 6, 7]);
    const r = await runRefine(d);
    expect(r.rounds.map((x) => x.score)).toEqual([5, 6, 7]);
    expect(d.calls.filter((c) => c === 'review')).toHaveLength(3);
  });

  it('major issues or failing checks prevent stopping', async () => {
    const d = deps([9, 9, 9], {
      checks: (t) => [{ id: 'length', pass: t.length > 4, detail: 'ngắn' }],
    });
    const r = await runRefine(d);
    expect(r.rounds).toHaveLength(3); // v1, v1+, v1++ (dài 4 vẫn chưa qua ở vòng 2)
    expect(d.calls).toContain('revise:1');
  });

  it('budget exhausted mid-way marks incomplete', async () => {
    let n = 0;
    const d = deps([5, 6, 7], { canSpend: () => ++n < 3 });
    const r = await runRefine(d);
    expect(r.incomplete).toBe(true);
    expect(r.rounds.length).toBeLessThan(3);
  });

  it('records rounds that are valid ReviewRound documents when completed with metadata', async () => {
    const r = await runRefine(deps([7, 9]));
    const doc = {
      schema_version: 1,
      step_id: 'script',
      round: 1,
      artifact: 'SCRIPT.md',
      draft_hash: 'a'.repeat(64),
      producer: { provider: 'text.claude', model: 'prod-m' },
      critic: { provider: 'text.claude', model: 'critic-m' },
      objective_checks: r.rounds[0]!.objective_checks,
      score: r.rounds[0]!.score,
      criteria: r.rounds[0]!.criteria,
      issues: r.rounds[0]!.issues,
      tokens: r.rounds[0]!.tokens,
      cost_usd: r.rounds[0]!.cost_usd,
      created_at: '2026-10-03T00:00:00Z',
    };
    expect(validateValue('ReviewRound', doc)).toEqual([]);
  });
});

describe('refine progress (008 UI-04)', () => {
  it('reports each phase with round, max and the previous score', async () => {
    const phases: string[] = [];
    await runRefine(
      deps([6, 9], {
        onPhase: (p) =>
          phases.push(
            `${p.phase}:${p.round}/${p.max}${p.lastScore !== undefined ? `@${p.lastScore}` : ''}`,
          ),
      }),
    );
    expect(phases).toEqual(['produce:1/3', 'review:1/3', 'revise:2/3@6', 'review:2/3@6']);
  });
  it('maps phases to a determinate progress with a readable message', () => {
    expect(refineProgress({ phase: 'produce', round: 1, max: 3 })).toEqual({
      done: 0,
      total: 6,
      message: 'Vòng 1/3: đang viết bản nháp',
    });
    expect(refineProgress({ phase: 'review', round: 2, max: 3, lastScore: 6.4 })).toEqual({
      done: 3,
      total: 6,
      message: 'Vòng 2/3: đang chấm điểm (vòng trước 6.4/10)',
    });
    expect(refineProgress({ phase: 'revise', round: 3, max: 3, lastScore: 7.1 }).done).toBe(4);
  });
});
