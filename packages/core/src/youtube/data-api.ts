import { SfError } from '../errors.js';

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

async function get(
  path: string,
  params: Record<string, string>,
  o: { apiKey: string; fetch?: FetchFn },
): Promise<{ items?: unknown[] }> {
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key: o.apiKey })}`;
  let r: Response;
  try {
    r = await (o.fetch ?? ((u: string) => fetch(u)))(url);
  } catch (e) {
    throw new SfError('E_PROVIDER_FAILED', `YouTube Data API unreachable: ${(e as Error).message}`);
  }
  const body = (await r.json().catch(() => ({}))) as {
    items?: unknown[];
    error?: { message?: string };
  };
  if (!r.ok)
    throw new SfError(
      'E_PROVIDER_FAILED',
      `YouTube Data API ${r.status}: ${body.error?.message ?? r.statusText}`,
    );
  return body;
}

/**
 * Kênh YouTube từ ID / @handle / URL (`channels.list`, 1 đơn vị quota; URL `/c/…` cũ phải tìm kiếm,
 * 100 đơn vị). Thiếu khóa → `E_PROVIDER_UNAVAILABLE`; không thấy → `E_FILE_NOT_FOUND`.
 */
export async function resolveYouTubeChannel(
  input: string,
  o: { apiKey: string | undefined; fetch?: FetchFn },
): Promise<ChannelCard> {
  if (!o.apiKey)
    throw new SfError(
      'E_PROVIDER_UNAVAILABLE',
      'Chưa có khóa YouTube Data API v3: thêm trong Cài đặt → Khóa API (YouTube).',
    );
  const opts = { apiKey: o.apiKey, ...(o.fetch ? { fetch: o.fetch } : {}) };
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
