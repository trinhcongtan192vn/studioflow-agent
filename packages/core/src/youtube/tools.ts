import { SfError } from '../errors.js';
import type { ToolDefinition } from '../gateway/types.js';
import type { YouTubeMcp } from './mcp.js';

/** ID video (11 ký tự) từ URL YouTube thường gặp hoặc ID trần; không phải YouTube → `undefined`. */
export function parseYouTubeId(input: string): string | undefined {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return undefined;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null | undefined;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com')
    id = u.searchParams.get('v') ?? /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname)?.[1];
  return id && /^[\w-]{11}$/.test(id) ? id : undefined;
}

const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

function videoIdOf(url: string): string {
  const id = parseYouTubeId(url);
  if (!id) throw new SfError('E_SCHEMA_INVALID', `not a YouTube video URL or id: ${url}`);
  return id;
}

/** ISO 8601 (PT1H2M3S) → giây. */
export function isoDurationSeconds(d: string | undefined): number | undefined {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? '');
  if (!m) return undefined;
  const [, dd, h, mi, s] = m.map((x) => Number(x ?? 0));
  return dd! * 86400 + h! * 3600 + mi! * 60 + s!;
}

const num = (v: unknown) => (v === undefined || v === null ? undefined : Number(v));
const clip = (s: unknown, n: number) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

interface Snippet {
  title?: string;
  description?: string;
  channelTitle?: string;
  channelId?: string;
  publishedAt?: string;
  tags?: string[];
}

/** Một mục kết quả tìm kiếm/danh sách video của kênh → dạng gọn. */
function listItem(x: { id?: { videoId?: string } | string; snippet?: Snippet }) {
  const id = typeof x.id === 'string' ? x.id : x.id?.videoId;
  if (!id) return undefined;
  return {
    video_id: id,
    url: watchUrl(id),
    title: x.snippet?.title ?? '',
    channel: { id: x.snippet?.channelId ?? '', title: x.snippet?.channelTitle ?? '' },
    published_at: x.snippet?.publishedAt ?? '',
  };
}

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Gộp đoạn transcript thành dòng ~20 giây có mốc thời gian (ít token, vẫn thấy nhịp video). */
export function transcriptText(
  segs: { text: string; offset: number; duration?: number }[],
  windowMs = 20_000,
): string {
  const lines: string[] = [];
  let start = -1;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) lines.push(`[${mmss(start)}] ${buf.join(' ').replace(/\s+/g, ' ').trim()}`);
    buf = [];
  };
  for (const s of segs) {
    if (start < 0 || s.offset - start >= windowMs) {
      flush();
      start = s.offset;
    }
    buf.push(s.text.replace(/&amp;#39;|&#39;/g, "'").replace(/&amp;/g, '&'));
  }
  flush();
  return lines.join('\n');
}

const TRANSCRIPT_MAX = 60_000;

const urlInput = {
  type: 'object',
  properties: { url: { type: 'string', description: 'URL video YouTube hoặc ID 11 ký tự' } },
  required: ['url'],
  additionalProperties: false,
};

/** Tool `youtube.*` (D4, 044): đọc video tham khảo / nghiên cứu nội dung qua MCP server YouTube. */
export function youtubeTools(mcp: YouTubeMcp): ToolDefinition[] {
  return [
    {
      name: 'youtube.video',
      description:
        'Thông tin một video YouTube (tiêu đề, kênh, thời lượng, lượt xem/thích/bình luận, mô tả, tags) từ URL. Dùng khi người dùng muốn tạo video từ một video YouTube tham khảo.',
      input: urlInput,
      handler: async (i: { url: string }) => {
        const id = videoIdOf(i.url);
        const v = (await mcp.call('videos_getVideo', { videoId: id })) as {
          snippet?: Snippet;
          contentDetails?: { duration?: string };
          statistics?: Record<string, string>;
        } | null;
        if (!v)
          throw new SfError(
            'E_FILE_NOT_FOUND',
            `YouTube video ${id} not found (private or removed)`,
          );
        return {
          video_id: id,
          url: watchUrl(id),
          title: v.snippet?.title ?? '',
          channel: { id: v.snippet?.channelId ?? '', title: v.snippet?.channelTitle ?? '' },
          published_at: v.snippet?.publishedAt ?? '',
          duration_s: isoDurationSeconds(v.contentDetails?.duration),
          stats: {
            views: num(v.statistics?.viewCount),
            likes: num(v.statistics?.likeCount),
            comments: num(v.statistics?.commentCount),
          },
          tags: v.snippet?.tags ?? [],
          description: clip(v.snippet?.description, 2000),
        };
      },
    },
    {
      name: 'youtube.transcript',
      description:
        'Lời thoại (phụ đề) của video YouTube, gộp theo mốc ~20 giây: [m:ss] câu… Thử ngôn ngữ yêu cầu rồi vi, en. Dùng để phân tích hook/cấu trúc/nhịp — KHÔNG chép hay diễn đạt lại nội dung.',
      input: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL video YouTube hoặc ID 11 ký tự' },
          language: { type: 'string', description: 'Mã ngôn ngữ phụ đề ưu tiên (vi, en…)' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      handler: async (i: { url: string; language?: string }) => {
        const id = videoIdOf(i.url);
        const langs = [...new Set([i.language, 'vi', 'en'].filter((x): x is string => !!x))];
        const errors: string[] = [];
        for (let k = 0; k < langs.length && k < 6; k++) {
          const language = langs[k]!;
          try {
            const r = (await mcp.call('transcripts_getTranscript', { videoId: id, language })) as {
              transcript?: { text: string; offset: number; duration?: number }[];
            };
            const segs = r.transcript ?? [];
            if (!segs.length) continue;
            const text = transcriptText(segs);
            return {
              video_id: id,
              language,
              segments: segs.length,
              ...(text.length > TRANSCRIPT_MAX
                ? { text: text.slice(0, TRANSCRIPT_MAX), truncated: true }
                : { text }),
            };
          } catch (e) {
            const msg = (e as Error).message;
            errors.push(`${language}: ${msg}`);
            // "Available languages: en, de-DE, …" → thử thêm các ngôn ngữ có sẵn
            for (const l of /Available languages: ([^)]+?)\s*(?:\)|$)/
              .exec(msg)?.[1]
              ?.split(/,\s*/) ?? [])
              if (l && !langs.includes(l)) langs.push(l);
          }
        }
        throw new SfError(
          'E_FILE_NOT_FOUND',
          `no transcript for YouTube video ${id} (${errors.join('; ') || 'empty'}); analyse from title/description instead`,
        );
      },
    },
    {
      name: 'youtube.search',
      description:
        'Tìm video YouTube theo từ khoá (nghiên cứu chủ đề, video đang hot của đối thủ). order: relevance | date | viewCount | rating. published_after: ISO 8601.',
      input: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_results: { type: 'integer', minimum: 1, maximum: 50 },
          order: { type: 'string', enum: ['relevance', 'date', 'viewCount', 'rating'] },
          published_after: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      handler: async (i: {
        query: string;
        max_results?: number;
        order?: string;
        published_after?: string;
      }) => {
        const r = (await mcp.call('videos_searchVideos', {
          query: i.query,
          maxResults: i.max_results ?? 10,
          order: i.order ?? 'relevance',
          ...(i.published_after ? { publishedAfter: i.published_after } : {}),
        })) as Parameters<typeof listItem>[0][];
        return { videos: (r ?? []).map(listItem).filter(Boolean) };
      },
    },
    {
      name: 'youtube.channel_videos',
      description: 'Video mới nhất của một kênh YouTube (channel_id dạng UC…), mới trước.',
      input: {
        type: 'object',
        properties: {
          channel_id: { type: 'string' },
          max_results: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['channel_id'],
        additionalProperties: false,
      },
      handler: async (i: { channel_id: string; max_results?: number }) => {
        const r = (await mcp.call('channels_listVideos', {
          channelId: i.channel_id,
          maxResults: i.max_results ?? 10,
        })) as Parameters<typeof listItem>[0][];
        return { videos: (r ?? []).map(listItem).filter(Boolean) };
      },
    },
  ];
}
