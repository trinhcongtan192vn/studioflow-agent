import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAppConfig, resolveConfig } from '../config/resolve.js';
import type { ChannelLearning, LearningGroup, ResearchCandidate } from '../contracts/types.js';
import { videoSeries } from '../analytics/metrics-db.js';
import { median } from '../research/score.js';
import { readResearch } from '../research/scan.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';
import { planDates, readPlan, zoneParts } from './plan.js';

/**
 * Vòng phản hồi (057, FR-AP-13): học từ hiệu quả thật của video đã đăng để điều chỉnh **thứ hạng** chủ đề ở bước chọn
 * (051). Xác định (cùng dữ liệu → cùng kết quả), có chặn và co về 1 khi ít mẫu; không đủ dữ liệu thì không ảnh hưởng.
 * Luật chi tiết: tech-defaults "Học từ hiệu quả (FN-057)", D3 5.21.
 */
export const LEARNING_CONSTANTS = {
  /** Chỉ dùng video đã đăng ít nhất ngần này ngày. */
  MIN_AGE_DAYS: 3,
  /** Hiệu quả = lượt xem trung bình mỗi ngày trong ngần này ngày đầu. */
  WINDOW_DAYS: 7,
  /** Số video đủ tuổi tối thiểu để bắt đầu học. */
  MIN_VIDEOS: 5,
  /** Số video tối thiểu mỗi nhóm để có hệ số. */
  MIN_GROUP: 2,
  /** Hằng co về 1: hệ số = 1 + hiệu · n/(n+K). */
  SHRINK_K: 5,
  /** Hiệu chỉnh tối đa ±30%. */
  BOUND: 0.3,
  /** Chỉ xét kế hoạch ngần này ngày gần nhất. */
  LOOKBACK_DAYS: 60,
  /** Chênh lệch nhỏ hơn mức này không đáng nêu lý do. */
  MIN_REASON: 0.02,
} as const;
const C = LEARNING_CONSTANTS;
const PLATFORM = 'youtube';
const DAY_MS = 86_400_000;
export const LEARNING_REL = 'autopilot/learning.json';

export type Dimension = keyof ChannelLearning['dimensions'];

/** Một video đã đủ tuổi và hiệu quả của nó. */
export interface LearnSample {
  kind: string;
  pillar?: string;
  source?: { id: string; title: string };
  workflow: string;
  slot?: string;
  /** Lượt xem trung bình mỗi ngày trong 7 ngày đầu. */
  perf: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Hệ số của nhóm: 1 + clamp(ratio − 1, ±0,3) · n/(n+K) ∈ [0,7; 1,3]. */
export function multiplierOf(ratio: number, n: number): number {
  const w = n / (n + C.SHRINK_K);
  return r3(1 + clamp(ratio - 1, -C.BOUND, C.BOUND) * w);
}

function groups(
  samples: LearnSample[],
  baseline: number,
  key: (s: LearnSample) => { key: string; label?: string } | undefined,
): LearningGroup[] {
  const by = new Map<string, { label?: string; perf: number[] }>();
  for (const s of samples) {
    const k = key(s);
    if (!k) continue;
    const g = by.get(k.key) ?? { ...(k.label ? { label: k.label } : {}), perf: [] };
    g.perf.push(s.perf);
    by.set(k.key, g);
  }
  return [...by.entries()]
    .filter(([, g]) => g.perf.length >= C.MIN_GROUP)
    .map(([k, g]) => {
      const ratio = baseline > 0 ? median(g.perf) / baseline : 1;
      return {
        key: k,
        ...(g.label ? { label: g.label } : {}),
        n: g.perf.length,
        ratio: r3(ratio),
        multiplier: multiplierOf(ratio, g.perf.length),
      };
    })
    .sort((a, b) => b.multiplier - a.multiplier || a.key.localeCompare(b.key));
}

/** Tính điều chỉnh từ các mẫu (hàm thuần). */
export function learnFromSamples(o: {
  channel_id: string;
  now: Date;
  samples: LearnSample[];
}): ChannelLearning {
  const { samples } = o;
  const base = {
    schema_version: 1 as const,
    channel_id: o.channel_id as ChannelLearning['channel_id'],
    generated_at: o.now.toISOString(),
    videos: samples.length,
  };
  const empty = { kind: [], pillar: [], source: [], workflow: [], slot: [] };
  if (samples.length < C.MIN_VIDEOS)
    return {
      ...base,
      enough_data: false,
      baseline_daily_views: 0,
      dimensions: empty,
      notes: [
        `Mới có ${samples.length} video đủ ${C.MIN_AGE_DAYS} ngày tuổi có số liệu (cần ≥ ${C.MIN_VIDEOS}) nên chưa điều chỉnh điểm chủ đề.`,
      ],
    };
  const baseline = median(samples.map((s) => s.perf));
  return {
    ...base,
    enough_data: true,
    baseline_daily_views: Math.round(baseline * 10) / 10,
    dimensions: {
      kind: groups(samples, baseline, (s) => ({ key: s.kind })),
      pillar: groups(samples, baseline, (s) => (s.pillar ? { key: s.pillar } : undefined)),
      source: groups(samples, baseline, (s) =>
        s.source ? { key: s.source.id, label: s.source.title } : undefined,
      ),
      workflow: groups(samples, baseline, (s) => ({ key: s.workflow })),
      slot: groups(samples, baseline, (s) => (s.slot ? { key: s.slot } : undefined)),
    },
    notes:
      baseline > 0
        ? []
        : ['Các video đủ tuổi chưa có lượt xem nên chưa phân biệt được nhóm nào hơn.'],
  };
}

// ---------- áp dụng khi chọn chủ đề ----------

const KIND_LABEL: Record<ResearchCandidate['kind'], string> = {
  competitor: 'đối thủ vừa đăng',
  competitor_evergreen: 'video nổi bật cũ của đối thủ',
  trending: 'đang trending',
  trend: 'đang được tìm nhiều',
  news: 'tin nóng',
};

export interface LearnedPart {
  dim: 'kind' | 'pillar' | 'source';
  key: string;
  ratio: number;
  multiplier: number;
  n: number;
  /** Câu lý do tiếng Việt. */
  reason: string;
}
export interface CandidateAdjust {
  multiplier: number;
  parts: LearnedPart[];
}

const pctText = (ratio: number): string => {
  const p = Math.round(Math.abs(ratio - 1) * 100);
  return ratio >= 1 ? `hiệu quả hơn trung bình ${p}%` : `kém hơn trung bình ${p}%`;
};
const mulText = (m: number) => `×${m.toFixed(2).replace('.', ',')}`;

/** Hệ số và lý do của một ứng viên: tích hệ số `kind`, `pillar`, `source`, kẹp [0,7; 1,3]. */
export function adjustCandidate(
  c: ResearchCandidate,
  l: ChannelLearning | undefined,
): CandidateAdjust {
  if (!l?.enough_data) return { multiplier: 1, parts: [] };
  const find = (dim: Dimension, key: string | undefined) =>
    key === undefined ? undefined : l.dimensions[dim].find((g) => g.key === key);
  const parts: LearnedPart[] = [];
  const add = (dim: LearnedPart['dim'], g: LearningGroup | undefined, subject: string) => {
    if (!g) return;
    parts.push({
      dim,
      key: g.key,
      ratio: g.ratio,
      multiplier: g.multiplier,
      n: g.n,
      reason: `${subject} của kênh đang ${pctText(g.ratio)} (${g.n} video) → ${
        g.multiplier >= 1 ? 'ưu tiên cao hơn' : 'ưu tiên thấp hơn'
      } (${mulText(g.multiplier)}).`,
    });
  };
  add('kind', find('kind', c.kind), `Chủ đề dạng "${KIND_LABEL[c.kind]}"`);
  add('pillar', find('pillar', c.pillar), `Trụ cột "${c.pillar}"`);
  add('source', find('source', c.source_channel?.id), `Đối thủ "${c.source_channel?.title ?? ''}"`);
  const product = parts.reduce((m, p) => m * p.multiplier, 1);
  const multiplier = r3(clamp(product, 1 - C.BOUND, 1 + C.BOUND));
  return {
    multiplier,
    parts: parts.filter((p) => Math.abs(p.multiplier - 1) >= C.MIN_REASON),
  };
}

/** Thứ hạng đã điều chỉnh (điểm × hệ số, không kẹp 100 để giữ thứ tự) và lý do theo ID ứng viên. */
export function rankWithLearning(
  candidates: ResearchCandidate[],
  l: ChannelLearning | undefined,
): { rank: Map<string, number>; reasons: Map<string, string[]> } {
  const rank = new Map<string, number>();
  const reasons = new Map<string, string[]>();
  if (!l?.enough_data) return { rank, reasons };
  for (const c of candidates) {
    const a = adjustCandidate(c, l);
    if (a.multiplier === 1 && !a.parts.length) continue;
    rank.set(c.id, c.score * a.multiplier);
    if (a.parts.length)
      reasons.set(
        c.id,
        a.parts.map((p) => p.reason),
      );
  }
  return { rank, reasons };
}

// ---------- thu mẫu từ kế hoạch + số liệu ----------

export interface LearningServiceDeps {
  db: Db;
  appDataDir: string;
  storeFor: (channelDir: string) => WriteStore;
  clock?: () => Date;
}

const stable = (l: ChannelLearning) => JSON.stringify({ ...l, generated_at: '' });
const addDays = (date: string, n: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export class LearningService {
  constructor(private readonly d: LearningServiceDeps) {}

  private now(): Date {
    return this.d.clock?.() ?? new Date();
  }

  enabled(channel: string): boolean {
    return (
      resolveConfig<boolean>(
        'autopilot.learning',
        { channelDir: channel },
        { appDataDir: this.d.appDataDir },
      ).value !== false &&
      resolveAppConfig<boolean>('autopilot.learning', { appDataDir: this.d.appDataDir }) !== false
    );
  }

  /** Mẫu từ các kế hoạch gần đây: video đã đăng, đủ tuổi, có số liệu. */
  samples(channel: string, now: Date = this.now()): LearnSample[] {
    const meta = JSON.parse(readFileSync(path.join(channel, 'channel.json'), 'utf8')) as {
      id: string;
    };
    const tz = resolveConfig<string>(
      'publish.timezone',
      { channelDir: channel },
      { appDataDir: this.d.appDataDir },
    ).value;
    const p = zoneParts(now.getTime(), tz);
    const z = (n: number) => String(n).padStart(2, '0');
    const today = `${p.y}-${z(p.mo)}-${z(p.d)}`;
    const oldest = addDays(today, -C.LOOKBACK_DAYS);
    const out: LearnSample[] = [];
    const seen = new Set<string>();
    for (const date of planDates(channel)) {
      if (date < oldest) continue;
      const research = readResearch(channel, date);
      for (const it of readPlan(channel, date)?.items ?? []) {
        const vid = it.publish?.youtube?.video_id;
        if (!vid || seen.has(vid)) continue;
        seen.add(vid);
        const rows = videoSeries(this.d.db, meta.id, PLATFORM, vid);
        // ngày bắt đầu có lượt xem = ngày công khai thật (video riêng tư chưa công khai chưa có lượt xem)
        const first = rows.find((r) => r.views > 0);
        if (!first) continue;
        if (
          Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first.day}T00:00:00Z`) <
          C.MIN_AGE_DAYS * DAY_MS
        )
          continue;
        const end = addDays(first.day, C.WINDOW_DAYS - 1);
        const win = rows.filter((r) => r.day >= first.day && r.day <= end);
        const last = win.at(-1)!.day;
        const span =
          (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first.day}T00:00:00Z`)) / DAY_MS + 1;
        const cand = research?.candidates.find((c) => c.id === it.candidate_id);
        const pillar = cand?.pillar;
        out.push({
          kind: it.source.kind,
          ...(pillar ? { pillar } : {}),
          ...(it.source.source_channel
            ? { source: { id: it.source.source_channel.id, title: it.source.source_channel.title } }
            : {}),
          workflow: it.workflow_id,
          ...(it.publish_at ? { slot: it.publish_at.slice(11, 16) } : {}),
          perf: win.reduce((s, r) => s + r.views, 0) / span,
        });
      }
    }
    return out;
  }

  compute(channel: string, now: Date = this.now()): ChannelLearning {
    const id = (
      JSON.parse(readFileSync(path.join(channel, 'channel.json'), 'utf8')) as { id: string }
    ).id;
    return learnFromSamples({ channel_id: id, now, samples: this.samples(channel, now) });
  }

  read(channel: string): ChannelLearning | undefined {
    try {
      const f = path.join(channel, LEARNING_REL);
      return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as ChannelLearning) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Tính lại và ghi `autopilot/learning.json` chỉ khi nội dung đổi (bỏ qua `generated_at`). */
  refresh(channel: string): ChannelLearning {
    const next = this.compute(channel);
    const prev = this.read(channel);
    if (!prev || stable(prev) !== stable(next))
      this.d
        .storeFor(channel)
        .write(LEARNING_REL, `${JSON.stringify(next, null, 2)}\n`, { by: 'learning' });
    return prev && stable(prev) === stable(next) ? prev : next;
  }

  /** Cho tool/IPC: file nếu có, không thì tính ngay (không ghi). */
  get(channel: string): ChannelLearning {
    return this.read(channel) ?? this.compute(channel);
  }
}
