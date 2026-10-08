// 050 · FR-AP-05 — mô hình năng lực Autopilot (lõi thuần): trung vị thời gian bước, bỏ span lỗi/gate trượt,
// khung giờ qua đêm, học ngân sách Claude từ lần chạm hạn mức, chọn yếu tố giới hạn, trần từng kênh.
import { describe, expect, it } from 'vitest';
import {
  CAPACITY_SAFETY,
  DEFAULT_WORKFLOW_COST,
  capacityToday,
  isLimitHit,
  learnDailyTokens,
  median,
  remainingWork,
  workWindow,
  workflowCost,
  type CapacityInput,
  type StepSpan,
  type WorkflowCost,
} from '../../src/autopilot/capacity.js';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
/** 2026-10-07 00:00 giờ Việt Nam (UTC+7). */
const MIDNIGHT_VN = Date.UTC(2026, 9, 6, 17, 0, 0);
const at = (hh: number, mm = 0) => MIDNIGHT_VN + hh * H + mm * MIN;
const TZ = 'Asia/Ho_Chi_Minh';

let seq = 0;
const span = (
  video: string,
  step: string,
  durMs: number,
  o: Partial<StepSpan> & { endAt?: number } = {},
): StepSpan => {
  const end = o.endAt ?? 1_000_000 + ++seq * 1000;
  return {
    video_id: video,
    workflow_id: o.workflow_id ?? 'shorts',
    step_id: step,
    start_ms: end - durMs,
    end_ms: end,
    status: o.status ?? 'ok',
    outcome: o.outcome ?? 'done',
  };
};

describe('median', () => {
  it('odd, even, empty', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('workflowCost', () => {
  it('sums per-step medians over the K most recent videos', () => {
    const spans: StepSpan[] = [];
    // 7 video; bước a: 10..70 phút theo thứ tự thời gian, bước b: luôn 5 phút
    for (let i = 1; i <= 7; i++) {
      spans.push(span(`v${i}`, 'a', i * 10 * MIN, { endAt: i * DAY }));
      spans.push(span(`v${i}`, 'b', 5 * MIN, { endAt: i * DAY + H }));
    }
    const c = workflowCost('shorts', spans, {}, { k: 5, steps: ['a', 'b'] });
    // 5 video gần nhất: v3..v7 → a = 30,40,50,60,70 → trung vị 50
    expect(c.steps).toEqual([
      { step_id: 'a', median_ms: 50 * MIN, samples: 5 },
      { step_id: 'b', median_ms: 5 * MIN, samples: 5 },
    ]);
    expect(c.est_ms).toBe(55 * MIN);
    expect(c.samples).toBe(5);
    expect(c.measured).toBe(true);
    expect(c.low_confidence).toBe(false);
  });

  it('ignores failed / errored spans and keeps the latest counted attempt per video', () => {
    const spans = [
      span('v1', 'a', 10 * MIN, { endAt: 1000 }),
      span('v1', 'a', 99 * MIN, { endAt: 2000, status: 'error' }), // ngoại lệ
      span('v1', 'a', 88 * MIN, { endAt: 3000, outcome: 'failed' }), // gate trượt
      span('v2', 'a', 20 * MIN, { endAt: 4000 }),
      span('v2', 'a', 30 * MIN, { endAt: 5000, outcome: 'waiting_approval' }), // chạy lại, chờ duyệt
      span('v3', 'a', 1 * MIN, { endAt: 6000, workflow_id: 'other' }),
    ];
    const c = workflowCost('shorts', spans, {}, { steps: ['a'] });
    expect(c.steps[0]).toEqual({ step_id: 'a', median_ms: 20 * MIN, samples: 2 });
    expect(c.low_confidence).toBe(true);
  });

  it('approval wait between steps does not count (only span durations)', () => {
    // bước a xong lúc 1h, người duyệt sau 10 giờ, bước b chạy 5 phút
    const spans = [
      span('v1', 'a', 30 * MIN, { endAt: H }),
      span('v1', 'b', 5 * MIN, { endAt: 11 * H }),
    ];
    expect(workflowCost('shorts', spans, {}, { steps: ['a', 'b'] }).est_ms).toBe(35 * MIN);
  });

  it('falls back to the documented default (low confidence) without history', () => {
    const c = workflowCost('story-documentary', [], {}, { steps: ['a', 'b'] });
    expect(c).toMatchObject({
      est_ms: DEFAULT_WORKFLOW_COST['story-documentary']!.ms,
      tokens: DEFAULT_WORKFLOW_COST['story-documentary']!.tokens,
      samples: 0,
      measured: false,
      low_confidence: true,
    });
    // bước thiếu lịch sử → cộng phần mặc định tương ứng
    const part = workflowCost('shorts', [span('v1', 'a', 10 * MIN)], {}, { steps: ['a', 'b'] });
    expect(part.est_ms).toBe(10 * MIN + DEFAULT_WORKFLOW_COST.shorts!.ms / 2);
    expect(part.samples).toBe(0);
    expect(part.measured).toBe(true);
  });

  it('tokens per video = median over videos that finished the last step', () => {
    const spans = [
      span('v1', 'a', MIN, { endAt: 1000 }),
      span('v1', 'b', MIN, { endAt: 1100 }),
      span('v2', 'a', MIN, { endAt: 2000 }),
      span('v2', 'b', MIN, { endAt: 2100 }),
      span('v3', 'a', MIN, { endAt: 3000 }), // đang làm dở: chưa tính token
    ];
    const c = workflowCost(
      'shorts',
      spans,
      { v1: 100_000, v2: 300_000, v3: 5 },
      { steps: ['a', 'b'] },
    );
    expect(c.tokens).toBe(200_000);
  });
});

describe('workWindow', () => {
  it('same-day window: before, inside, after', () => {
    expect(workWindow('08:00-23:00', at(7), TZ)).toMatchObject({ inside: false, left_ms: 15 * H });
    expect(workWindow('08:00-23:00', at(20, 30), TZ)).toMatchObject({
      inside: true,
      left_ms: 2.5 * H,
      day_start_ms: at(8),
    });
    expect(workWindow('08:00-23:00', at(23, 30), TZ)).toMatchObject({
      inside: false,
      left_ms: 0,
      day_start_ms: at(0),
    });
  });

  it('cross-midnight window 22:00-06:00', () => {
    // 02:00: khung bắt đầu từ 22:00 hôm qua → còn 4 giờ
    expect(workWindow('22:00-06:00', at(2), TZ)).toMatchObject({
      inside: true,
      left_ms: 4 * H,
      day_start_ms: at(-2),
    });
    // 23:00: còn 1 giờ hôm nay + 6 giờ sáng mai
    expect(workWindow('22:00-06:00', at(23), TZ)).toMatchObject({ inside: true, left_ms: 7 * H });
    // 07:00: khung tối nay chưa bắt đầu → cả khung 8 giờ
    expect(workWindow('22:00-06:00', at(7), TZ)).toMatchObject({ inside: false, left_ms: 8 * H });
  });

  it('respects the time zone', () => {
    // 20:30 giờ VN = 15:30 giờ Berlin (mùa hè, UTC+2) → còn 7,5 giờ
    expect(workWindow('08:00-23:00', at(20, 30), 'Europe/Berlin').left_ms).toBe(7.5 * H);
  });
});

describe('Claude budget learning', () => {
  it('detects subscription limit messages', () => {
    expect(isLimitHit("You've hit your weekly limit · resets 3am (Asia/Bangkok)")).toBe(true);
    expect(isLimitHit('Claude AI usage limit reached|1760000000')).toBe(true);
    expect(isLimitHit('E_RENDER_FAILED: ffmpeg exited 1')).toBe(false);
    expect(isLimitHit(null)).toBe(false);
  });

  it('weekly limit: daily budget = 7-day consumption before the hit ÷ 7', () => {
    const hit = 20 * DAY;
    const usage = [
      { ts_ms: hit - 8 * DAY, tokens: 9_999_999 }, // ngoài 7 ngày
      { ts_ms: hit - 6 * DAY, tokens: 4_000_000 },
      { ts_ms: hit - DAY, tokens: 3_000_000 },
      { ts_ms: hit + H, tokens: 5_000_000 }, // sau mốc
    ];
    const weekly = (ts_ms: number) => ({ ts_ms, weekly: true });
    expect(learnDailyTokens(usage, [weekly(hit - 10 * DAY), weekly(hit)], hit + DAY, 15 * H)).toBe(
      1_000_000,
    );
    expect(learnDailyTokens(usage, [], hit + DAY, 15 * H)).toBeNull();
    // mốc trong tương lai (đồng hồ lệch) bị bỏ
    expect(learnDailyTokens(usage, [weekly(hit + 5 * DAY)], hit + DAY, 15 * H)).toBeNull();
  });

  it('5-hour session limit (076): session consumption × sessions that fit the work window', () => {
    const hit = 20 * DAY;
    const usage = [
      { ts_ms: hit - DAY, tokens: 900_000 }, // phiên khác, không tính
      { ts_ms: hit - 4 * H, tokens: 300_000 },
      { ts_ms: hit - H, tokens: 200_000 },
    ];
    const s = [{ ts_ms: hit, weekly: false }];
    // phiên 5 giờ dùng 500k; khung 15 giờ = 3 phiên
    expect(learnDailyTokens(usage, s, hit + H, 15 * H)).toBe(1_500_000);
    // khung ngắn hơn một phiên vẫn tính một phiên
    expect(learnDailyTokens(usage, s, hit + H, 2 * H)).toBe(500_000);
  });
});

const cost = (id: string, est_ms: number, tokens: number): WorkflowCost => ({
  workflow_id: id,
  est_ms,
  tokens,
  samples: 5,
  measured: true,
  low_confidence: false,
  steps: [],
});

const base = (o: Partial<CapacityInput> = {}): CapacityInput => ({
  now: at(8),
  timezone: TZ,
  work_window: '08:00-23:00',
  budget_share: 0.7,
  daily_tokens: null,
  learned_daily_tokens: null,
  tokens_used_today: 0,
  costs: [cost('shorts', H, 100_000), cost('story-documentary', 3 * H, 500_000)],
  channels: [
    { channel: 'A', workflows: ['shorts'], max_per_day: 20, done_today: 0, platforms: ['youtube'] },
  ],
  ...o,
});

describe('capacityToday', () => {
  it('time-limited: window × safety margin', () => {
    const r = capacityToday(
      base({
        channels: [
          { channel: 'A', workflows: ['shorts'], max_per_day: 20, done_today: 0, platforms: [] },
        ],
      }),
    );
    // 15 giờ × 0,8 = 12 giờ → 12 video shorts
    expect(CAPACITY_SAFETY).toBe(0.8);
    expect(r.window_ms_left).toBe(15 * H);
    expect(r.videos).toBe(12);
    expect(r.limiting_factor).toBe('time');
    expect(r.tokens_left).toBeNull();
    expect(r.reasons.join('\n')).toMatch(/Chưa biết ngân sách Claude/);
  });

  it('busy work already queued reduces the time', () => {
    const r = capacityToday(
      base({
        busy_ms: 4 * H,
        channels: [
          { channel: 'A', workflows: ['shorts'], max_per_day: 20, done_today: 0, platforms: [] },
        ],
      }),
    );
    expect(r.videos).toBe(8);
  });

  it('token-limited: budget × share − used today', () => {
    const r = capacityToday(
      base({
        daily_tokens: 1_000_000,
        tokens_used_today: 300_000,
        channels: [
          { channel: 'A', workflows: ['shorts'], max_per_day: 20, done_today: 0, platforms: [] },
        ],
      }),
    );
    // 1 000 000 × 0,7 − 300 000 = 400 000 → 4 video
    expect(r.tokens_left).toBe(400_000);
    expect(r.videos).toBe(4);
    expect(r.limiting_factor).toBe('tokens');
    expect(r.daily_tokens_source).toBe('override');
  });

  it('learned budget used when no override; override wins', () => {
    expect(capacityToday(base({ learned_daily_tokens: 500_000 })).daily_tokens_source).toBe(
      'learned',
    );
    expect(capacityToday(base({ learned_daily_tokens: 500_000 })).tokens_left).toBe(350_000);
    expect(
      capacityToday(base({ learned_daily_tokens: 500_000, daily_tokens: 2_000_000 })).tokens_left,
    ).toBe(1_400_000);
  });

  it('upload-limited: 6 YouTube uploads/day shared by channels', () => {
    const r = capacityToday(base({ now: at(0, 0), work_window: '00:00-23:59' }));
    expect(r.upload_quota_left).toBe(6);
    expect(r.videos).toBe(6);
    expect(r.limiting_factor).toBe('uploads');
    expect(capacityToday(base({ youtube_units_used_today: 3_300 })).upload_quota_left).toBe(4);
  });

  it('per-channel caps and round-robin allocation', () => {
    const r = capacityToday(
      base({
        channels: [
          {
            channel: 'A',
            workflows: ['shorts'],
            max_per_day: 2,
            done_today: 1,
            platforms: ['youtube'],
          },
          {
            channel: 'B',
            workflows: ['shorts'],
            max_per_day: 2,
            done_today: 0,
            platforms: ['tiktok'],
          },
        ],
      }),
    );
    expect(r.channels.map((c) => [c.channel, c.videos, c.limiting_factor])).toEqual([
      ['A', 1, 'cap'],
      ['B', 2, 'cap'],
    ]);
    expect(r.videos).toBe(3);
    expect(r.limiting_factor).toBe('cap');
  });

  it('channel cost = mean of its allowed workflows; empty list = all workflows', () => {
    const r = capacityToday(
      base({
        channels: [{ channel: 'A', workflows: [], max_per_day: 20, done_today: 0, platforms: [] }],
      }),
    );
    // trung bình (1 h + 3 h) / 2 = 2 h → 12 h / 2 h = 6
    expect(r.videos).toBe(6);
    expect(r.by_workflow.map((w) => w.workflow_id).sort()).toEqual(['shorts', 'story-documentary']);
  });

  it('time is shared between channels (round-robin until a resource runs out)', () => {
    const r = capacityToday(
      base({
        now: at(17),
        channels: [
          {
            channel: 'A',
            workflows: ['story-documentary'],
            max_per_day: 5,
            done_today: 0,
            platforms: [],
          },
          { channel: 'B', workflows: ['shorts'], max_per_day: 5, done_today: 0, platforms: [] },
        ],
      }),
    );
    // 6 giờ × 0,8 = 4,8 giờ: A 3 h, B 1 h, (A không đủ) B 1 h? còn 0,8 h → dừng
    expect(r.channels.map((c) => c.videos)).toEqual([1, 1]);
    expect(r.limiting_factor).toBe('time');
  });

  it('outside the window (after end) → 0 videos, time-limited', () => {
    const r = capacityToday(base({ now: at(23, 30) }));
    expect(r.videos).toBe(0);
    expect(r.limiting_factor).toBe('time');
  });

  it('no channels → cap with a reason', () => {
    const r = capacityToday(base({ channels: [] }));
    expect(r.videos).toBe(0);
    expect(r.limiting_factor).toBe('cap');
    expect(r.reasons.join('\n')).toMatch(/Không có kênh/);
  });
});

describe('remainingWork', () => {
  it('sums medians of steps not done yet; tokens pro rata', () => {
    const c: WorkflowCost = {
      ...cost('shorts', 60 * MIN, 400_000),
      steps: [
        { step_id: 'a', median_ms: 10 * MIN, samples: 5 },
        { step_id: 'b', median_ms: 20 * MIN, samples: 5 },
        { step_id: 'c', median_ms: 30 * MIN, samples: 5 },
        { step_id: 'd', median_ms: 0, samples: 0 },
      ],
    };
    expect(
      remainingWork(c, {
        a: { status: 'done' },
        b: { status: 'running' },
        c: { status: 'pending' },
        d: { status: 'skipped' },
      }),
    ).toEqual({ ms: 50 * MIN, tokens: 200_000 });
    // không có bước đo được → tỉ lệ trên ước tính cả video
    expect(remainingWork(cost('shorts', 60 * MIN, 400_000), {})).toEqual({
      ms: 60 * MIN,
      tokens: 400_000,
    });
  });
});
