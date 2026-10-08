import type { Db } from '../store/db.js';

/**
 * Mô hình năng lực Autopilot (050, FR-AP-05, FN-050): ước tính số video làm được hôm nay từ thời gian thật
 * của từng bước trên máy này, ngân sách Claude và hạn mức đăng YouTube. Lõi thuần (dễ kiểm) + phần đọc DB mỏng.
 */

const MIN = 60_000;
const DAY_MS = 86_400_000;

/** Biên an toàn thời gian (FN-050 mục 4): thử lại, gate trượt, máy bận việc khác. */
export const CAPACITY_SAFETY = 0.8;
/** Số video gần nhất lấy trung vị (FN-050 mục 2). */
export const CAPACITY_SAMPLES = 5;
/** Dưới số mẫu này → độ tin cậy thấp. */
export const CONFIDENT_SAMPLES = 3;
/** Hạn mức YouTube Data API mỗi dự án Google / ngày và giá một lượt đăng (FN-050 mục 5). */
export const YOUTUBE_QUOTA_UNITS = 10_000;
export const YOUTUBE_UPLOAD_UNITS = 1_600;

/** Mặc định khi workflow chưa chạy trên máy này (FN-050 mục 2 — ước lượng thô). */
export const DEFAULT_WORKFLOW_COST: Record<string, { ms: number; tokens: number }> = {
  'narrated-explainer': { ms: 90 * MIN, tokens: 600_000 },
  'story-documentary': { ms: 180 * MIN, tokens: 800_000 },
  'essay-audiobook': { ms: 60 * MIN, tokens: 400_000 },
  shorts: { ms: 30 * MIN, tokens: 200_000 },
  'short-film': { ms: 240 * MIN, tokens: 1_000_000 },
};
export const FALLBACK_WORKFLOW_COST = { ms: 120 * MIN, tokens: 800_000 };
const defaultCost = (id: string) => DEFAULT_WORKFLOW_COST[id] ?? FALLBACK_WORKFLOW_COST;

/** Thông báo chạm hạn mức gói Claude (khác lỗi 429 tạm thời của API). */
const LIMIT_HIT = /hit your (?:session|usage|weekly|daily|5-hour) limit|usage limit reached/i;
export const isLimitHit = (msg: unknown): boolean => typeof msg === 'string' && LIMIT_HIT.test(msg);

/** Một span `sf.workflow.step` (D11) đã kết thúc. */
export interface StepSpan {
  video_id: string;
  workflow_id: string;
  step_id: string;
  start_ms: number;
  end_ms: number;
  status: string;
  /** `sf.step_outcome` (050): `done` / `waiting_approval` / `failed` / `skipped`; span cũ không có. */
  outcome?: string | null;
}

export interface WorkflowCost {
  workflow_id: string;
  /** Thời gian máy ước tính cho một video (ms). */
  est_ms: number;
  /** Token Claude ước tính cho một video. */
  tokens: number;
  /** Số video mẫu (ít nhất trong các bước); 0 = có bước chưa có lịch sử. */
  samples: number;
  /** Có ít nhất một bước đo được trên máy này. */
  measured: boolean;
  low_confidence: boolean;
  steps: { step_id: string; median_ms: number; samples: number }[];
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Span được tính: không lỗi, không gate trượt. */
const counted = (s: StepSpan) => s.status === 'ok' && s.outcome !== 'failed';

/**
 * Chi phí một video của workflow: mỗi bước lấy lần chạy được tính mới nhất của mỗi video, K video gần nhất,
 * trung vị thời lượng span (thời gian chờ duyệt giữa các bước không nằm trong span). `steps` = id bước
 * trong manifest (thứ tự); không có → các bước đã thấy.
 */
export function workflowCost(
  workflowId: string,
  spans: StepSpan[],
  tokensByVideo: Record<string, number>,
  o: { k?: number; steps?: string[] } = {},
): WorkflowCost {
  const k = o.k ?? CAPACITY_SAMPLES;
  const def = defaultCost(workflowId);
  // bước → video → span mới nhất
  const latest = new Map<string, Map<string, StepSpan>>();
  for (const s of spans) {
    if (s.workflow_id !== workflowId || !counted(s)) continue;
    const byVideo = latest.get(s.step_id) ?? new Map<string, StepSpan>();
    const prev = byVideo.get(s.video_id);
    if (!prev || s.end_ms > prev.end_ms) byVideo.set(s.video_id, s);
    latest.set(s.step_id, byVideo);
  }
  const stepIds = o.steps?.length ? o.steps : [...latest.keys()];
  const steps = stepIds.map((step_id) => {
    const recent = [...(latest.get(step_id)?.values() ?? [])]
      .sort((a, b) => b.end_ms - a.end_ms)
      .slice(0, k);
    return {
      step_id,
      median_ms: median(recent.map((s) => s.end_ms - s.start_ms)),
      samples: recent.length,
    };
  });
  const missing = steps.filter((s) => s.samples === 0).length;
  const measured = steps.length > 0 && missing < steps.length;
  const est_ms = measured
    ? steps.reduce((t, s) => t + s.median_ms, 0) + (def.ms * missing) / steps.length
    : def.ms;
  const samples = steps.length ? Math.min(...steps.map((s) => s.samples)) : 0;
  // token: video đã xong bước cuối (video dở dang chưa đủ token), K video gần nhất
  const last = stepIds[stepIds.length - 1];
  const finished = [...(last ? (latest.get(last)?.values() ?? []) : [])]
    .filter((s) => (tokensByVideo[s.video_id] ?? 0) > 0)
    .sort((a, b) => b.end_ms - a.end_ms)
    .slice(0, k)
    .map((s) => tokensByVideo[s.video_id]!);
  return {
    workflow_id: workflowId,
    est_ms: Math.round(est_ms),
    tokens: finished.length ? Math.round(median(finished)) : def.tokens,
    samples,
    measured,
    low_confidence: samples < CONFIDENT_SAMPLES,
    steps,
  };
}

/**
 * Việc còn lại của một video đang làm dở: trung vị các bước chưa `done`/`skipped` (bước chưa đo → chia đều
 * phần mặc định); token theo tỉ lệ số bước còn lại. Không có bước → cả video.
 */
export function remainingWork(
  cost: WorkflowCost,
  steps: Record<string, { status: string }>,
): { ms: number; tokens: number } {
  if (!cost.steps.length) return { ms: cost.est_ms, tokens: cost.tokens };
  const left = cost.steps.filter(
    (s) => !['done', 'skipped'].includes(steps[s.step_id]?.status ?? ''),
  );
  const unmeasured = cost.steps.filter((s) => s.samples === 0).length;
  const share = unmeasured
    ? (cost.est_ms - cost.steps.reduce((t, s) => t + s.median_ms, 0)) / unmeasured
    : 0;
  const ms = left.reduce((t, s) => t + (s.samples ? s.median_ms : share), 0);
  return {
    ms: Math.round(ms),
    tokens: Math.round((cost.tokens * left.length) / cost.steps.length),
  };
}

/** Phiên của gói Claude (hạn mức phiên tính trên 5 giờ). */
const SESSION_MS = 5 * 60 * MIN;

export interface LimitHit {
  ts_ms: number;
  /** Hạn mức theo tuần; không → hạn mức phiên 5 giờ / chung. */
  weekly: boolean;
}

/**
 * Ngân sách Claude mỗi ngày học từ lần chạm hạn mức gần nhất T (≤ now). Chưa chạm lần nào → null (chưa biết).
 * - Hạn mức tuần: tổng token trong `[T − 7 ngày, T]` ÷ 7.
 * - Hạn mức phiên 5 giờ (076): token trong `(T − 5 giờ, T]` = sức chứa một phiên × số phiên vừa khung giờ làm
 *   việc (`windowMs` ÷ 5 giờ, tối thiểu 1). Trước đây chia đều 7 ngày → app mới dùng vài ngày ra ngân sách quá
 *   thấp, kế hoạch ngày luôn 0 video.
 */
export function learnDailyTokens(
  usage: { ts_ms: number; tokens: number }[],
  limitHits: LimitHit[],
  now: number,
  windowMs: number,
): number | null {
  const hits = limitHits.filter((h) => h.ts_ms <= now);
  if (!hits.length) return null;
  const last = hits.reduce((a, b) => (b.ts_ms > a.ts_ms ? b : a));
  const t = last.ts_ms;
  const span = last.weekly ? 7 * DAY_MS : SESSION_MS;
  const total = usage
    .filter((u) => u.ts_ms > t - span && u.ts_ms <= t)
    .reduce((s, u) => s + u.tokens, 0);
  if (total <= 0) return null;
  return last.weekly
    ? Math.round(total / 7)
    : Math.round(total * Math.max(1, windowMs / SESSION_MS));
}

/** Ms trong ngày theo giờ địa phương của `timeZone`. */
function localMsOfDay(now: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(now));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return ((n('hour') * 60 + n('minute')) * 60 + n('second')) * 1000 + (now % 1000);
}

const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return ((h ?? 0) * 60 + (m ?? 0)) * MIN;
};

/**
 * Khung giờ làm việc `HH:MM-HH:MM` (có thể qua đêm) lúc `now`: còn bao lâu hôm nay và đầu ngày làm việc
 * (đang trong khung → giờ bắt đầu khung; ngoài khung → nửa đêm địa phương). FN-050 mục 4.
 */
export function workWindow(
  window: string,
  now: number,
  timeZone: string,
): { inside: boolean; left_ms: number; day_start_ms: number } {
  const [a, b] = window.split('-');
  const S = hhmm(a ?? '08:00');
  const E = hhmm(b ?? '23:00');
  const t = localMsOfDay(now, timeZone);
  const length = (E - S + DAY_MS) % DAY_MS;
  const midnight = now - t;
  if (S < E) {
    if (t < S) return { inside: false, left_ms: length, day_start_ms: midnight };
    if (t < E) return { inside: true, left_ms: E - t, day_start_ms: now - (t - S) };
    return { inside: false, left_ms: 0, day_start_ms: midnight };
  }
  // qua đêm (ví dụ 22:00-06:00)
  if (t >= S) return { inside: true, left_ms: DAY_MS - t + E, day_start_ms: now - (t - S) };
  if (t < E) return { inside: true, left_ms: E - t, day_start_ms: now - (t + DAY_MS - S) };
  return { inside: false, left_ms: length, day_start_ms: midnight };
}

/** Độ dài khung giờ làm việc `HH:MM-HH:MM` (có thể qua đêm). */
export function windowLengthMs(window: string): number {
  const [a, b] = window.split('-');
  return (hhmm(b ?? '23:00') - hhmm(a ?? '08:00') + DAY_MS) % DAY_MS || DAY_MS;
}

export type LimitingFactor = 'time' | 'tokens' | 'uploads' | 'cap';

/** Một kênh bộ lập kế hoạch (051) / IPC đưa vào. */
export interface CapacityChannel {
  channel: string;
  name?: string;
  /** `autopilot.workflows`; rỗng = mọi workflow có trong `costs`. */
  workflows: string[];
  max_per_day: number;
  /** Video Autopilot đã tạo trong ngày làm việc này. */
  done_today: number;
  /** `publish.platforms`; có `youtube` → tốn lượt đăng YouTube. */
  platforms: string[];
}

export interface CapacityInput {
  now: number;
  timezone: string;
  work_window: string;
  budget_share: number;
  /** `autopilot.daily_tokens` (ghi đè); null = dùng giá trị học được. */
  daily_tokens: number | null;
  learned_daily_tokens: number | null;
  /** Token Claude đã dùng từ đầu ngày làm việc (mọi việc, kể cả chat tay). */
  tokens_used_today: number;
  costs: WorkflowCost[];
  /** Thời gian / token còn cần cho video đang làm dở hoặc đã xếp hàng. */
  busy_ms?: number;
  busy_tokens?: number;
  /** Đơn vị YouTube Data API đã dùng hôm nay (049 quét, 053 đăng). */
  youtube_units_used_today?: number;
  channels: CapacityChannel[];
  safety?: number;
}

export interface CapacityResult {
  videos: number;
  by_workflow: {
    workflow_id: string;
    est_ms: number;
    tokens: number;
    samples: number;
    low_confidence: boolean;
  }[];
  window_ms_left: number;
  /** Quỹ thời gian sau biên an toàn và việc đang dở. */
  time_budget_ms: number;
  /** null = chưa biết ngân sách Claude (không giới hạn theo token). */
  tokens_left: number | null;
  daily_tokens: number | null;
  daily_tokens_source: 'override' | 'learned' | 'unknown';
  upload_quota_left: number;
  limiting_factor: LimitingFactor;
  channels: {
    channel: string;
    name?: string;
    videos: number;
    cap_left: number;
    est_ms: number;
    tokens: number;
    limiting_factor: LimitingFactor;
  }[];
  reasons: string[];
}

const fmtMs = (ms: number) =>
  ms >= 60 * MIN
    ? `${(ms / (60 * MIN)).toFixed(1).replace('.', ',')} giờ`
    : `${Math.round(ms / MIN)} phút`;
const fmtN = (n: number) => Math.round(n).toLocaleString('vi-VN');
const EPS = 1e-6;
const ORDER: LimitingFactor[] = ['time', 'tokens', 'uploads'];
const FACTOR_TEXT: Record<LimitingFactor, string> = {
  time: 'thời gian máy còn trong khung giờ',
  tokens: 'ngân sách Claude',
  uploads: 'hạn mức đăng YouTube',
  cap: 'số video tối đa mỗi ngày của kênh',
};

/** Số video làm được hôm nay (tổng và từng kênh) + yếu tố giới hạn + lý do (FN-050 mục 6). */
export function capacityToday(i: CapacityInput): CapacityResult {
  const safety = i.safety ?? CAPACITY_SAFETY;
  const reasons: string[] = [];
  const win = workWindow(i.work_window, i.now, i.timezone);
  const time_budget_ms = Math.max(0, win.left_ms * safety - (i.busy_ms ?? 0));
  reasons.push(
    `Còn ${fmtMs(win.left_ms)} trong khung giờ ${i.work_window} (${i.timezone}); tính ${Math.round(safety * 100)}% để dự phòng${
      i.busy_ms ? `, trừ ${fmtMs(i.busy_ms)} cho video đang làm dở` : ''
    } → quỹ ${fmtMs(time_budget_ms)}.`,
  );

  const daily = i.daily_tokens && i.daily_tokens > 0 ? i.daily_tokens : i.learned_daily_tokens;
  const daily_tokens_source =
    i.daily_tokens && i.daily_tokens > 0 ? 'override' : daily ? 'learned' : 'unknown';
  const tokens_left = daily
    ? Math.max(0, Math.round(daily * i.budget_share - i.tokens_used_today - (i.busy_tokens ?? 0)))
    : null;
  reasons.push(
    daily
      ? `Ngân sách Claude ≈ ${fmtN(daily)} token/ngày (${daily_tokens_source === 'override' ? 'đặt trong Cài đặt' : 'học từ lần chạm hạn mức gần nhất'}); Autopilot dùng ${Math.round(i.budget_share * 100)}%, đã dùng hôm nay ${fmtN(i.tokens_used_today)} → còn ${fmtN(tokens_left!)} token.`
      : 'Chưa biết ngân sách Claude (chưa chạm hạn mức lần nào, chưa đặt autopilot.daily_tokens) — chưa giới hạn theo token.',
  );

  const upload_quota_left = Math.floor(
    Math.max(0, YOUTUBE_QUOTA_UNITS - (i.youtube_units_used_today ?? 0)) / YOUTUBE_UPLOAD_UNITS,
  );
  reasons.push(`Hạn mức YouTube còn ${upload_quota_left} lượt đăng hôm nay (chung mọi kênh).`);

  const byId = new Map(i.costs.map((c) => [c.workflow_id, c]));
  const costOf = (id: string): WorkflowCost => byId.get(id) ?? workflowCost(id, [], {}, {});
  const used = new Map<string, WorkflowCost>(i.costs.map((c) => [c.workflow_id, c]));
  const chans = i.channels.map((c) => {
    const ids = c.workflows.length ? c.workflows : [...byId.keys()];
    const cs = ids.map(costOf);
    for (const x of cs) used.set(x.workflow_id, x);
    const avg = (f: (x: WorkflowCost) => number) =>
      cs.length ? cs.reduce((t, x) => t + f(x), 0) / cs.length : FALLBACK_WORKFLOW_COST.ms;
    return {
      c,
      est_ms: Math.round(avg((x) => x.est_ms)),
      tokens: Math.round(cs.length ? avg((x) => x.tokens) : FALLBACK_WORKFLOW_COST.tokens),
      youtube: c.platforms.includes('youtube'),
      cap_left: Math.max(0, c.max_per_day - c.done_today),
      videos: 0,
      blocked: undefined as LimitingFactor | undefined,
    };
  });
  for (const w of used.values())
    reasons.push(
      `${w.workflow_id}: ~${fmtMs(w.est_ms)} và ${fmtN(w.tokens)} token mỗi video (${
        w.measured
          ? `${w.samples} video mẫu${w.low_confidence ? ', độ tin cậy thấp' : ''}`
          : 'chưa có lịch sử trên máy này — dùng giá trị mặc định'
      }).`,
    );

  // chia vòng tròn: mỗi vòng mỗi kênh còn trần nhận một video nếu còn đủ tài nguyên
  let time = time_budget_ms;
  let tokens = tokens_left ?? Infinity;
  let uploads = upload_quota_left;
  for (let progress = true; progress;) {
    progress = false;
    for (const ch of chans) {
      if (ch.blocked || ch.videos >= ch.cap_left) continue;
      const lack: LimitingFactor[] = [];
      if (ch.est_ms > time + EPS) lack.push('time');
      if (ch.tokens > tokens + EPS) lack.push('tokens');
      if (ch.youtube && uploads < 1) lack.push('uploads');
      if (lack.length) {
        ch.blocked = lack[0];
        continue;
      }
      time -= ch.est_ms;
      tokens -= ch.tokens;
      if (ch.youtube) uploads -= 1;
      ch.videos += 1;
      progress = true;
    }
  }
  const channels = chans.map((ch) => ({
    channel: ch.c.channel,
    ...(ch.c.name ? { name: ch.c.name } : {}),
    videos: ch.videos,
    cap_left: ch.cap_left,
    est_ms: ch.est_ms,
    tokens: ch.tokens,
    limiting_factor: ch.blocked ?? ('cap' as LimitingFactor),
  }));
  const factors = new Set(channels.map((c) => c.limiting_factor));
  const limiting_factor = ORDER.find((f) => factors.has(f)) ?? 'cap';
  const videos = channels.reduce((t, c) => t + c.videos, 0);
  if (!channels.length) reasons.push('Không có kênh nào đang bật Autopilot.');
  for (const c of channels)
    reasons.push(
      `${c.name ?? c.channel}: ${c.videos} video (trần còn ${c.cap_left}) — giới hạn bởi ${FACTOR_TEXT[c.limiting_factor]}.`,
    );
  reasons.push(`Tổng: ${videos} video hôm nay — giới hạn bởi ${FACTOR_TEXT[limiting_factor]}.`);
  return {
    videos,
    by_workflow: [...used.values()].map((w) => ({
      workflow_id: w.workflow_id,
      est_ms: w.est_ms,
      tokens: w.tokens,
      samples: w.samples,
      low_confidence: w.low_confidence,
    })),
    window_ms_left: win.left_ms,
    time_budget_ms,
    tokens_left,
    daily_tokens: daily ?? null,
    daily_tokens_source,
    upload_quota_left,
    limiting_factor,
    channels,
    reasons,
  };
}

// ---------- đọc DB (bảng `spans`, `usage` — D11) ----------

const parse = (s: unknown): Record<string, unknown> => {
  try {
    return JSON.parse(String(s)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** Span `sf.workflow.step` đã kết thúc từ `sinceMs`. */
export function readStepSpans(db: Db, sinceMs = 0): StepSpan[] {
  const rows = db
    .prepare(
      "SELECT start_ms, end_ms, status, video_id, attrs FROM spans WHERE name = 'sf.workflow.step' AND end_ms >= ?",
    )
    .all(sinceMs) as {
    start_ms: number;
    end_ms: number;
    status: string;
    video_id: string | null;
    attrs: string;
  }[];
  return rows.flatMap((r) => {
    const a = parse(r.attrs);
    const video_id = r.video_id ?? (a['sf.video_id'] as string | undefined);
    const workflow_id = a['sf.workflow_id'] as string | undefined;
    const step_id = a['sf.step_id'] as string | undefined;
    if (!video_id || !workflow_id || !step_id) return [];
    return [
      {
        video_id,
        workflow_id,
        step_id,
        start_ms: r.start_ms,
        end_ms: r.end_ms,
        status: r.status,
        outcome: (a['sf.step_outcome'] as string | undefined) ?? null,
      },
    ];
  });
}

const CLAUDE_USAGE = "FROM usage WHERE kind = 'llm' AND provider = 'claude'";

/** Token Claude theo video (bảng `usage`). */
export function readVideoTokens(db: Db): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT video_id, SUM(input_tokens + output_tokens) AS t ${CLAUDE_USAGE} AND video_id IS NOT NULL GROUP BY video_id`,
    )
    .all() as { video_id: string; t: number }[];
  return Object.fromEntries(rows.map((r) => [r.video_id, Number(r.t)]));
}

/** Dòng token Claude từ `sinceMs` (mọi việc, kể cả chat tay). */
export function readClaudeUsage(db: Db, sinceMs: number): { ts_ms: number; tokens: number }[] {
  const rows = db
    .prepare(`SELECT ts, input_tokens + output_tokens AS t ${CLAUDE_USAGE} AND ts >= ?`)
    .all(new Date(sinceMs).toISOString()) as { ts: string; t: number }[];
  return rows.map((r) => ({ ts_ms: Date.parse(r.ts), tokens: Number(r.t) }));
}

/** Thời điểm các lần chạm hạn mức Claude (thông báo trong `status_message` hoặc `sf.error` của span). */
export function readLimitHits(db: Db, sinceMs: number): LimitHit[] {
  const rows = db
    .prepare(
      "SELECT end_ms, status_message, attrs FROM spans WHERE end_ms >= ? AND (status_message IS NOT NULL OR attrs LIKE '%sf.error%')",
    )
    .all(sinceMs) as { end_ms: number; status_message: string | null; attrs: string }[];
  return rows.flatMap((r) => {
    const text = [r.status_message, parse(r.attrs)['sf.error']].find((x) => isLimitHit(x));
    return text ? [{ ts_ms: r.end_ms, weekly: /weekly/i.test(String(text)) }] : [];
  });
}

export interface CapacityFromDbInput extends Omit<
  CapacityInput,
  'costs' | 'learned_daily_tokens' | 'tokens_used_today'
> {
  /** Workflow cài sẵn và id bước trong manifest (thứ tự). */
  workflows: { id: string; steps: string[] }[];
  k?: number;
}

/** Đọc lịch sử từ DB rồi gọi `capacityToday` (IPC `autopilot.capacity`). */
export function capacityFromDb(db: Db, i: CapacityFromDbInput): CapacityResult {
  const { workflows, k, ...rest } = i;
  const spans = readStepSpans(db);
  const tokensByVideo = readVideoTokens(db);
  const costs = workflows.map((w) =>
    workflowCost(w.id, spans, tokensByVideo, { k, steps: w.steps }),
  );
  const win = workWindow(i.work_window, i.now, i.timezone);
  const since = Math.min(win.day_start_ms, i.now - 37 * DAY_MS);
  const usage = readClaudeUsage(db, since);
  return capacityToday({
    ...rest,
    costs,
    learned_daily_tokens: learnDailyTokens(
      usage,
      readLimitHits(db, i.now - 30 * DAY_MS),
      i.now,
      windowLengthMs(i.work_window),
    ),
    tokens_used_today: usage
      .filter((u) => u.ts_ms >= win.day_start_ms && u.ts_ms <= i.now)
      .reduce((s, u) => s + u.tokens, 0),
  });
}
