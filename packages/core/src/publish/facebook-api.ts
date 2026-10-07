import { readFileSync } from 'node:fs';
import { SfError } from '../errors.js';
import { jsonOf, realFetch, sleepMs, type HttpFetch } from './http.js';
import { retryable, withRetry } from './social.js';

/**
 * Client Facebook Page Reels qua Graph API (056, D4 9.8): start → tải tệp lên `upload_url` → finish (hẹn giờ).
 * Token Trang dài hạn chỉ đi trong header `Authorization: OAuth …`, không vào URL/lỗi/log.
 */
const GRAPH = 'https://graph.facebook.com/v21.0';
const RUPLOAD = 'https://rupload.facebook.com/video-upload/v21.0';

export interface FacebookApiDeps {
  fetch?: HttpFetch;
  token: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
}

interface GraphError {
  error?: { message?: string; code?: number; type?: string };
}

export class FacebookApi {
  private readonly f: HttpFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(private readonly d: FacebookApiDeps) {
    this.f = d.fetch ?? realFetch;
    this.sleep = d.sleep ?? sleepMs;
  }

  private async fail(op: string, r: Response): Promise<never> {
    const j = await jsonOf<GraphError>(r);
    if (j?.error?.code === 190 || r.status === 401)
      throw new SfError(
        'E_PERMISSION_DECLINED',
        `facebook ${op}: token Trang không hợp lệ hoặc đã hết hạn — dán token mới trong Cài đặt kênh`,
      );
    throw new SfError(
      'E_PROVIDER_FAILED',
      `facebook ${op}: ${r.status} ${(j?.error?.message ?? '').slice(0, 160)}`.trim(),
    );
  }

  private async call<T>(
    op: string,
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
  ): Promise<T> {
    return withRetry<T>(this.sleep, async () => {
      const r = await this.f(url, {
        ...init,
        headers: { authorization: `OAuth ${await this.d.token()}`, ...(init.headers ?? {}) },
      });
      if (retryable(r.status)) return { retry: true, why: `facebook ${op}: HTTP ${r.status}` };
      if (!r.ok) await this.fail(op, r);
      return { value: ((await jsonOf<T>(r)) ?? {}) as T };
    });
  }

  private json(body: unknown) {
    return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  }

  /** Bắt đầu phiên Reels. */
  async start(pageId: string): Promise<{ video_id: string; upload_url: string }> {
    const d = await this.call<{ video_id?: string; upload_url?: string }>(
      'reels.start',
      `${GRAPH}/${encodeURIComponent(pageId)}/video_reels`,
      { method: 'POST', ...this.json({ upload_phase: 'start' }) },
    );
    if (!d.video_id) throw new SfError('E_PROVIDER_FAILED', 'facebook reels.start: thiếu video_id');
    return { video_id: d.video_id, upload_url: d.upload_url ?? `${RUPLOAD}/${d.video_id}` };
  }

  /** Gửi nguyên tệp tới `upload_url` (thử lại từ đầu khi lỗi). */
  async upload(o: { upload_url: string; file: string }): Promise<void> {
    const bytes = new Uint8Array(readFileSync(o.file));
    const d = await this.call<{ success?: boolean }>('reels.upload', o.upload_url, {
      method: 'POST',
      headers: { offset: '0', file_size: String(bytes.length) },
      body: bytes,
    });
    if (d.success === false)
      throw new SfError('E_PROVIDER_FAILED', 'facebook reels.upload: không thành công');
  }

  /** Kết thúc: hẹn giờ công khai (`scheduled_publish_time` giây UNIX) hoặc đăng ngay. */
  async finish(
    pageId: string,
    o: { video_id: string; description: string; title?: string; schedule?: Date },
  ): Promise<void> {
    await this.call('reels.finish', `${GRAPH}/${encodeURIComponent(pageId)}/video_reels`, {
      method: 'POST',
      ...this.json({
        upload_phase: 'finish',
        video_id: o.video_id,
        description: o.description,
        ...(o.title ? { title: o.title } : {}),
        ...(o.schedule
          ? {
              video_state: 'SCHEDULED',
              scheduled_publish_time: Math.floor(o.schedule.getTime() / 1000),
            }
          : { video_state: 'PUBLISHED' }),
      }),
    });
  }

  async remove(videoId: string): Promise<void> {
    await this.call('video.delete', `${GRAPH}/${encodeURIComponent(videoId)}`, {
      method: 'DELETE',
    });
  }

  async publishNow(videoId: string): Promise<void> {
    await this.call('video.publish', `${GRAPH}/${encodeURIComponent(videoId)}`, {
      method: 'POST',
      ...this.json({ is_published: true }),
    });
  }

  async state(videoId: string): Promise<{ published: boolean; permalink?: string }> {
    const d = await this.call<{ published?: boolean; permalink_url?: string }>(
      'video.state',
      `${GRAPH}/${encodeURIComponent(videoId)}?fields=published,permalink_url`,
      {},
    );
    return {
      published: d.published === true,
      ...(d.permalink_url ? { permalink: `https://www.facebook.com${d.permalink_url}` } : {}),
    };
  }
}
