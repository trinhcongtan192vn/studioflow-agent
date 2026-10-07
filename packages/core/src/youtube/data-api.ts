import { SfError } from '../errors.js';
import { isoDurationSeconds } from './tools.js';

/**
 * Gọi thẳng YouTube Data API v3 (047) cho việc MCP server YouTube không có tool: giải kênh từ @handle /
 * URL. Cùng khóa `youtube_api_key`; lỗi chuẩn hoá như tool `youtube.*` (D4 mục 9.4).
 */
const API = 'https://www.googleapis.com/youtube/v3';

export type FetchFn = (url: string) => Promise<Response>;

export type ChannelInput =
  { id: string } | { handle: string } | { username: string } | { query: string };

/** URL kênh / @handle / ID `UC…` → cách tra; không phải kênh YouTube → `undefined`. */
export function parseChannelInput(input: string): ChannelInput | undefined {
  const s = input.trim();
  if (/^UC[\w-]{22}$/.test(s)) return { id: s };
  if (/^@[\w.-]{3,}$/.test(s)) return { handle: s };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return undefined;
  }
  if (!/^(www\.|m\.)?youtube\.com$/.test(u.hostname)) return undefined;
  const [first, second] = u.pathname.split('/').filter(Boolean);
  if (!first) return undefined;
  if (first.startsWith('@')) return { handle: first };
  if (first === 'channel' && second && /^UC[\w-]{22}$/.test(second)) return { id: second };
  if (first === 'user' && second) return { username: second };
  if (first === 'c' && second) return { query: decodeURIComponent(second) };
  return undefined;
}

export interface ChannelCard {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
  subscribers: number | null;
  videos: number | null;
}

interface ChannelItem {
  id: string;
  snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
  statistics?: { subscriberCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean };
}

/** Bộ đếm đơn vị quota YouTube Data API v3 của một lần quét (049, D4 9.5). */
export interface Quota {
  units: number;
}

export interface ApiOptions {
  apiKey: string | undefined;
  fetch?: FetchFn;
  quota?: Quota;
}

interface Page {
  items?: unknown[];
  nextPageToken?: string;
}

async function get(
  path: string,
  params: Record<string, string>,
  o: { apiKey: string; fetch?: FetchFn; quota?: Quota },
  cost = 1,
): Promise<Page> {
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key: o.apiKey })}`;
  // Google tính quota cả khi lời gọi lỗi → đếm trước khi gọi
  if (o.quota) o.quota.units += cost;
  let r: Response;
  try {
    r = await (o.fetch ?? ((u: string) => fetch(u)))(url);
  } catch (e) {
    throw new SfError('E_PROVIDER_FAILED', `YouTube Data API unreachable: ${(e as Error).message}`);
  }
  const body = (await r.json().catch(() => ({}))) as Page & { error?: { message?: string } };
  if (!r.ok)
    throw new SfError(
      'E_PROVIDER_FAILED',
      `YouTube Data API ${r.status}: ${body.error?.message ?? r.statusText}`,
    );
  return body;
}

const NO_KEY = 'Chưa có khóa YouTube Data API v3: thêm trong Cài đặt → Khóa API (YouTube).';

/** Tùy chọn gọi API đã có khóa; thiếu khóa → `E_PROVIDER_UNAVAILABLE`. */
function keyed(o: ApiOptions): { apiKey: string; fetch?: FetchFn; quota?: Quota } {
  if (!o.apiKey) throw new SfError('E_PROVIDER_UNAVAILABLE', NO_KEY);
  return {
    apiKey: o.apiKey,
    ...(o.fetch ? { fetch: o.fetch } : {}),
    ...(o.quota ? { quota: o.quota } : {}),
  };
}

/**
 * Kênh YouTube từ ID / @handle / URL (`channels.list`, 1 đơn vị quota; URL `/c/…` cũ phải tìm kiếm,
 * 100 đơn vị). Thiếu khóa → `E_PROVIDER_UNAVAILABLE`; không thấy → `E_FILE_NOT_FOUND`.
 */
export async function resolveYouTubeChannel(input: string, o: ApiOptions): Promise<ChannelCard> {
  const opts = keyed(o);
  const parsed = parseChannelInput(input);
  if (!parsed)
    throw new SfError('E_SCHEMA_INVALID', `not a YouTube channel URL, @handle or UC… id: ${input}`);
  let id: string | undefined;
  const base = { part: 'snippet,statistics' };
  let items: ChannelItem[] = [];
  if ('query' in parsed) {
    const s = await get(
      'search',
      { part: 'snippet', type: 'channel', q: parsed.query, maxResults: '1' },
      opts,
      100,
    );
    id = (s.items?.[0] as { snippet?: { channelId?: string } } | undefined)?.snippet?.channelId;
    if (id) items = ((await get('channels', { ...base, id }, opts)).items ?? []) as ChannelItem[];
  } else {
    const q: Record<string, string> =
      'id' in parsed
        ? { id: parsed.id }
        : 'handle' in parsed
          ? { forHandle: parsed.handle }
          : { forUsername: parsed.username };
    items = ((await get('channels', { ...base, ...q }, opts)).items ?? []) as ChannelItem[];
  }
  const c = items[0];
  if (!c) throw new SfError('E_FILE_NOT_FOUND', `YouTube channel not found: ${input}`);
  const n = (v?: string) => (v === undefined ? null : Number(v));
  return {
    id: c.id,
    title: c.snippet?.title ?? c.id,
    handle: c.snippet?.customUrl ?? null,
    thumbnail: c.snippet?.thumbnails?.default?.url ?? null,
    subscribers: c.statistics?.hiddenSubscriberCount ? null : n(c.statistics?.subscriberCount),
    videos: n(c.statistics?.videoCount),
  };
}

// ---------- quét nghiên cứu Autopilot (049, D4 9.5): REST rẻ quota, không dùng search.list ----------

/** Vùng trending / Google Trends theo ngôn ngữ kênh (D3 `Lang`). */
export function regionForLanguage(lang: string): 'VN' | 'DE' | 'US' {
  return lang === 'vi' ? 'VN' : lang === 'de' ? 'DE' : 'US';
}

/** Số liệu một video (gọn cho chấm điểm). */
export interface VideoStats {
  video_id: string;
  title: string;
  tags: string[];
  channel_id: string;
  channel_title: string;
  published_at: string;
  views: number;
  likes?: number;
  comments?: number;
  duration_s?: number;
}

interface VideoItem {
  id: string;
  snippet?: {
    title?: string;
    tags?: string[];
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

function toStats(v: VideoItem): VideoStats {
  const n = (x?: string) => (x === undefined ? undefined : Number(x));
  const likes = n(v.statistics?.likeCount);
  const comments = n(v.statistics?.commentCount);
  const duration = isoDurationSeconds(v.contentDetails?.duration);
  return {
    video_id: v.id,
    title: v.snippet?.title ?? '',
    tags: v.snippet?.tags ?? [],
    channel_id: v.snippet?.channelId ?? '',
    channel_title: v.snippet?.channelTitle ?? '',
    published_at: v.snippet?.publishedAt ?? '',
    views: n(v.statistics?.viewCount) ?? 0,
    ...(likes === undefined ? {} : { likes }),
    ...(comments === undefined ? {} : { comments }),
    ...(duration === undefined ? {} : { duration_s: duration }),
  };
}

/** Playlist "uploads" + tên kênh (`channels.list part=snippet,contentDetails`, 1 đơn vị). */
export async function channelUploads(
  channelId: string,
  o: ApiOptions,
): Promise<{ playlist_id: string; title: string }> {
  const r = await get('channels', { part: 'snippet,contentDetails', id: channelId }, keyed(o));
  const c = r.items?.[0] as
    | {
        snippet?: { title?: string };
        contentDetails?: { relatedPlaylists?: { uploads?: string } };
      }
    | undefined;
  const playlist = c?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlist) throw new SfError('E_FILE_NOT_FOUND', `YouTube channel not found: ${channelId}`);
  return { playlist_id: playlist, title: c?.snippet?.title ?? channelId };
}

/** ID video mới nhất của playlist (`playlistItems.list`, 1 đơn vị / trang 50). */
export async function playlistVideoIds(
  playlistId: string,
  o: ApiOptions & { max?: number },
): Promise<string[]> {
  const opts = keyed(o);
  const max = o.max ?? 50;
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const r = await get(
      'playlistItems',
      {
        part: 'contentDetails',
        playlistId,
        maxResults: String(Math.min(50, max - ids.length)),
        ...(pageToken ? { pageToken } : {}),
      },
      opts,
    );
    for (const it of (r.items ?? []) as { contentDetails?: { videoId?: string } }[])
      if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids.slice(0, max);
}

/** Số liệu video theo lô ≤ 50 ID (`videos.list`, 1 đơn vị / lô). */
export async function videoStats(ids: string[], o: ApiOptions): Promise<VideoStats[]> {
  if (!ids.length) return [];
  const opts = keyed(o);
  const out: VideoStats[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await get(
      'videos',
      { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(',') },
      opts,
    );
    out.push(...((r.items ?? []) as VideoItem[]).map(toStats));
  }
  return out;
}

/** Video trending của vùng (`videos.list chart=mostPopular`, 1 đơn vị). */
export async function trendingVideos(
  regionCode: string,
  o: ApiOptions & { max?: number },
): Promise<VideoStats[]> {
  const r = await get(
    'videos',
    {
      part: 'snippet,statistics,contentDetails',
      chart: 'mostPopular',
      regionCode,
      maxResults: String(Math.min(50, o.max ?? 50)),
    },
    keyed(o),
  );
  return ((r.items ?? []) as VideoItem[]).map(toStats);
}
