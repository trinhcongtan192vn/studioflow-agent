// 057 · FR-AP-13 — vòng phản hồi, phần thuần: hệ số có chặn và co về 1, không đủ dữ liệu thì không ảnh hưởng, xác định,
// lý do tiếng Việt, chỉ đổi thứ hạng (không đổi điểm gốc / min_score), áp vào lập kế hoạch ngày.
import { describe, expect, it } from 'vitest';
import {
  LEARNING_CONSTANTS,
  adjustCandidate,
  learnFromSamples,
  multiplierOf,
  rankWithLearning,
  type LearnSample,
} from '../../src/autopilot/learning.js';
import { buildPlan, selectCandidates, type BuildPlanInput } from '../../src/autopilot/plan.js';
import type { ChannelLearning, ResearchCandidate, ResearchDoc } from '../../src/contracts/types.js';

const NOW = new Date('2026-10-07T03:00:00Z');
const sample = (o: Partial<LearnSample> & { perf: number }): LearnSample => ({
  kind: 'competitor',
  workflow: 'narrated-explainer',
  ...o,
});
const cand = (
  id: string,
  title: string,
  score: number,
  o: Partial<ResearchCandidate> = {},
): ResearchCandidate => ({ id, kind: 'competitor', title, score, reasons: [`Lý do ${id}`], ...o });

describe('multiplierOf', () => {
  it('shrinks towards 1 with few samples and stays inside [0.7, 1.3]', () => {
    expect(multiplierOf(1, 50)).toBe(1);
    expect(multiplierOf(2, 5)).toBe(1.15); // 1 + 0.3 · 5/10
    expect(multiplierOf(0, 5)).toBe(0.85);
    expect(multiplierOf(2, 2)).toBeCloseTo(1 + (0.3 * 2) / 7, 3);
    expect(multiplierOf(2, 2)).toBeLessThan(multiplierOf(2, 20)); // nhiều mẫu → tin hơn
    for (const n of [2, 5, 50, 5000]) {
      expect(multiplierOf(100, n)).toBeLessThanOrEqual(1.3);
      expect(multiplierOf(0, n)).toBeGreaterThanOrEqual(0.7);
      expect(multiplierOf(-5, n)).toBeGreaterThanOrEqual(0.7);
    }
    // gần 1.3 / 0.7 chỉ khi rất nhiều mẫu
    expect(multiplierOf(100, 5000)).toBeCloseTo(1.3, 2);
    expect(multiplierOf(0, 5000)).toBeCloseTo(0.7, 2);
  });
});

describe('learnFromSamples', () => {
  const many: LearnSample[] = [
    ...[200, 220, 180, 240].map((perf) => sample({ kind: 'trending', perf, pillar: 'P1' })),
    ...[50, 40, 60, 55].map((perf) => sample({ kind: 'news', perf, pillar: 'P2' })),
  ];

  it('fewer than 5 old-enough videos → no effect (enough_data=false, empty dimensions, Vietnamese note)', () => {
    const l = learnFromSamples({ channel_id: 'ch_aaaaaaaa', now: NOW, samples: many.slice(0, 4) });
    expect(l).toMatchObject({ enough_data: false, videos: 4, baseline_daily_views: 0 });
    expect(l.dimensions).toEqual({ kind: [], pillar: [], source: [], workflow: [], slot: [] });
    expect(l.notes[0]).toMatch(/cần ≥ 5/);
    const c = cand('c', 'x', 80, { kind: 'trending' });
    expect(adjustCandidate(c, l)).toEqual({ multiplier: 1, parts: [] });
    expect(rankWithLearning([c], l).rank.size).toBe(0);
  });

  it('ratio is group median / channel median; groups under 2 videos get no factor', () => {
    const l = learnFromSamples({
      channel_id: 'ch_aaaaaaaa',
      now: NOW,
      samples: [...many, sample({ kind: 'trend', perf: 500 })],
    });
    expect(l.enough_data).toBe(true);
    expect(l.baseline_daily_views).toBe(180); // trung vị 9 mẫu
    const trending = l.dimensions.kind.find((g) => g.key === 'trending')!;
    expect(trending).toMatchObject({ n: 4, ratio: 1.167 });
    expect(trending.multiplier).toBe(multiplierOf(210 / 180, 4));
    expect(l.dimensions.kind.some((g) => g.key === 'trend')).toBe(false); // chỉ 1 video
    const news = l.dimensions.kind.find((g) => g.key === 'news')!;
    expect(news.multiplier).toBeLessThan(1);
    expect(l.dimensions.pillar.map((g) => g.key).sort()).toEqual(['P1', 'P2']);
    for (const g of Object.values(l.dimensions).flat()) {
      expect(g.multiplier).toBeGreaterThanOrEqual(0.7);
      expect(g.multiplier).toBeLessThanOrEqual(1.3);
      expect(g.n).toBeGreaterThanOrEqual(LEARNING_CONSTANTS.MIN_GROUP);
    }
  });

  it('is deterministic: input order does not matter', () => {
    const a = learnFromSamples({ channel_id: 'ch_aaaaaaaa', now: NOW, samples: many });
    const b = learnFromSamples({
      channel_id: 'ch_aaaaaaaa',
      now: NOW,
      samples: [...many].reverse(),
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('all-zero views: no group is better or worse (ratio 1, a note)', () => {
    const l = learnFromSamples({
      channel_id: 'ch_aaaaaaaa',
      now: NOW,
      samples: Array.from({ length: 6 }, () => sample({ perf: 0 })),
    });
    expect(l.dimensions.kind[0]).toMatchObject({ ratio: 1, multiplier: 1 });
    expect(l.notes.join(' ')).toMatch(/chưa có lượt xem/);
  });
});

describe('adjustCandidate / rankWithLearning', () => {
  const learning: ChannelLearning = {
    schema_version: 1,
    channel_id: 'ch_aaaaaaaa' as ChannelLearning['channel_id'],
    generated_at: NOW.toISOString(),
    enough_data: true,
    videos: 20,
    baseline_daily_views: 100,
    dimensions: {
      kind: [
        { key: 'trending', n: 10, ratio: 1.25, multiplier: 1.1 },
        { key: 'news', n: 10, ratio: 0.8, multiplier: 0.9 },
      ],
      pillar: [{ key: 'P1', n: 10, ratio: 2, multiplier: 1.2 }],
      source: [{ key: 'UCx', label: 'Kênh X', n: 4, ratio: 3, multiplier: 1.2 }],
      workflow: [],
      slot: [],
    },
    notes: [],
  };

  it('multiplier = product over kind/pillar/source, clamped to [0.7, 1.3]; Vietnamese reasons per dimension', () => {
    const a = adjustCandidate(
      cand('t', 'T', 80, {
        kind: 'trending',
        pillar: 'P1',
        source_channel: { id: 'UCx', title: 'Kênh X' },
      }),
      learning,
    );
    expect(a.multiplier).toBe(1.3); // 1.1·1.2·1.2 = 1.584 → 1.3
    expect(a.parts.map((p) => p.dim)).toEqual(['kind', 'pillar', 'source']);
    expect(a.parts[0]!.reason).toBe(
      'Chủ đề dạng "đang trending" của kênh đang hiệu quả hơn trung bình 25% (10 video) → ưu tiên cao hơn (×1,10).',
    );
    expect(a.parts[1]!.reason).toContain('Trụ cột "P1" của kênh đang hiệu quả hơn trung bình 100%');
    const down = adjustCandidate(cand('n', 'N', 80, { kind: 'news' }), learning);
    expect(down.multiplier).toBe(0.9);
    expect(down.parts[0]!.reason).toBe(
      'Chủ đề dạng "tin nóng" của kênh đang kém hơn trung bình 20% (10 video) → ưu tiên thấp hơn (×0,90).',
    );
    // không có nhóm khớp → không đổi, không lý do
    expect(adjustCandidate(cand('x', 'X', 80, { kind: 'trend' }), learning)).toEqual({
      multiplier: 1,
      parts: [],
    });
  });

  it('tiny differences (< 2%) produce no reason; rank keeps original score untouched', () => {
    const l = {
      ...learning,
      dimensions: {
        ...learning.dimensions,
        kind: [{ key: 'trend', n: 10, ratio: 1.02, multiplier: 1.01 }],
      },
    };
    expect(adjustCandidate(cand('x', 'X', 80, { kind: 'trend' }), l).parts).toEqual([]);
    const c = cand('t', 'T', 80, { kind: 'trending' });
    const r = rankWithLearning([c], learning);
    expect(r.rank.get('t')).toBeCloseTo(88, 5);
    expect(c.score).toBe(80);
  });
});

describe('selection and plan', () => {
  const learning: ChannelLearning = {
    schema_version: 1,
    channel_id: 'ch_aaaaaaaa' as ChannelLearning['channel_id'],
    generated_at: NOW.toISOString(),
    enough_data: true,
    videos: 20,
    baseline_daily_views: 100,
    dimensions: {
      kind: [
        { key: 'trending', n: 12, ratio: 1.6, multiplier: 1.21 },
        { key: 'news', n: 12, ratio: 0.5, multiplier: 0.79 },
      ],
      pillar: [],
      source: [],
      workflow: [],
      slot: [],
    },
    notes: [],
  };
  const news = cand('news:1', 'Tin nóng về di sản Huế', 85, { kind: 'news' });
  const trending = cand('yt:t', 'Video đang trending', 80, { kind: 'trending' });
  const weak = cand('yt:w', 'Chủ đề điểm thấp', 30, { kind: 'trending' });

  it('rank changes the order but never min_score (original score filters) or the stored score', () => {
    const base = { candidates: [news, trending, weak], slots: 3, history: [], today: [] };
    expect(selectCandidates(base).picked.map((p) => p.candidate.id)).toEqual([
      'news:1',
      'yt:t',
      'yt:w',
    ]);
    const { rank } = rankWithLearning([news, trending, weak], learning);
    const withLearn = selectCandidates({ ...base, rank, min_score: 40 });
    expect(withLearn.picked.map((p) => [p.candidate.id, p.candidate.score])).toEqual([
      ['yt:t', 80],
      ['news:1', 85],
    ]); // weak (30·1.21=36 vẫn < 40 và điểm gốc 30 < 40) bị loại
    expect(withLearn.low).toBe(1);
  });

  const research = (cs: ResearchCandidate[]): ResearchDoc =>
    ({
      schema_version: 1,
      channel_id: 'ch_k3v9q2xa',
      date: '2026-10-07',
      generated_at: NOW.toISOString(),
      quota_units: 0,
      sources: {
        competitors: [],
        own_videos: 0,
        trending: { region: 'VN', videos: 0 },
        trends: { geo: 'VN', items: 0 },
        news: [],
      },
      candidates: cs,
    }) as ResearchDoc;
  const input = (o: Partial<BuildPlanInput> = {}): BuildPlanInput => ({
    channel_id: 'ch_k3v9q2xa',
    date: '2026-10-07',
    now: NOW,
    timezone: 'Asia/Ho_Chi_Minh',
    others: [],
    research: research([news, trending]),
    capacity: { videos: 1, limiting_factor: 'time', reasons: [], est_ms: {} },
    config: {
      max_per_day: 5,
      workflows: [],
      default_workflow: 'narrated-explainer',
      slots: ['09:00'],
      platforms: ['youtube'],
      min_score: 0,
    },
    installed: [{ id: 'narrated-explainer', output_profiles: ['yt-1080p30'] }],
    ...o,
  });

  it('plan item carries the learned Vietnamese reason; without learning the plan is the same as before', () => {
    const plain = buildPlan(input());
    expect(plain.items[0]!.candidate_id).toBe('news:1');
    const { rank, reasons } = rankWithLearning([news, trending], learning);
    const learned = buildPlan(input({ learning: { rank, reasons } }));
    expect(learned.items[0]).toMatchObject({ candidate_id: 'yt:t', score: 80 });
    expect(learned.items[0]!.reasons.join(' ')).toContain(
      'Chủ đề dạng "đang trending" của kênh đang hiệu quả hơn trung bình 60% (12 video) → ưu tiên cao hơn (×1,21).',
    );
    // không đủ dữ liệu → rank rỗng → kế hoạch y hệt không có học
    const none = rankWithLearning([news, trending], { ...learning, enough_data: false });
    const strip = (p: ReturnType<typeof buildPlan>) =>
      JSON.stringify(p.items.map(({ id: _id, ...rest }) => (void _id, rest)));
    expect(strip(buildPlan(input({ learning: none })))).toBe(strip(plain));
  });
});
