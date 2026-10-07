import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAppConfig, resolveConfig } from '../config/resolve.js';
import type {
  ChannelConfig,
  DailyPlan,
  PlanItem,
  PlanItemStatus,
  ResearchCandidate,
  ResearchDoc,
} from '../contracts/types.js';
import { newId } from '../domain/ids.js';
import { SfError } from '../errors.js';
import { jaccard, RESEARCH_CONSTANTS, tokenize } from '../research/score.js';
import { readResearch, researchDate, scanChannel } from '../research/scan.js';
import type { WriteStore } from '../store/writer.js';
import type { FetchFn } from '../youtube/data-api.js';
import {
  DEFAULT_WORKFLOW_COST,
  FALLBACK_WORKFLOW_COST,
  type CapacityChannel,
  type CapacityResult,
} from './capacity.js';

/**
 * Kế hoạch ngày Autopilot (051, FR-AP-06): từ kết quả nghiên cứu (049) và năng lực (050) lập danh sách video
 * hôm nay của mỗi kênh — chủ đề, workflow, khung giờ đăng, lý do — ghi `autopilot/plans/<ngày>.json` (D3 5.18).
 * Phần chọn là hàm thuần; luật chi tiết: FN-051 (`docs/feature-notes/051-plan.md`).
 */
export const PLAN_CONSTANTS = {
  /** Không lập lại ứng viên đã nằm trong kế hoạch ngần này ngày gần nhất. */
  HISTORY_DAYS: 14,
  /** Gần trùng tiêu đề: Jaccard ≥ ngưỡng của nghiên cứu (049). */
  DUP_SIMILARITY: RESEARCH_CONSTANTS.DUP_SIMILARITY,
  /** Video đối thủ ≤ ngần này giây → dạng ngắn (Shorts). */
  SHORT_MAX_S: 60,
  /** Tìm khung giờ đăng tối đa ngần này ngày tới. */
  SLOT_HORIZON_DAYS: 30,
} as const;

const C = PLAN_CONSTANTS;
const MIN = 60_000;
const PLANS_DIR = 'autopilot/plans';
const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;
/** Trạng thái đã bắt đầu làm: tính vào trần `autopilot.max_per_day` và việc đã dùng của hôm nay. */
const STARTED: ReadonlySet<PlanItemStatus> = new Set(['in_production', 'produced', 'failed']);
const LOCKED = STARTED;

/** Workflow đã cài (tên gọn của gói workflow: id + dạng xuất cho phép, phần tử đầu là mặc định). */
export interface PlanWorkflow {
  id: string;
  output_profiles: string[];
}

// ---------- ngày giờ theo múi giờ ----------

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function zoneParts(ms: number, timeZone: string): Parts {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const n = (t: string) => Number(f.formatToParts(ms).find((p) => p.type === t)!.value);
  return {
    y: n('year'),
    mo: n('month'),
    d: n('day'),
    h: n('hour'),
    mi: n('minute'),
    s: n('second'),
  };
}

/** Độ lệch múi giờ so với UTC tại thời điểm `ms` (ms, dương = trước UTC). */
function offsetMs(ms: number, timeZone: string): number {
  const p = zoneParts(ms, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Thời điểm UTC của giờ địa phương `date` `hh:mm` (hai vòng để đúng quanh lúc đổi giờ mùa hè). */
function zonedMs(date: string, hh: number, mm: number, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const guess = Date.UTC(y!, mo! - 1, d!, hh, mm);
  const t = guess - offsetMs(guess, timeZone);
  return guess - offsetMs(t, timeZone);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-10-07T19:00:00+07:00` — giờ địa phương kèm offset của múi giờ. */
function isoWithOffset(ms: number, timeZone: string): string {
  const p = zoneParts(ms, timeZone);
  const off = Math.round(offsetMs(ms, timeZone) / MIN);
  const a = Math.abs(off);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};

/** 0 = thứ Hai … 6 = Chủ nhật của một ngày `YYYY-MM-DD`. */
const weekday = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7;
};

// ---------- khung giờ đăng ----------

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const SLOT =
  /^(?:(mon|tue|wed|thu|fri|sat|sun)(?:-(mon|tue|wed|thu|fri|sat|sun))? )?([01]\d|2[0-3]):([0-5]\d)$/;

interface Slot {
  /** null = mọi ngày. */
  days: Set<number> | null;
  h: number;
  m: number;
}

/** `HH:MM`, `<thứ> HH:MM`, `<thứ>-<thứ> HH:MM` (khoảng được vòng, ví dụ `sat-mon`); khung hỏng bị bỏ. */
function parseSlots(slots: string[]): Slot[] {
  return slots.flatMap((s) => {
    const m = SLOT.exec(s.trim());
    if (!m) return [];
    let days: Set<number> | null = null;
    if (m[1]) {
      const a = DAYS.indexOf(m[1]);
      const b = m[2] ? DAYS.indexOf(m[2]) : a;
      days = new Set();
      for (let i = a; ; i = (i + 1) % 7) {
        days.add(i);
        if (i === b) break;
      }
    }
    return [{ days, h: Number(m[3]), m: Number(m[4]) }];
  });
}

/**
 * Khung giờ đăng gần nhất **sau hẳn** `after_ms`, theo `timezone`, chưa nằm trong `taken` (các thời điểm
 * đã dùng, ms); hết khung hôm nay → ngày kế. Không có khung nào trong chân trời → `null`.
 */
export function assignPublishSlot(o: {
  slots: string[];
  timezone: string;
  after_ms: number;
  taken: ReadonlySet<number>;
}): string | null {
  const slots = parseSlots(o.slots).sort((a, b) => a.h - b.h || a.m - b.m);
  if (!slots.length) return null;
  const p = zoneParts(o.after_ms, o.timezone);
  const start = `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
  for (let n = 0; n <= C.SLOT_HORIZON_DAYS; n++) {
    const date = addDays(start, n);
    const wd = weekday(date);
    for (const s of slots) {
      if (s.days && !s.days.has(wd)) continue;
      const ms = zonedMs(date, s.h, s.m, o.timezone);
      if (ms > o.after_ms && !o.taken.has(ms)) return isoWithOffset(ms, o.timezone);
    }
  }
  return null;
}

// ---------- workflow ----------

/** Workflow dùng được: `autopilot.workflows` (giữ thứ tự người dùng) lọc theo đã cài; rỗng = mọi workflow cài sẵn. */
export function allowedWorkflows(configured: string[], installed: PlanWorkflow[]): PlanWorkflow[] {
  if (!configured.length) return installed;
  return configured.flatMap((id) => installed.filter((w) => w.id === id));
}

const SHORTS = 'shorts';

/**
 * Chọn workflow + dạng xuất cho một chủ đề: ≤ 60 giây và kênh dùng được `shorts` → shorts; ngược lại
 * `workflow.default` nếu dùng được, không thì workflow dài đầu tiên (chỉ còn shorts → shorts).
 */
export function chooseWorkflow(
  c: ResearchCandidate,
  o: { allowed: PlanWorkflow[]; default_workflow: string },
): { workflow_id: string; output_profile: string; reason: string } | undefined {
  const pick = (w: PlanWorkflow, reason: string) => ({
    workflow_id: w.id,
    output_profile: w.output_profiles[0] ?? '',
    reason,
  });
  const shorts = o.allowed.find((w) => w.id === SHORTS);
  const dur = c.metrics?.duration_s;
  if (shorts && typeof dur === 'number' && dur > 0 && dur <= C.SHORT_MAX_S)
    return pick(
      shorts,
      `Video nguồn dài ${Math.round(dur)} giây (≤ ${C.SHORT_MAX_S}) → làm dạng ngắn.`,
    );
  const def = o.allowed.find((w) => w.id === o.default_workflow);
  if (def) return pick(def, `Workflow mặc định của kênh (${def.id}).`);
  const long = o.allowed.find((w) => w.id !== SHORTS);
  if (long)
    return pick(long, `Workflow mặc định không nằm trong danh sách cho phép → dùng ${long.id}.`);
  return shorts ? pick(shorts, 'Kênh chỉ cho phép workflow dạng ngắn.') : undefined;
}

// ---------- chọn ứng viên ----------

/** Số chỗ còn trống: năng lực (đã gồm mục planned) và trần ngày — trần chỉ đếm mục Autopilot, không đếm video làm tay. */
export function freeSlots(o: {
  feasible: number;
  max_per_day: number;
  planned: number;
  started: number;
}): number {
  return Math.max(0, Math.min(o.feasible - o.planned, o.max_per_day - (o.planned + o.started)));
}

type Tier = 'strict' | 'source' | 'any';

export interface Selection {
  picked: { candidate: ResearchCandidate; tier: Tier }[];
  /** Số ứng viên trong nghiên cứu. */
  total: number;
  /** Số ứng viên còn lại sau khi loại. */
  pool: number;
  /** Bị loại vì đã lập trong 14 ngày / gần trùng. */
  duplicates: number;
  /** Bị loại vì kênh đã làm chủ đề gần trùng. */
  made: number;
  /** Bị loại vì điểm thấp hơn `min_score` (không tính ứng viên đã bị loại vì trùng). */
  low: number;
}

const sourceKey = (id: string, ch?: { id: string }) => ch?.id ?? id;

/**
 * Chọn tối đa `slots` ứng viên: bỏ ứng viên đã lập (cùng ID / gần trùng tiêu đề, mọi trạng thái) trong
 * `history` và chủ đề kênh đã làm; xếp theo điểm; chọn tham lam, ưu tiên khác nguồn và khác chủ đề trụ cột
 * với các mục trong ngày (`today`), chỉ hạ ràng buộc khi không còn lựa chọn khác.
 */
export function selectCandidates(o: {
  candidates: ResearchCandidate[];
  slots: number;
  /** Mục kế hoạch 14 ngày gần nhất và các mục đã có hôm nay (mọi trạng thái). */
  history: PlanItem[];
  /** Mục hôm nay chưa bỏ qua — gieo ràng buộc đa dạng. */
  today: PlanItem[];
  /** `autopilot.min_score`: ứng viên điểm thấp hơn không được chọn (mặc định 0 = không chặn). */
  min_score?: number;
}): Selection {
  const seen = new Set(o.history.map((h) => h.candidate_id));
  const seenTokens = o.history.map((h) => tokenize(h.title));
  const near = (t: string[], others: string[][]) =>
    others.some((x) => jaccard(t, x) >= C.DUP_SIMILARITY);
  let duplicates = 0;
  let made = 0;
  let low = 0;
  const min = o.min_score ?? 0;
  const pool: { c: ResearchCandidate; tokens: string[] }[] = [];
  // sort ổn định: hòa điểm giữ thứ tự trong file nghiên cứu
  for (const c of [...o.candidates].sort((a, b) => b.score - a.score)) {
    const tokens = tokenize(c.title);
    if (seen.has(c.id) || near(tokens, seenTokens)) duplicates++;
    else if ((c.metrics?.similarity ?? 0) >= C.DUP_SIMILARITY) made++;
    else if (c.score < min) low++;
    else pool.push({ c, tokens });
  }

  const byId = new Map(o.candidates.map((c) => [c.id, c]));
  const sources = new Set(o.today.map((t) => sourceKey(t.candidate_id, t.source.source_channel)));
  const pillars = new Set(
    o.today.flatMap((t) => {
      const p = byId.get(t.candidate_id)?.pillar;
      return p ? [p] : [];
    }),
  );
  const chosen: string[][] = [];
  const picked: Selection['picked'] = [];
  const left = [...pool];
  while (picked.length < o.slots) {
    const free = left.filter((x) => !near(x.tokens, chosen));
    const ok = (tier: Tier) => (x: { c: ResearchCandidate }) =>
      tier === 'any' ||
      (!sources.has(sourceKey(x.c.id, x.c.source_channel)) &&
        (tier === 'source' || !x.c.pillar || !pillars.has(x.c.pillar)));
    let hit: { c: ResearchCandidate; tokens: string[] } | undefined;
    let tier: Tier = 'strict';
    for (tier of ['strict', 'source', 'any'] as const) {
      hit = free.find(ok(tier));
      if (hit) break;
    }
    if (!hit) break;
    picked.push({ candidate: hit.c, tier });
    chosen.push(hit.tokens);
    sources.add(sourceKey(hit.c.id, hit.c.source_channel));
    if (hit.c.pillar) pillars.add(hit.c.pillar);
    left.splice(left.indexOf(hit), 1);
  }
  return { picked, total: o.candidates.length, pool: pool.length, duplicates, made, low };
}

// ---------- lập kế hoạch một kênh ----------

export interface PlanCapacity {
  /** Số video khả thi còn lại của kênh hôm nay (050), đã gồm các mục planned. */
  videos: number;
  limiting_factor: DailyPlan['capacity']['limiting_factor'];
  reasons: string[];
  /** Thời gian máy ước tính một video theo workflow (ms). */
  est_ms: Record<string, number>;
}

export interface BuildPlanInput {
  channel_id: string;
  /** YYYY-MM-DD theo múi giờ của kênh. */
  date: string;
  now: Date;
  timezone: string;
  /** Kế hoạch đã có của ngày này (lập lại → giữ nguyên mọi mục). */
  existing?: DailyPlan;
  /** Kế hoạch các ngày khác trong cửa sổ 14 ngày (và ngày tới): chống lặp + khung giờ đã dùng. */
  others: DailyPlan[];
  /** Kết quả nghiên cứu hôm nay; `undefined` = chưa có. */
  research: ResearchDoc | undefined;
  capacity: PlanCapacity;
  config: {
    max_per_day: number;
    /** `autopilot.workflows` (rỗng = mọi workflow cài sẵn). */
    workflows: string[];
    default_workflow: string;
    slots: string[];
    platforms: string[];
    /** `autopilot.min_score` (0–100). */
    min_score: number;
  };
  installed: PlanWorkflow[];
}

export interface PlanDay {
  plan: DailyPlan;
  /** Kế hoạch ngày hôm trước đã sửa (mục chuyển sang hôm nay → `skipped`); `undefined` = không đổi. */
  previous?: DailyPlan;
  /** Số mục chuyển từ hôm qua sang hôm nay lần này. */
  carried: number;
}

const FACTOR_TEXT: Record<DailyPlan['capacity']['limiting_factor'], string> = {
  time: 'thời gian máy còn trong khung giờ',
  tokens: 'ngân sách Claude',
  uploads: 'hạn mức đăng YouTube',
  cap: 'số video tối đa mỗi ngày của kênh',
};
const KIND_TEXT: Record<ResearchCandidate['kind'], string> = {
  competitor: 'Đối thủ vừa đăng',
  competitor_evergreen: 'Video nổi bật cũ của đối thủ',
  trending: 'Đang trending',
  trend: 'Đang được tìm nhiều',
  news: 'Tin nóng',
};

const fmtMs = (ms: number) =>
  ms >= 60 * MIN
    ? `${(ms / (60 * MIN)).toFixed(1).replace('.', ',')} giờ`
    : `${Math.round(ms / MIN)} phút`;

const estOf = (cap: PlanCapacity, workflow: string): number =>
  cap.est_ms[workflow] ?? DEFAULT_WORKFLOW_COST[workflow]?.ms ?? FALLBACK_WORKFLOW_COST.ms;

const toMs = (iso: string | null): number | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
};

/** Một dòng "vì sao / góc nhìn" từ nguồn và lý do điểm cao nhất của ứng viên. */
function angleOf(c: ResearchCandidate): string {
  const from = c.source_channel ? ` (${c.source_channel.title})` : '';
  const why = c.reasons[0] ?? `điểm ${c.score}/100`;
  const pillar = c.pillar ? ` — chủ đề "${c.pillar}"` : '';
  return `${KIND_TEXT[c.kind]}${from}: ${why}${pillar}`;
}

/**
 * Lập (hoặc lập lại) kế hoạch ngày của một kênh — thuần, không đọc/ghi file. Giữ nguyên mọi mục đã có
 * (kể cả `planned`: người dùng có thể đã sửa) và chỉ lấp chỗ trống; `autopilot.max_per_day` chỉ đếm mục
 * của kế hoạch này (video Autopilot), không đếm video làm tay. Chỗ trống được lấp trước bằng mục `planned`
 * chưa làm của ngày hôm trước (chỉ ngày ngay trước), rồi mới đến ứng viên mới đạt `min_score`.
 */
export function buildPlan(i: BuildPlanInput): DailyPlan {
  return planDay(i).plan;
}

/** Như `buildPlan` nhưng trả thêm kế hoạch hôm trước đã cập nhật khi có mục chuyển sang. */
export function planDay(i: BuildPlanInput): PlanDay {
  const existing = i.existing?.items ?? [];
  const planned = existing.filter((x) => x.status === 'planned');
  const started = existing.filter((x) => STARTED.has(x.status)).length;
  const allowed = allowedWorkflows(i.config.workflows, i.installed);
  const free0 = freeSlots({
    feasible: i.capacity.videos,
    max_per_day: i.config.max_per_day,
    planned: planned.length,
    started,
  });
  let free = free0;
  const notes: string[] = [];
  const added: PlanItem[] = [];
  let previous: DailyPlan | undefined;

  const others = i.others.flatMap((p) => p.items);
  const taken = new Set<number>(
    [...others, ...existing].flatMap((x) => {
      const t = x.status === 'skipped' ? undefined : toMs(x.publish_at);
      return t === undefined ? [] : [t];
    }),
  );
  const ids = new Set<string>([...others, ...existing].map((x) => x.id));
  // các mục planned làm trước, rồi mục mới nối tiếp (làm lần lượt)
  let ready = i.now.getTime() + planned.reduce((t, x) => t + estOf(i.capacity, x.workflow_id), 0);
  const schedule = (workflow_id: string): string | null => {
    ready += estOf(i.capacity, workflow_id);
    const publish_at = assignPublishSlot({
      slots: i.config.slots,
      timezone: i.timezone,
      after_ms: ready,
      taken,
    });
    const at = toMs(publish_at);
    if (at !== undefined) taken.add(at);
    return publish_at;
  };
  const fresh = (): PlanItem['id'] => {
    const id = newId('pi', ids);
    ids.add(id);
    return id as PlanItem['id'];
  };

  // mục planned của ngày ngay trước: chuyển sang hôm nay trước ứng viên mới (không chặn bởi chống lặp 14 ngày)
  const prevDate = addDays(i.date, -1);
  const prev = i.others.find((p) => p.date === prevDate);
  const carry = (prev?.items ?? []).filter((x) => x.status === 'planned');
  let carried = 0;
  if (prev && carry.length && allowed.length) {
    const retired = new Set<string>();
    const have = new Set(existing.map((x) => x.candidate_id));
    for (const old of carry) {
      // đã có bản sao hôm nay (lần chuyển dở dang) → chỉ đóng mục cũ, không nhân đôi
      if (have.has(old.candidate_id)) {
        retired.add(old.id);
        continue;
      }
      if (free <= 0) break;
      const same = allowed.find((x) => x.id === old.workflow_id);
      const w = same
        ? { workflow_id: same.id, output_profile: old.output_profile }
        : chooseWorkflow(
            {
              id: old.candidate_id,
              kind: old.source.kind,
              title: old.title,
              score: old.score,
              reasons: [],
            },
            { allowed, default_workflow: i.config.default_workflow },
          )!;
      const publish_at = schedule(w.workflow_id);
      added.push({
        ...old,
        id: fresh(),
        status: 'planned',
        workflow_id: w.workflow_id,
        output_profile: w.output_profile,
        publish_at,
        platforms: [...i.config.platforms],
        reasons: [
          // bỏ dòng giờ đăng và dòng chuyển cũ — giờ đăng được gán lại theo khung giờ hôm nay
          ...old.reasons.filter(
            (r) =>
              !r.startsWith('Chuyển từ kế hoạch') &&
              !r.startsWith('Giờ đăng') &&
              !r.startsWith('Kênh chưa đặt khung giờ đăng'),
          ),
          `Chuyển từ kế hoạch ${prevDate}`,
          publish_at
            ? `Giờ đăng ${publish_at}: khung giờ trống đầu tiên sau khi video làm xong.`
            : 'Kênh chưa đặt khung giờ đăng (publish.slots) nên chưa có giờ đăng.',
        ],
      });
      retired.add(old.id);
      carried++;
      free--;
    }
    if (retired.size) {
      previous = {
        ...prev,
        generated_at: i.now.toISOString(),
        items: prev.items.map((x) =>
          retired.has(x.id) ? { ...x, status: 'skipped', note: `chuyển sang ${i.date}` } : x,
        ),
      };
    }
    const left = carry.length - retired.size;
    if (left > 0)
      notes.push(
        `Còn ${left} mục chưa làm của kế hoạch ${prevDate} chưa chuyển được vì hết chỗ trống hôm nay.`,
      );
  }

  if (!allowed.length) {
    notes.push(
      i.config.workflows.length
        ? `Không workflow nào trong danh sách cho phép (${i.config.workflows.join(', ')}) đang được cài — chưa lập video.`
        : 'Chưa cài workflow nào — chưa lập video.',
    );
  } else if (free0 <= 0) {
    if (i.capacity.videos <= 0)
      notes.push(
        `Hôm nay chưa lập thêm được video: năng lực còn lại bằng 0 (giới hạn bởi ${FACTOR_TEXT[i.capacity.limiting_factor]}).`,
      );
    else if (!existing.length)
      notes.push(`Kênh đặt tối đa ${i.config.max_per_day} video mỗi ngày — chưa lập video.`);
  } else if (free <= 0) {
    // chỗ trống đã được lấp bằng mục chuyển từ hôm qua
  } else if (!i.research) {
    notes.push('Chưa có kết quả quét nghiên cứu hôm nay nên chưa chọn được chủ đề.');
  } else {
    const history = [...others, ...existing, ...added];
    const sel = selectCandidates({
      candidates: i.research.candidates,
      slots: free,
      history,
      today: [...existing, ...added].filter((x) => x.status !== 'skipped'),
      min_score: i.config.min_score,
    });
    if (!sel.total)
      notes.push(
        'Nghiên cứu hôm nay không có ứng viên nào (đối thủ chưa đăng gì mới, không có trending/tin phù hợp trụ cột) — không lập video.',
      );
    else if (sel.picked.length < free && sel.low > 0)
      notes.push(
        `${
          sel.pool
            ? `Chỉ ${sel.pool} chủ đề đạt điểm ≥ ${i.config.min_score}`
            : `Không chủ đề mới nào đạt điểm ≥ ${i.config.min_score}`
        }, không làm thêm video kém (${sel.low} chủ đề điểm thấp hơn bị bỏ${
          sel.duplicates + sel.made ? `, ${sel.duplicates + sel.made} chủ đề bị loại vì trùng` : ''
        }).`,
      );
    else if (!sel.pool)
      notes.push(
        `Cả ${sel.total} ứng viên đều đã được lập trong ${C.HISTORY_DAYS} ngày qua hoặc trùng video kênh đã làm — không lập video.`,
      );
    else if (sel.picked.length < free)
      notes.push(
        `Chỉ có ${sel.pool} ứng viên mới cho ${free} chỗ trống (${sel.duplicates + sel.made} ứng viên bị loại vì trùng).`,
      );

    for (const { candidate: c, tier } of sel.picked) {
      const w = chooseWorkflow(c, { allowed, default_workflow: i.config.default_workflow })!;
      const est = estOf(i.capacity, w.workflow_id);
      const publish_at = schedule(w.workflow_id);
      added.push({
        id: fresh(),
        status: 'planned',
        candidate_id: c.id,
        title: c.title,
        angle: angleOf(c),
        source: {
          kind: c.kind,
          ...(c.url ? { url: c.url } : {}),
          ...(c.source_channel ? { source_channel: c.source_channel } : {}),
        },
        workflow_id: w.workflow_id,
        output_profile: w.output_profile,
        publish_at,
        platforms: [...i.config.platforms],
        score: c.score,
        reasons: [
          `Điểm nghiên cứu ${c.score}/100 (${KIND_TEXT[c.kind].toLowerCase()}).`,
          ...c.reasons,
          ...(tier === 'source'
            ? ['Trùng chủ đề trụ cột với video khác trong ngày — không còn ứng viên khác chủ đề.']
            : tier === 'any'
              ? ['Trùng nguồn với video khác trong ngày — không còn ứng viên khác nguồn.']
              : []),
          w.reason,
          publish_at
            ? `Giờ đăng ${publish_at}: khung giờ trống đầu tiên sau khi video làm xong (ước tính ${fmtMs(est)}/video, làm lần lượt).`
            : 'Kênh chưa đặt khung giờ đăng (publish.slots) nên chưa có giờ đăng.',
        ],
      });
    }
  }

  const plan: DailyPlan = {
    schema_version: 1,
    channel_id: i.channel_id as DailyPlan['channel_id'],
    date: i.date,
    generated_at: i.now.toISOString(),
    capacity: {
      videos: i.capacity.videos,
      limiting_factor: i.capacity.limiting_factor,
      reasons: i.capacity.reasons,
    },
    ...(notes.length ? { notes } : {}),
    items: [...existing, ...added],
  };
  return { plan, ...(previous ? { previous } : {}), carried };
}

// ---------- đọc / ghi file kế hoạch ----------

const readText = (f: string): string | undefined => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return undefined;
  }
};

/** Các ngày đã có kế hoạch (mới nhất trước). */
export function planDates(channelDir: string): string[] {
  const dir = path.join(channelDir, PLANS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((n) => DATE_FILE.exec(n)?.[1])
    .filter((d): d is string => Boolean(d))
    .sort()
    .reverse();
}

/** Kế hoạch của một ngày; chưa có / hỏng → `undefined`. */
export function readPlan(channelDir: string, date: string): DailyPlan | undefined {
  const text = readText(path.join(channelDir, PLANS_DIR, `${date}.json`));
  if (!text) return undefined;
  try {
    return JSON.parse(text) as DailyPlan;
  } catch {
    return undefined;
  }
}

const planRel = (date: string) => `${PLANS_DIR}/${date}.json`;

/** Kế hoạch các ngày khác từ `HISTORY_DAYS` ngày trước `date` trở đi. */
function readOthers(channelDir: string, date: string): DailyPlan[] {
  const from = addDays(date, -C.HISTORY_DAYS);
  return planDates(channelDir)
    .filter((d) => d >= from && d !== date)
    .flatMap((d) => readPlan(channelDir, d) ?? []);
}

const config = <T>(key: string, channelDir: string, appDataDir?: string): T =>
  resolveConfig<T>(key, { channelDir }, { appDataDir }).value;

const channelTimezone = (channelDir: string, appDataDir?: string) =>
  config<string>('publish.timezone', channelDir, appDataDir);

/** Số mục hôm nay đã bắt đầu làm (in_production / produced / failed): `done_today` của mô hình năng lực (050). */
export function autopilotDoneToday(channelDir: string, now: Date, appDataDir?: string): number {
  const date = researchDate(now, channelTimezone(channelDir, appDataDir));
  return (readPlan(channelDir, date)?.items ?? []).filter((x) => STARTED.has(x.status)).length;
}

const stable = (p: DailyPlan) => JSON.stringify({ ...p, generated_at: '' });

function writePlan(store: WriteStore, plan: DailyPlan, by: string): string {
  const rel = planRel(plan.date);
  store.write(rel, `${JSON.stringify(plan, null, 2)}\n`, { by });
  return rel;
}

// ---------- lập kế hoạch hôm nay cho nhiều kênh ----------

export interface PlanResult {
  channel: string;
  path: string;
  plan: DailyPlan;
  /** Số mục mới thêm lần này. */
  added: number;
  /** Số mục đã có và được giữ nguyên. */
  kept: number;
  /** Trong số mục mới: chuyển từ kế hoạch hôm qua. */
  carried: number;
}

export interface PlanTodayResult {
  /** `autopilot.paused` bật → không lập gì. */
  paused: boolean;
  plans: PlanResult[];
}

export interface PlanTodayOptions {
  /** Thư mục các kênh Autopilot. */
  channels: string[];
  now?: Date;
  storeFor: (channelDir: string) => WriteStore;
  /** Mô hình năng lực (050) cho cả nhóm kênh một lượt (chia vòng tròn tài nguyên). */
  capacity: (channels: CapacityChannel[]) => CapacityResult;
  installed: PlanWorkflow[];
  /** Quét nghiên cứu khi hôm nay chưa có file; mặc định `scanChannel` với `apiKey` / `fetch`. */
  scan?: (store: WriteStore, now: Date) => Promise<ResearchDoc>;
  apiKey?: string;
  fetch?: FetchFn;
  appDataDir?: string;
}

/**
 * Lập kế hoạch hôm nay cho mọi kênh Autopilot: dùng file nghiên cứu hôm nay nếu có (chưa có thì quét), một
 * lần tính năng lực, chọn chủ đề + workflow + giờ đăng, ghi `autopilot/plans/<ngày>.json`. Chạy lại trong
 * ngày giữ mọi mục đã có (idempotent). `autopilot.paused` → không làm gì.
 */
export async function planToday(o: PlanTodayOptions): Promise<PlanTodayResult> {
  const now = o.now ?? new Date();
  if (resolveAppConfig<boolean>('autopilot.paused', { appDataDir: o.appDataDir }) === true)
    return { paused: true, plans: [] };
  const scan =
    o.scan ??
    (async (store: WriteStore, at: Date) =>
      (
        await scanChannel(store, {
          ...(o.apiKey ? { apiKey: o.apiKey } : {}),
          ...(o.fetch ? { fetch: o.fetch } : {}),
          now: at,
          ...(o.appDataDir ? { appDataDir: o.appDataDir } : {}),
        })
      ).doc);

  const chans = o.channels.map((dir) => {
    const store = o.storeFor(dir);
    const channelDir = store.root;
    const cfg = <T>(k: string) => config<T>(k, channelDir, o.appDataDir);
    const meta = JSON.parse(readFileSync(store.abs('channel.json'), 'utf8')) as ChannelConfig;
    const timezone = cfg<string>('publish.timezone');
    const date = researchDate(now, timezone);
    const existing = readPlan(channelDir, date);
    const settings = {
      max_per_day: Number(cfg('autopilot.max_per_day')),
      workflows: cfg<string[]>('autopilot.workflows') ?? [],
      default_workflow: cfg<string>('workflow.default'),
      slots: cfg<string[]>('publish.slots') ?? [],
      platforms: cfg<string[]>('publish.platforms') ?? [],
      min_score: Number(cfg('autopilot.min_score')),
    };
    return { dir, store, channelDir, meta, timezone, date, existing, settings };
  });

  // nghiên cứu: dùng file hôm nay nếu có, chưa có thì quét (lỗi quét → lập từ nghiên cứu rỗng + ghi chú)
  const research = new Map<string, { doc?: ResearchDoc; error?: string }>();
  for (const c of chans) {
    const have = readResearch(c.channelDir, c.date);
    if (have) {
      research.set(c.dir, { doc: have });
      continue;
    }
    try {
      research.set(c.dir, { doc: await scan(c.store, now) });
    } catch (e) {
      research.set(c.dir, { error: String((e as Error)?.message ?? e) });
    }
  }

  const cap = o.capacity(
    chans.map((c) => ({
      channel: c.dir,
      name: c.meta.name,
      workflows: c.settings.workflows,
      max_per_day: c.settings.max_per_day,
      // trần chỉ đếm video Autopilot đã bắt đầu: kế hoạch ngày là nguồn sự thật (quyết định 050/051)
      done_today: (c.existing?.items ?? []).filter((x) => STARTED.has(x.status)).length,
      platforms: c.settings.platforms,
    })),
  );
  const est_ms = Object.fromEntries(cap.by_workflow.map((w) => [w.workflow_id, w.est_ms]));

  const plans: PlanResult[] = [];
  for (const c of chans) {
    const mine = cap.channels.find((x) => x.channel === c.dir);
    const r = research.get(c.dir)!;
    const day = planDay({
      channel_id: c.meta.id,
      date: c.date,
      now,
      timezone: c.timezone,
      ...(c.existing ? { existing: c.existing } : {}),
      others: readOthers(c.channelDir, c.date),
      research: r.doc,
      capacity: {
        videos: mine?.videos ?? 0,
        limiting_factor: mine?.limiting_factor ?? cap.limiting_factor,
        reasons: cap.reasons,
        est_ms,
      },
      config: c.settings,
      installed: o.installed,
    });
    const plan = day.plan;
    if (r.error) plan.notes = [`Quét nghiên cứu lỗi: ${r.error}`, ...(plan.notes ?? [])];
    // chỉ ghi khi có gì đổi (bỏ qua `generated_at`) để chạy lại không làm nhiễu file
    const changed = !c.existing || stable(c.existing) !== stable(plan);
    if (changed) writePlan(c.store, plan, 'autopilot.plan');
    // mục chuyển sang hôm nay: đóng mục cũ ở kế hoạch hôm qua (ghi sau — lần dở dang tự lành ở lần chạy sau)
    if (day.previous) writePlan(c.store, day.previous, 'autopilot.plan');
    const kept = c.existing?.items.length ?? 0;
    plans.push({
      channel: c.dir,
      path: planRel(c.date),
      plan: changed ? plan : c.existing!,
      added: plan.items.length - kept,
      kept,
      carried: day.carried,
    });
  }
  return { paused: false, plans };
}

// ---------- sửa kế hoạch ----------

export interface PlanPatch {
  status?: 'skipped' | 'planned';
  title?: string;
  angle?: string;
  workflow_id?: string;
  /** ISO 8601 có offset, hoặc `null` để bỏ giờ đăng. */
  publish_at?: string | null;
}

const PATCH_KEYS = ['status', 'title', 'angle', 'workflow_id', 'publish_at'];
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const invalid = (why: string) => new SfError('E_SCHEMA_INVALID', why);

/**
 * Người dùng/agent sửa một mục kế hoạch (FR-AP-06): bỏ qua ↔ khôi phục, đổi tiêu đề, góc nhìn, workflow
 * (phải thuộc danh sách cho phép; dạng xuất lấy mặc định của workflow mới), giờ đăng. Không sửa mục đã/đang làm.
 */
export function updatePlanItem(
  store: WriteStore,
  o: {
    date: string;
    item_id: string;
    patch: PlanPatch;
    installed: PlanWorkflow[];
    appDataDir?: string;
    now?: Date;
  },
): PlanItem {
  const plan = readPlan(store.root, o.date);
  if (!plan) throw new SfError('E_FILE_NOT_FOUND', `no plan for ${o.date}; run autopilot plan`);
  const idx = plan.items.findIndex((x) => x.id === o.item_id);
  if (idx < 0) throw new SfError('E_ID_UNKNOWN', `plan item ${o.item_id} not found in ${o.date}`);
  const cur = plan.items[idx]!;
  const patch = o.patch as Record<string, unknown>;
  const keys = Object.keys(patch);
  if (!keys.length) throw invalid('patch is empty');
  const unknown = keys.filter((k) => !PATCH_KEYS.includes(k));
  if (unknown.length) throw invalid(`unknown patch field: ${unknown.join(', ')}`);
  if (LOCKED.has(cur.status))
    throw invalid(`item ${cur.id} is ${cur.status}; only planned or skipped items can be edited`);

  const next: PlanItem = { ...cur };
  const text = (k: 'title' | 'angle') => {
    const v = patch[k];
    if (typeof v !== 'string' || !v.trim()) throw invalid(`${k} must be a non-empty string`);
    next[k] = v.trim();
  };
  if ('title' in patch) text('title');
  if ('angle' in patch) text('angle');
  if ('workflow_id' in patch) {
    const id = patch.workflow_id;
    const allowed = allowedWorkflows(
      config<string[]>('autopilot.workflows', store.root, o.appDataDir) ?? [],
      o.installed,
    );
    const w = allowed.find((x) => x.id === id);
    if (!w)
      throw invalid(
        `workflow ${String(id)} is not allowed for this channel (${allowed.map((x) => x.id).join(', ') || 'none'})`,
      );
    next.workflow_id = w.id;
    next.output_profile = w.output_profiles[0] ?? next.output_profile;
  }
  if ('publish_at' in patch) {
    const v = patch.publish_at;
    if (v === null) next.publish_at = null;
    else if (typeof v === 'string' && ISO_OFFSET.test(v) && !Number.isNaN(Date.parse(v)))
      next.publish_at = v;
    else
      throw invalid(
        'publish_at must be an ISO 8601 time with offset (2026-10-08T19:00:00+07:00) or null',
      );
  }
  if ('status' in patch) {
    const v = patch.status;
    if (v !== 'skipped' && v !== 'planned') throw invalid('status must be skipped or planned');
    if (v === 'planned' && cur.status === 'skipped') {
      const max = Number(config('autopilot.max_per_day', store.root, o.appDataDir));
      const active = plan.items.filter((x) => x.status !== 'skipped').length;
      if (active >= max)
        throw invalid(
          `cannot restore: ${active}/${max} videos already planned for ${o.date} (autopilot.max_per_day)`,
        );
    }
    next.status = v;
  }
  plan.items[idx] = next;
  plan.generated_at = (o.now ?? new Date()).toISOString();
  writePlan(store, plan, 'autopilot.plan_update');
  return next;
}
