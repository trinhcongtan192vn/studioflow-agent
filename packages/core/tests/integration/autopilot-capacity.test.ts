// 050 · FR-AP-05 — mô hình năng lực đọc DB thật (`openDb`, bảng `spans` + `usage`): thời gian bước, token
// Claude theo video, học ngân sách từ lần chạm hạn mức; engine ghi `sf.step_outcome` lên span bước.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  capacityFromDb,
  readLimitHits,
  readStepSpans,
  readVideoTokens,
} from '../../src/autopilot/index.js';
import { openDb, type Db } from '../../src/store/db.js';
import { tempDir } from '../domain-helpers.js';
import { wireDemo, workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
/** 2026-10-07 10:00 giờ Việt Nam. */
const NOW = Date.UTC(2026, 9, 7, 3, 0, 0);

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

let n = 0;
function addSpan(
  db: Db,
  o: {
    name?: string;
    video?: string;
    attrs?: Record<string, unknown>;
    end: number;
    dur?: number;
    status?: string;
    message?: string;
  },
) {
  db.prepare(
    'INSERT INTO spans (span_id, trace_id, parent_id, name, start_ms, end_ms, status, status_message, video_id, attrs, events) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    `s${++n}`,
    `t${n}`,
    o.name ?? 'sf.workflow.step',
    o.end - (o.dur ?? 0),
    o.end,
    o.status ?? 'ok',
    o.message ?? null,
    o.video ?? null,
    JSON.stringify(o.attrs ?? {}),
    '[]',
  );
}
function addUsage(db: Db, o: { ts: number; video?: string; tokens: number; provider?: string }) {
  db.prepare(
    "INSERT INTO usage (ts, video_id, kind, provider, input_tokens, output_tokens, source) VALUES (?, ?, 'llm', ?, ?, 0, 'reported')",
  ).run(new Date(o.ts).toISOString(), o.video ?? null, o.provider ?? 'claude', o.tokens);
}
const step = (db: Db, video: string, stepId: string, dur: number, end: number, outcome = 'done') =>
  addSpan(db, {
    video,
    end,
    dur,
    attrs: {
      'sf.video_id': video,
      'sf.workflow_id': 'shorts',
      'sf.step_id': stepId,
      'sf.attempt': 1,
      'sf.step_outcome': outcome,
    },
  });

function db(): Db {
  const t = tempDir('cap-');
  const d = openDb(path.join(t.dir, 'studioflow.db'));
  cleanups.push(() => d.close(), t.cleanup);
  return d;
}

describe('capacity from the app DB (050)', () => {
  it('reads step spans, Claude tokens per video, limit hits; computes today', () => {
    const d = db();
    for (let i = 1; i <= 3; i++) {
      const v = `vd_${i}`;
      step(d, v, 'script', 20 * MIN, NOW - (10 - i) * DAY);
      step(d, v, 'render', 40 * MIN, NOW - (10 - i) * DAY + H);
      addUsage(d, { ts: NOW - (10 - i) * DAY, video: v, tokens: 100_000 * i });
    }
    step(d, 'vd_1', 'render', 500 * MIN, NOW - 5 * DAY, 'failed'); // gate trượt: bỏ
    addUsage(d, { ts: NOW - 2 * DAY, video: 'vd_1', tokens: 9_000, provider: 'openai' }); // không phải Claude
    // chạm hạn mức tuần 1 ngày trước: 7 ngày trước đó dùng 7 000 000 token
    addUsage(d, { ts: NOW - 3 * DAY, tokens: 6_400_000 });
    addSpan(d, {
      name: 'sf.text.call',
      end: NOW - DAY,
      status: 'error',
      message: "claude: You've hit your weekly limit · resets 3am (Asia/Bangkok)",
    });
    addSpan(d, {
      name: 'sf.agent.session',
      end: NOW - 2 * DAY,
      attrs: { 'sf.error': 'socket hang up' },
    });
    // hôm nay (sau 08:00) đã dùng 100 000 token
    addUsage(d, { ts: NOW - H, tokens: 100_000 });

    expect(readStepSpans(d)).toHaveLength(7);
    expect(readVideoTokens(d)).toEqual({ vd_1: 100_000, vd_2: 200_000, vd_3: 300_000 });
    expect(readLimitHits(d, 0)).toEqual([NOW - DAY]);

    const r = capacityFromDb(d, {
      now: NOW,
      timezone: 'Asia/Ho_Chi_Minh',
      work_window: '08:00-23:00',
      budget_share: 0.7,
      daily_tokens: null,
      workflows: [{ id: 'shorts', steps: ['script', 'render'] }],
      channels: [
        {
          channel: 'K',
          workflows: ['shorts'],
          max_per_day: 10,
          done_today: 0,
          platforms: ['youtube'],
        },
      ],
    });
    expect(r.by_workflow).toEqual([
      {
        workflow_id: 'shorts',
        est_ms: 60 * MIN,
        tokens: 200_000,
        samples: 3,
        low_confidence: false,
      },
    ]);
    // 7 ngày trước mốc (NOW−8d, NOW−1d]: token của vd_3 (NOW−7d) + 6,4M; vd_1/vd_2 cũ hơn, dòng hôm nay sau mốc
    expect(r.daily_tokens_source).toBe('learned');
    expect(r.daily_tokens).toBe(Math.round((300_000 + 6_400_000) / 7));
    expect(r.tokens_left).toBe(Math.round(r.daily_tokens! * 0.7 - 100_000));
    // 13 giờ × 0,8 = 10,4 giờ → 10 video × 1 giờ; token ≈ 570 000 → 2 video
    expect(r.window_ms_left).toBe(13 * H);
    expect(r.videos).toBe(2);
    expect(r.limiting_factor).toBe('tokens');
    expect(r.reasons.join('\n')).toMatch(/học từ lần chạm hạn mức/);
  });

  it('empty DB → documented defaults, low confidence, unknown budget', () => {
    const r = capacityFromDb(db(), {
      now: NOW,
      timezone: 'Asia/Ho_Chi_Minh',
      work_window: '08:00-23:00',
      budget_share: 0.7,
      daily_tokens: null,
      workflows: [{ id: 'story-documentary', steps: ['a', 'b'] }],
      channels: [
        { channel: 'K', workflows: [], max_per_day: 1, done_today: 0, platforms: ['youtube'] },
      ],
    });
    expect(r.by_workflow[0]).toMatchObject({ samples: 0, low_confidence: true, est_ms: 180 * MIN });
    expect(r.tokens_left).toBeNull();
    expect(r).toMatchObject({ videos: 1, limiting_factor: 'cap' });
  });
});

describe('engine records the step outcome on its span (050)', () => {
  let fx: WorkflowFixture;
  afterEach(() => fx?.cleanup());
  it('sf.step_outcome = waiting_approval / done', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    const e = fx.core.workflows.engine(fx.dir, fx.videoId);
    await e.select('demo-explainer', 'yt-1080p30');
    await e.approve(e.summary().pending_approvals[0]!);
    await e.advance();
    const spans = readStepSpans(fx.core.db).filter((s) => s.video_id === fx.videoId);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((s) => s.workflow_id === 'demo-explainer')).toBe(true);
    expect(spans.map((s) => s.outcome)).toContain('waiting_approval');
  });
});
