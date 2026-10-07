// Máy chủ giả TikTok Content Posting API và Facebook Graph API cho test đăng bài (056). Ghi lại mọi lời gọi.
import type { HttpFetch } from '../src/publish/http.js';

export interface SocialCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const norm = (init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => ({
  method: init?.method ?? 'GET',
  headers: Object.fromEntries(
    Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  ),
  body:
    typeof init?.body === 'string'
      ? (() => {
          try {
            return JSON.parse(init.body);
          } catch {
            return init.body;
          }
        })()
      : init?.body,
});

export interface FakeTikTok {
  fetch: HttpFetch;
  calls: SocialCall[];
  to(re: RegExp): SocialCall[];
  /** Dãy trạng thái trả lần lượt cho `status/fetch` (hết thì lặp phần tử cuối). */
  statuses: { status: string; fail_reason?: string; ids?: string[] }[];
  publishId: string;
  /** Kịch bản lỗi theo lời gọi. */
  inject: (c: SocialCall, n: number) => Response | Error | undefined;
}

export function fakeTikTok(): FakeTikTok {
  let polls = 0;
  const t: FakeTikTok = {
    calls: [],
    statuses: [{ status: 'PROCESSING_UPLOAD' }, { status: 'PUBLISH_COMPLETE' }],
    publishId: 'v_pub_url~v2.1234',
    inject: () => undefined,
    to: (re) => t.calls.filter((c) => re.test(c.url)),
    fetch: async (url, init) => {
      const c: SocialCall = { url, ...norm(init) };
      t.calls.push(c);
      const bad = t.inject(c, t.calls.length);
      if (bad instanceof Error) throw bad;
      if (bad) return bad;
      if (url.endsWith('/v2/post/publish/video/init/'))
        return json({
          data: { publish_id: t.publishId, upload_url: 'https://upload.tiktok.fake/u/1' },
          error: { code: 'ok', message: '' },
        });
      if (url === 'https://upload.tiktok.fake/u/1') {
        const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(c.headers['content-range'] ?? '');
        const last = m && Number(m[2]) + 1 === Number(m[3]);
        return new Response(null, { status: last ? 201 : 206 });
      }
      if (url.endsWith('/v2/post/publish/status/fetch/')) {
        const s = t.statuses[Math.min(polls++, t.statuses.length - 1)]!;
        return json({
          data: {
            status: s.status,
            ...(s.fail_reason ? { fail_reason: s.fail_reason } : {}),
            ...(s.ids ? { publicaly_available_post_id: s.ids } : {}),
          },
          error: { code: 'ok', message: '' },
        });
      }
      return new Response('not found', { status: 404 });
    },
  };
  return t;
}

export interface FakeFacebook {
  fetch: HttpFetch;
  calls: SocialCall[];
  to(re: RegExp): SocialCall[];
  videoId: string;
  /** Trạng thái `published` của video khi hỏi. */
  published: { value: boolean };
  inject: (c: SocialCall, n: number) => Response | Error | undefined;
}

export function fakeFacebook(): FakeFacebook {
  const f: FakeFacebook = {
    calls: [],
    videoId: '9876543210',
    published: { value: false },
    inject: () => undefined,
    to: (re) => f.calls.filter((c) => re.test(c.url)),
    fetch: async (url, init) => {
      const c: SocialCall = { url, ...norm(init) };
      f.calls.push(c);
      const bad = f.inject(c, f.calls.length);
      if (bad instanceof Error) throw bad;
      if (bad) return bad;
      if (/graph\.facebook\.com\/v21\.0\/\d+\/video_reels$/.test(url)) {
        const b = c.body as { upload_phase?: string };
        if (b.upload_phase === 'start')
          return json({
            video_id: f.videoId,
            upload_url: `https://rupload.facebook.com/video-upload/v21.0/${f.videoId}`,
          });
        if (b.upload_phase === 'finish') return json({ success: true });
      }
      if (url.startsWith('https://rupload.facebook.com/video-upload/'))
        return json({ success: true });
      if (/graph\.facebook\.com\/v21\.0\/\d+\?fields=/.test(url))
        return json({ published: f.published.value, permalink_url: `/reel/${f.videoId}` });
      if (/graph\.facebook\.com\/v21\.0\/\d+$/.test(url) && c.method === 'DELETE')
        return json({ success: true });
      if (/graph\.facebook\.com\/v21\.0\/\d+$/.test(url) && c.method === 'POST') {
        f.published.value = true;
        return json({ success: true });
      }
      return new Response('not found', { status: 404 });
    },
  };
  return f;
}

/** Phản hồi lỗi kiểu Graph API. */
export const graphError = (status: number, code: number, message = 'lỗi') =>
  json({ error: { message, code, type: 'OAuthException' } }, status);

/** Phản hồi lỗi kiểu TikTok. */
export const tiktokError = (status: number, code: string, message = 'lỗi') =>
  json({ error: { code, message } }, status);
