// Máy chủ Google giả cho test đăng bài (053): OAuth token, channels.list, tải lên resumable, captions,
// thumbnails, videos.update/list. Ghi lại mọi lời gọi; có thể chèn lỗi theo kịch bản.
import type { HttpFetch } from '../src/publish/http.js';

export interface GoogleCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeGoogle {
  fetch: HttpFetch;
  calls: GoogleCall[];
  /** Lời gọi theo mẫu URL. */
  to(re: RegExp): GoogleCall[];
  /** Kênh YouTube của token. */
  channel: { id: string; title: string };
  /** ID video trả về khi tải xong. */
  videoId: string;
  /** Trạng thái video giả cho videos.list. */
  privacy: { value: string };
  /** Kịch bản lỗi: trả về Response/Error thay cho phản hồi bình thường (undefined = bình thường). */
  inject: (call: GoogleCall, n: number) => Response | Error | undefined;
  /** Số byte máy chủ đã nhận cho phiên tải lên. */
  received: { bytes: number };
  /** Số liệu Analytics giả (054): theo ngày của kênh / từng video và thống kê lũy kế. */
  analytics: {
    channel: Record<string, number>;
    videos: Record<string, Record<string, number>>;
    stats: Record<string, { view: number; like: number; comment: number }>;
    /** video trả 403 (mới đăng, chưa có số liệu). */
    failVideo?: string;
  };
  tokens: { n: number; expires_in: number; refresh_token?: string; error?: string };
}

const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export function fakeGoogle(): FakeGoogle {
  const g: FakeGoogle = {
    calls: [],
    channel: { id: 'UCaaaaaaaaaaaaaaaaaaaaa1', title: 'Sử Kể Mẫu' },
    videoId: 'yt_vid_001',
    privacy: { value: 'private' },
    received: { bytes: 0 },
    tokens: { n: 0, expires_in: 3600 },
    analytics: { channel: {}, videos: {}, stats: {} },
    inject: () => undefined,
    to: (re) => g.calls.filter((c) => re.test(c.url)),
    fetch: async (url, init) => {
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
      );
      const raw = init?.body;
      const body =
        typeof raw === 'string'
          ? (() => {
              try {
                return JSON.parse(raw);
              } catch {
                return raw;
              }
            })()
          : raw;
      const call: GoogleCall = { method: init?.method ?? 'GET', url, headers, body };
      g.calls.push(call);
      const bad = g.inject(call, g.calls.length);
      if (bad instanceof Error) throw bad;
      if (bad) return bad;

      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        g.tokens.n += 1;
        if (g.tokens.error) return json({ error: g.tokens.error }, 400);
        const form = new URLSearchParams(String(raw));
        const code = form.get('grant_type') === 'authorization_code';
        return json({
          access_token: `at_${g.tokens.n}`,
          expires_in: g.tokens.expires_in,
          ...(code
            ? { refresh_token: g.tokens.refresh_token ?? 'rt_initial' }
            : g.tokens.refresh_token
              ? { refresh_token: g.tokens.refresh_token }
              : {}),
        });
      }
      if (url.startsWith('https://oauth2.googleapis.com/revoke')) return json({});
      if (url.startsWith('https://youtubeanalytics.googleapis.com/v2/reports')) {
        const q = new URL(url).searchParams;
        const vid = /^video==(.+)$/.exec(q.get('filters') ?? '')?.[1];
        if (vid && g.analytics.failVideo === vid) return googleError(403, 'forbidden');
        const src = vid ? (g.analytics.videos[vid] ?? {}) : g.analytics.channel;
        const names = (q.get('metrics') ?? '').split(',');
        const rows = Object.keys(src)
          .filter((d) => d >= q.get('startDate')! && d <= q.get('endDate')!)
          .sort()
          .map((d) => [d, ...names.map((n) => (n === 'views' ? src[d]! : n === 'likes' ? 1 : 10))]);
        return json({
          columnHeaders: [{ name: 'day' }, ...names.map((name) => ({ name }))],
          rows,
        });
      }
      if (/\/youtube\/v3\/videos\?part=statistics&id=/.test(url)) {
        const ids = decodeURIComponent(new URL(url).searchParams.get('id') ?? '').split(',');
        return json({
          items: ids
            .filter((id) => g.analytics.stats[id])
            .map((id) => ({
              id,
              statistics: {
                viewCount: String(g.analytics.stats[id]!.view),
                likeCount: String(g.analytics.stats[id]!.like),
                commentCount: String(g.analytics.stats[id]!.comment),
              },
            })),
        });
      }
      if (/\/youtube\/v3\/channels\?/.test(url))
        return json({ items: [{ id: g.channel.id, snippet: { title: g.channel.title } }] });
      if (/\/youtube\/v3\/videos\?part=status&id=/.test(url))
        return json({
          items: [{ status: { privacyStatus: g.privacy.value, uploadStatus: 'processed' } }],
        });
      if (/\/youtube\/v3\/videos\?part=status$/.test(url) && call.method === 'PUT') {
        const st = (body as { status?: { privacyStatus?: string } }).status;
        if (st?.privacyStatus) g.privacy.value = st.privacyStatus;
        return json({ id: g.videoId });
      }
      if (url.includes('/upload/youtube/v3/videos?uploadType=resumable'))
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.fake/session/abc' },
        });
      if (url === 'https://upload.fake/session/abc') {
        const range = headers['content-range'] ?? '';
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
        if (!m) {
          // hỏi vị trí: bytes */total
          if (g.received.bytes === 0) return new Response(null, { status: 308 });
          return new Response(null, {
            status: 308,
            headers: { range: `bytes=0-${g.received.bytes - 1}` },
          });
        }
        const [start, end, total] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (start !== g.received.bytes) return new Response(null, { status: 400 });
        g.received.bytes = end + 1;
        if (g.received.bytes >= total) return json({ id: g.videoId });
        return new Response(null, { status: 308, headers: { range: `bytes=0-${end}` } });
      }
      if (url.includes('/upload/youtube/v3/captions')) return json({ id: 'cap1' });
      if (url.includes('/upload/youtube/v3/thumbnails/set')) return json({ items: [] });
      return new Response('not found', { status: 404 });
    },
  };
  return g;
}

/** Phản hồi lỗi kiểu Google. */
export const googleError = (status: number, reason: string, message = 'lỗi') =>
  json({ error: { code: status, message, errors: [{ reason }] } }, status);

/** Bot API Telegram giả: hàng đợi update, ghi lại tin gửi đi / trả lời nút / sửa bàn phím. */
export function fakeTelegramApi(group = -100777) {
  const queue: object[] = [];
  const sent: {
    chat_id: number | string;
    text: string;
    parse_mode?: string;
    reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] };
  }[] = [];
  const answered: { callback_query_id: string; text?: string; show_alert?: boolean }[] = [];
  const edited: object[] = [];
  let uid = 5000;
  const reply = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
  const f = async (url: string, init?: { body?: unknown }) => {
    const method = url.split('/').pop()!;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    if (method === 'getMe')
      return reply({ id: 900, is_bot: true, username: 'sf_bot', first_name: 'SF' });
    if (method === 'getUpdates') {
      if (queue.length) return reply(queue.splice(0));
      await new Promise((r) => setTimeout(r, 15));
      return reply([]);
    }
    if (method === 'sendMessage') {
      sent.push(body);
      return reply({
        message_id: 700 + sent.length,
        chat: { id: body.chat_id, type: 'supergroup' },
      });
    }
    if (method === 'answerCallbackQuery') answered.push(body);
    if (method === 'editMessageReplyMarkup') edited.push(body);
    return reply(true);
  };
  const press = (data: string, from = { id: 11, first_name: 'Alice' }) =>
    queue.push({
      update_id: ++uid,
      callback_query: {
        id: `cb${uid}`,
        from,
        data,
        message: { message_id: 701, chat: { id: group, type: 'supergroup' } },
      },
    });
  const say = (text: string, from = { id: 11, first_name: 'Alice' }) =>
    queue.push({
      update_id: ++uid,
      message: { message_id: uid, chat: { id: group, type: 'supergroup' }, from, text },
    });
  return { f, sent, answered, edited, press, say };
}
