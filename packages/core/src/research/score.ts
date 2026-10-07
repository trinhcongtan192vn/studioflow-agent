import type { ResearchCandidate } from '../contracts/types.js';
import { sha256 } from '../domain/hash.js';
import type { VideoStats } from '../youtube/data-api.js';
import type { RssItem } from './rss.js';

/**
 * Chấm điểm chủ đề ứng viên của quét nghiên cứu (049, FR-AP-04) — hàm thuần. Công thức và lý do chọn
 * hằng số: FN-049 (`docs/feature-notes/049-research.md`); chưa là khóa cấu hình vì chưa có số liệu thật.
 */
export const RESEARCH_CONSTANTS = {
  /** Video đối thủ ≤ ngần này ngày → ứng viên "mới". */
  RECENT_DAYS: 14,
  /** Video đối thủ ≥ ngần này ngày và ≥ EVERGREEN_MIN_RATIO × trung vị → "nổi bật cũ". */
  EVERGREEN_MIN_DAYS: 30,
  EVERGREEN_MIN_RATIO: 2,
  /** Video trẻ hơn ngần này giờ: lượt xem còn tăng → so với trung vị × tuổi/MATURE_HOURS. */
  MATURE_HOURS: 168,
  MIN_AGE_FACTOR: 0.1,
  /** Cần ít nhất ngần này video "trưởng thành" để lấy trung vị trên riêng nhóm đó. */
  MIN_MATURE_FOR_MEDIAN: 3,
  W_PERF: 40,
  W_RECENCY: 20,
  W_PILLAR: 30,
  W_NOVELTY: 10,
  RECENCY_SPAN_DAYS: 30,
  NEWS_PERF: 15,
  NEWS_MAX_AGE_DAYS: 7,
  PILLAR_MATCH_MIN: 0.5,
  DUP_SIMILARITY: 0.6,
  DUP_PENALTY: 30,
  MAX_CANDIDATES: 50,
} as const;

const C = RESEARCH_CONSTANTS;

export interface ScoreContext {
  now: Date;
  pillars: string[];
  /** Tiêu đề video đã làm của kênh (so trùng). */
  ownTitles: string[];
}

// ---------- so khớp chữ ----------

/** Từ dừng ngắn (đã gập dấu) vi/de/en — chỉ những từ gần như không mang nghĩa chủ đề. */
const STOPWORDS = new Set(
  // vi
  (
    'va cua la co cac nhung mot cho voi trong ve nay do thi de khi da duoc nhu tu tai ra vao se cung bi ' +
    'gi nao hay hon rat ma nen neu vi khong chi con den len xuong ' +
    // de
    'der die das und ist ein eine einen zu von mit den dem des im in auf fur nicht sich es wie was warum ' +
    'auch am an als bei oder aus um so wir ihr sie er ich du uber ' +
    // en
    'the an and of to in on for is are was with how what why this that you your from at by be it as or ' +
    'its into about'
  ).split(/\s+/),
);

/** Gập dấu: bỏ dấu kết hợp, đ→d, ß→ss, chữ thường. */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

/** Từ (duy nhất, giữ thứ tự) sau khi gập dấu; bỏ từ dừng và từ 1 ký tự. */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const t of foldText(s).split(/[^\p{L}\p{N}]+/u))
    if (t.length > 1 && !STOPWORDS.has(t) && !out.includes(t)) out.push(t);
  return out;
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0;
  const B = new Set(b);
  const inter = a.filter((t) => B.has(t)).length;
  return inter / new Set([...a, ...b]).size;
}

/** Chủ đề trụ cột khớp nhất: tỉ lệ từ của chủ đề có trong văn bản; không chủ đề nào có từ khớp → undefined. */
export function bestPillar(
  text: string,
  pillars: string[],
): { pillar: string; ratio: number; hit: number; total: number } | undefined {
  const words = new Set(tokenize(text));
  let best: { pillar: string; ratio: number; hit: number; total: number } | undefined;
  for (const pillar of pillars) {
    const pt = tokenize(pillar);
    if (!pt.length) continue;
    const hit = pt.filter((t) => words.has(t)).length;
    const ratio = hit / pt.length;
    if (hit && (!best || ratio > best.ratio)) best = { pillar, ratio, hit, total: pt.length };
  }
  return best;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ---------- định dạng lý do (tiếng Việt) ----------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const fmt = (n: number, digits = 0) => n.toLocaleString('vi-VN', { maximumFractionDigits: digits });
const r2 = (x: number) => Math.round(x * 100) / 100;

function ago(hours: number): string {
  if (hours < 1) return 'vừa đăng';
  if (hours < 48) return `đăng ${Math.round(hours)} giờ trước`;
  return `đăng ${Math.round(hours / 24)} ngày trước`;
}

const ageHours = (iso: string | undefined, now: Date) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? undefined : Math.max(0, (now.getTime() - t) / 3600_000);
};

// ---------- các phần điểm ----------

interface Part {
  points: number;
  reason: string;
}

function recency(age: number | undefined, evergreen = false): Part {
  if (evergreen)
    return { points: C.W_RECENCY / 2, reason: 'Chủ đề bền: video cũ vẫn được xem nhiều' };
  if (age === undefined) return { points: C.W_RECENCY / 2, reason: 'Không rõ ngày đăng' };
  const points = C.W_RECENCY * clamp01(1 - age / (C.RECENCY_SPAN_DAYS * 24));
  return { points, reason: `Mới: ${ago(age)}` };
}

/** Khớp chủ đề trụ cột; `floor` cho tin tìm theo đúng chủ đề đó. */
function pillarPart(
  text: string,
  ctx: ScoreContext,
  floor?: string,
): { part: Part; pillar?: string; matched: boolean } {
  if (!ctx.pillars.length)
    return { part: { points: 0, reason: 'Kênh chưa khai chủ đề trụ cột' }, matched: true };
  let m = bestPillar(text, ctx.pillars);
  if (floor && (!m || m.ratio < C.PILLAR_MATCH_MIN))
    m = { pillar: floor, ratio: C.PILLAR_MATCH_MIN, hit: 0, total: 0 };
  if (!m || m.ratio < C.PILLAR_MATCH_MIN)
    return { part: { points: 0, reason: 'Không khớp rõ chủ đề trụ cột nào' }, matched: false };
  const how = m.total ? ` (${m.hit}/${m.total} từ)` : ' (tìm theo chủ đề này)';
  return {
    part: { points: C.W_PILLAR * m.ratio, reason: `Khớp chủ đề trụ cột "${m.pillar}"${how}` },
    pillar: m.pillar,
    matched: true,
  };
}

/** Độ mới so với video đã làm; gần trùng → trừ điểm. */
function noveltyPart(title: string, ctx: ScoreContext): { part: Part; similarity?: number } {
  if (!ctx.ownTitles.length)
    return {
      part: { points: C.W_NOVELTY, reason: 'Kênh chưa có video nào để so trùng' },
    };
  const t = tokenize(title);
  let best = 0;
  let bestTitle = '';
  for (const own of ctx.ownTitles) {
    const s = jaccard(t, tokenize(own));
    if (s > best) [best, bestTitle] = [s, own];
  }
  const similarity = r2(best);
  if (best >= C.DUP_SIMILARITY)
    return {
      part: {
        points: -C.DUP_PENALTY,
        reason: `Gần trùng video đã làm "${bestTitle}" (độ giống ${fmt(similarity, 2)}) — bị trừ điểm`,
      },
      similarity,
    };
  return {
    part: {
      points: C.W_NOVELTY * clamp01(1 - best / C.DUP_SIMILARITY),
      reason: `Kênh chưa làm chủ đề này (giống nhất ${fmt(similarity, 2)})`,
    },
    similarity,
  };
}

/** Hiệu quả từ tỉ lệ vượt trội: 0,5× → 0, 8× → đủ điểm. */
const perfRatio = (r: number) => C.W_PERF * clamp01((Math.log2(Math.max(r, 1e-9)) + 1) / 4);
/** Hiệu quả từ tốc độ: 100/giờ → 0, 100 000/giờ → đủ điểm. */
const perfVelocity = (v: number) => C.W_PERF * clamp01((Math.log10(Math.max(v, 1)) - 2) / 3);
/** Hiệu quả từ lượt tìm: 1 000 → 0, 1 000 000 → đủ điểm. */
const perfTraffic = (t: number) => C.W_PERF * clamp01((Math.log10(Math.max(t, 1)) - 3) / 3);

const total = (parts: Part[]) =>
  Math.min(100, Math.max(0, Math.round(parts.reduce((s, p) => s + p.points, 0))));

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

function videoBase(v: VideoStats, age: number | undefined) {
  return {
    id: `yt:${v.video_id}`,
    title: v.title,
    url: watchUrl(v.video_id),
    source_channel: { id: v.channel_id, title: v.channel_title },
    ...(v.published_at ? { published_at: v.published_at } : {}),
    metrics: {
      views: v.views,
      ...(v.likes === undefined ? {} : { likes: v.likes }),
      ...(v.comments === undefined ? {} : { comments: v.comments }),
      ...(v.duration_s === undefined ? {} : { duration_s: v.duration_s }),
      ...(age === undefined ? {} : { age_hours: Math.round(age) }),
    },
  };
}

// ---------- ứng viên theo nguồn ----------

/** Video của MỘT kênh đối thủ: mới (≤ 14 ngày) + nổi bật cũ (≥ 30 ngày, ≥ 2× trung vị). */
export function competitorCandidates(videos: VideoStats[], ctx: ScoreContext): ResearchCandidate[] {
  const aged = videos.map((v) => ({ v, age: ageHours(v.published_at, ctx.now) }));
  const mature = aged.filter((x) => (x.age ?? 0) >= C.MATURE_HOURS).map((x) => x.v.views);
  const med = median(
    mature.length >= C.MIN_MATURE_FOR_MEDIAN ? mature : videos.map((v) => v.views),
  );
  const out: ResearchCandidate[] = [];
  for (const { v, age } of aged) {
    if (age === undefined) continue;
    const recent = age <= C.RECENT_DAYS * 24;
    const old = age >= C.EVERGREEN_MIN_DAYS * 24;
    if (!recent && !old) continue;
    const expected = med * Math.max(C.MIN_AGE_FACTOR, Math.min(1, age / C.MATURE_HOURS));
    const ratio = expected > 0 ? v.views / expected : 0;
    if (!recent && ratio < C.EVERGREEN_MIN_RATIO) continue;
    const name = v.channel_title || v.channel_id;
    const perf: Part = {
      points: perfRatio(ratio),
      reason: recent
        ? `Gấp ${fmt(ratio, 1)}× lượt xem trung vị của kênh đối thủ "${name}" (${fmt(v.views)} lượt xem)`
        : `Video cũ nổi bật (${ago(age)}): gấp ${fmt(ratio, 1)}× lượt xem trung vị của kênh đối thủ "${name}"`,
    };
    const pil = pillarPart(`${v.title} ${v.tags.join(' ')}`, ctx);
    const nov = noveltyPart(v.title, ctx);
    const parts = [perf, recency(age, !recent), pil.part, nov.part];
    const base = videoBase(v, age);
    out.push({
      ...base,
      kind: recent ? 'competitor' : 'competitor_evergreen',
      ...(pil.pillar ? { pillar: pil.pillar } : {}),
      metrics: {
        ...base.metrics,
        outlier_ratio: r2(ratio),
        ...(nov.similarity === undefined ? {} : { similarity: nov.similarity }),
      },
      score: total(parts),
      reasons: parts.map((p) => p.reason),
    });
  }
  return out;
}

/** Video trending của vùng — chỉ giữ khi khớp chủ đề trụ cột (hoặc kênh chưa khai chủ đề). */
export function trendingCandidates(
  videos: VideoStats[],
  region: string,
  ctx: ScoreContext,
): ResearchCandidate[] {
  const out: ResearchCandidate[] = [];
  for (const v of videos) {
    const pil = pillarPart(`${v.title} ${v.tags.join(' ')}`, ctx);
    if (!pil.matched) continue;
    const age = ageHours(v.published_at, ctx.now);
    const vph = Math.round(v.views / Math.max(1, age ?? 1));
    const nov = noveltyPart(v.title, ctx);
    const parts = [
      { points: perfVelocity(vph), reason: `Đang trending ở ${region}: ${fmt(vph)} lượt xem/giờ` },
      recency(age),
      pil.part,
      nov.part,
    ];
    const base = videoBase(v, age);
    out.push({
      ...base,
      kind: 'trending',
      ...(pil.pillar ? { pillar: pil.pillar } : {}),
      metrics: {
        ...base.metrics,
        views_per_hour: vph,
        ...(nov.similarity === undefined ? {} : { similarity: nov.similarity }),
      },
      score: total(parts),
      reasons: parts.map((p) => p.reason),
    });
  }
  return out;
}

/** Từ khóa Google Trends trong ngày — tiêu đề tin kèm theo cũng tính khi so chủ đề trụ cột. */
export function trendCandidates(
  items: RssItem[],
  geo: string,
  ctx: ScoreContext,
): ResearchCandidate[] {
  const out: ResearchCandidate[] = [];
  for (const it of items) {
    const pil = pillarPart(`${it.title} ${it.news.map((n) => n.title).join(' ')}`, ctx);
    if (!pil.matched) continue;
    const age = ageHours(it.published_at, ctx.now);
    const nov = noveltyPart(it.title, ctx);
    const traffic = it.traffic;
    const parts = [
      traffic === undefined
        ? { points: C.NEWS_PERF, reason: `Đang được tìm nhiều trên Google Trends ${geo}` }
        : {
            points: perfTraffic(traffic),
            reason: `Google Trends ${geo}: ~${fmt(traffic)}+ lượt tìm`,
          },
      recency(age),
      pil.part,
      nov.part,
    ];
    const url = it.news[0]?.url;
    out.push({
      id: `trend:${tokenize(it.title).join(' ') || foldText(it.title)}`,
      kind: 'trend',
      title: it.title,
      ...(url ? { url } : {}),
      ...(it.published_at ? { published_at: it.published_at } : {}),
      ...(pil.pillar ? { pillar: pil.pillar } : {}),
      metrics: {
        ...(traffic === undefined ? {} : { traffic }),
        ...(age === undefined ? {} : { age_hours: Math.round(age) }),
        ...(nov.similarity === undefined ? {} : { similarity: nov.similarity }),
      },
      score: total(parts),
      reasons: parts.map((p) => p.reason),
    });
  }
  return out;
}

/** Tin Google News tìm theo một chủ đề trụ cột; chỉ tin ≤ 7 ngày. */
export function newsCandidates(
  items: RssItem[],
  pillar: string,
  ctx: ScoreContext,
): ResearchCandidate[] {
  const out: ResearchCandidate[] = [];
  for (const it of items) {
    const age = ageHours(it.published_at, ctx.now);
    if (age === undefined || age > C.NEWS_MAX_AGE_DAYS * 24) continue;
    const pil = pillarPart(it.title, ctx, pillar);
    const nov = noveltyPart(it.title, ctx);
    const parts = [
      {
        points: C.NEWS_PERF,
        reason: `Tin nóng trên Google News${it.source ? ` (${it.source})` : ''}`,
      },
      recency(age),
      pil.part,
      nov.part,
    ];
    out.push({
      id: `news:${sha256(it.link ?? it.title).slice(0, 12)}`,
      kind: 'news',
      title: it.title,
      ...(it.link ? { url: it.link } : {}),
      ...(it.published_at ? { published_at: it.published_at } : {}),
      ...(pil.pillar ? { pillar: pil.pillar } : {}),
      metrics: {
        age_hours: Math.round(age),
        ...(nov.similarity === undefined ? {} : { similarity: nov.similarity }),
      },
      score: total(parts),
      reasons: parts.map((p) => p.reason),
    });
  }
  return out;
}

/** Bỏ trùng ID (giữ điểm cao hơn), xếp điểm cao trước, giữ tối đa `max`. */
export function rankCandidates(
  list: ResearchCandidate[],
  max: number = C.MAX_CANDIDATES,
): ResearchCandidate[] {
  const best = new Map<string, ResearchCandidate>();
  for (const c of list) {
    const prev = best.get(c.id);
    if (!prev || c.score > prev.score) best.set(c.id, c);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, max);
}
