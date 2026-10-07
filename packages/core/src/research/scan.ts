import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfig } from '../config/resolve.js';
import type { ChannelConfig, ResearchCandidate, ResearchDoc } from '../contracts/types.js';
import { splitFrontMatter } from '../domain/markdown/frontmatter.js';
import { isSfError, SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';
import {
  channelUploads,
  playlistVideoIds,
  regionForLanguage,
  trendingVideos,
  videoStats,
  type FetchFn,
  type Quota,
} from '../youtube/data-api.js';
import { parseRss } from './rss.js';
import {
  competitorCandidates,
  newsCandidates,
  rankCandidates,
  trendCandidates,
  trendingCandidates,
  type ScoreContext,
} from './score.js';

/**
 * Quét nghiên cứu một kênh (049, FR-AP-04; D4 9.5): đối thủ, video đã làm, trending, Google Trends,
 * Google News → `research/<YYYY-MM-DD>.json` (D3 5.17) qua module ghi. Mỗi nguồn độc lập: lỗi được ghi
 * vào `sources`, lần quét vẫn xong.
 */
export interface ScanOptions {
  /** Khóa YouTube Data API v3; thiếu → bỏ đối thủ + trending (ghi lỗi), RSS vẫn chạy. */
  apiKey?: string;
  fetch?: FetchFn;
  now?: Date;
  appDataDir?: string;
}

export interface ScanResult {
  path: string;
  doc: ResearchDoc;
}

/** Số video mới nhất đọc của mỗi đối thủ (2 trang playlistItems). */
const UPLOADS_MAX = 100;
const NEWS_MAX_PILLARS = 5;
const NEWS_PER_PILLAR = 10;
const RESEARCH_DIR = 'research';
const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

/** Ngày YYYY-MM-DD theo múi giờ (dùng `publish.timezone` như lịch đăng). */
export function researchDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const readText = (f: string): string | undefined => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return undefined;
  }
};

/** Tiêu đề video đã làm của kênh: `publish.md` (`title`) + `BRIEF.md` (`title_working`). */
export function ownVideoTitles(channelDir: string): { videos: number; titles: string[] } {
  const root = path.join(channelDir, 'videos');
  if (!existsSync(root)) return { videos: 0, titles: [] };
  const titles: string[] = [];
  let videos = 0;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    videos++;
    for (const [file, key] of [
      ['publish.md', 'title'],
      ['BRIEF.md', 'title_working'],
    ] as const) {
      const text = readText(path.join(root, e.name, file));
      if (!text) continue;
      try {
        const t = splitFrontMatter(text).front.data[key];
        if (typeof t === 'string' && t.trim() && !titles.includes(t.trim())) titles.push(t.trim());
      } catch {
        // front matter hỏng: bỏ qua file này, không chặn lần quét
      }
    }
  }
  return { videos, titles };
}

/** Các ngày đã có kết quả quét (mới nhất trước). */
export function researchDates(channelDir: string): string[] {
  const dir = path.join(channelDir, RESEARCH_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((n) => DATE_FILE.exec(n)?.[1])
    .filter((d): d is string => Boolean(d))
    .sort()
    .reverse();
}

/** Kết quả quét của một ngày (mặc định ngày gần nhất); chưa có → `undefined`. */
export function readResearch(channelDir: string, date?: string): ResearchDoc | undefined {
  const d = date ?? researchDates(channelDir)[0];
  if (!d) return undefined;
  const text = readText(path.join(channelDir, RESEARCH_DIR, `${d}.json`));
  if (!text) return undefined;
  try {
    return JSON.parse(text) as ResearchDoc;
  } catch {
    return undefined;
  }
}

const errorOf = (e: unknown): { code: string; message: string } =>
  isSfError(e)
    ? { code: e.code, message: e.message }
    : { code: 'E_PROVIDER_FAILED', message: String((e as Error)?.message ?? e) };

/** Tải RSS; HTTP lỗi / mất mạng → `E_PROVIDER_FAILED`. */
async function fetchText(url: string, fetchFn: FetchFn): Promise<string> {
  let r: Response;
  try {
    r = await fetchFn(url);
  } catch (e) {
    throw new SfError(
      'E_PROVIDER_FAILED',
      `${new URL(url).hostname} unreachable: ${(e as Error).message}`,
    );
  }
  if (!r.ok) throw new SfError('E_PROVIDER_FAILED', `${new URL(url).hostname} HTTP ${r.status}`);
  return r.text();
}

const config = <T>(key: string, channelDir: string, appDataDir?: string): T =>
  resolveConfig<T>(key, { channelDir }, { appDataDir }).value;

export async function scanChannel(store: WriteStore, o: ScanOptions = {}): Promise<ScanResult> {
  const channelDir = store.root;
  const now = o.now ?? new Date();
  const fetchFn: FetchFn = o.fetch ?? ((u: string) => fetch(u));
  const channel = JSON.parse(readFileSync(store.abs('channel.json'), 'utf8')) as ChannelConfig;
  const competitors = config<string[]>('autopilot.competitors', channelDir, o.appDataDir) ?? [];
  const pillars = (config<string[]>('autopilot.pillars', channelDir, o.appDataDir) ?? []).filter(
    (p) => p.trim(),
  );
  const tz = config<string>('publish.timezone', channelDir, o.appDataDir);
  const date = researchDate(now, tz);
  const geo = regionForLanguage(channel.language);
  const lang = channel.language;
  const own = ownVideoTitles(channelDir);
  const ctx: ScoreContext = { now, pillars, ownTitles: own.titles };
  const quota: Quota = { units: 0 };
  const api = { apiKey: o.apiKey, fetch: fetchFn, quota };
  const candidates: ResearchCandidate[] = [];
  const sources: ResearchDoc['sources'] = {
    competitors: [],
    own_videos: own.videos,
    trending: { region: geo, videos: 0 },
    trends: { geo, items: 0 },
    news: [],
  };

  // Đối thủ: uploads → ≤ 100 video mới nhất → số liệu (~5 đơn vị / kênh)
  for (const id of competitors) {
    const entry: ResearchDoc['sources']['competitors'][number] = { channel_id: id, videos: 0 };
    try {
      const up = await channelUploads(id, api);
      entry.title = up.title;
      const ids = await playlistVideoIds(up.playlist_id, { ...api, max: UPLOADS_MAX });
      const vids = await videoStats(ids, api);
      entry.videos = vids.length;
      candidates.push(...competitorCandidates(vids, ctx));
    } catch (e) {
      entry.error = errorOf(e);
    }
    sources.competitors.push(entry);
  }

  // Trending theo vùng của ngôn ngữ kênh (1 đơn vị)
  try {
    const vids = await trendingVideos(geo, api);
    sources.trending.videos = vids.length;
    candidates.push(...trendingCandidates(vids, geo, ctx));
  } catch (e) {
    sources.trending.error = errorOf(e);
  }

  // Google Trends trong ngày (không cần khóa)
  try {
    const items = parseRss(
      await fetchText(`https://trends.google.com/trending/rss?geo=${geo}`, fetchFn),
    );
    sources.trends.items = items.length;
    candidates.push(...trendCandidates(items, geo, ctx));
  } catch (e) {
    sources.trends.error = errorOf(e);
  }

  // Tin nóng: Google News tìm theo từng chủ đề trụ cột
  for (const pillar of pillars.slice(0, NEWS_MAX_PILLARS)) {
    const entry: ResearchDoc['sources']['news'][number] = { pillar, items: 0 };
    try {
      const q = new URLSearchParams({ q: pillar, hl: lang, gl: geo, ceid: `${geo}:${lang}` });
      const items = parseRss(
        await fetchText(`https://news.google.com/rss/search?${q}`, fetchFn),
      ).slice(0, NEWS_PER_PILLAR);
      entry.items = items.length;
      candidates.push(...newsCandidates(items, pillar, ctx));
    } catch (e) {
      entry.error = errorOf(e);
    }
    sources.news.push(entry);
  }

  const doc: ResearchDoc = {
    schema_version: 1,
    channel_id: channel.id,
    date,
    generated_at: now.toISOString(),
    quota_units: quota.units,
    sources,
    candidates: rankCandidates(candidates),
  };
  const rel = `${RESEARCH_DIR}/${date}.json`;
  // quét lại trong ngày → ghi đè file của ngày đó (idempotent)
  store.write(rel, `${JSON.stringify(doc, null, 2)}\n`, { by: 'research.scan' });
  return { path: rel, doc };
}

/** Lỗi nguồn dạng một dòng (tóm tắt cho agent / job). */
export function sourceErrors(doc: ResearchDoc): string[] {
  const s = doc.sources;
  return [
    ...s.competitors
      .filter((c) => c.error)
      .map((c) => `competitor ${c.channel_id}: ${c.error!.code} ${c.error!.message}`),
    ...(s.trending.error ? [`trending: ${s.trending.error.code} ${s.trending.error.message}`] : []),
    ...(s.trends.error ? [`trends: ${s.trends.error.code} ${s.trends.error.message}`] : []),
    ...s.news
      .filter((n) => n.error)
      .map((n) => `news "${n.pillar}": ${n.error!.code} ${n.error!.message}`),
  ];
}
