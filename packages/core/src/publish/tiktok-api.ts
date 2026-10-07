import { open } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { SfError } from '../errors.js';
import { jsonOf, realFetch, sleepMs, type HttpFetch } from './http.js';
import { retryable, withRetry } from './social.js';

/**
 * Client TikTok Content Posting API (056, D4 9.8): FILE_UPLOAD — khởi tạo → gửi từng khúc → hỏi trạng thái.
 * Token do người dùng dán; chỉ đi trong header `Authorization`, không bao giờ vào URL/lỗi/log.
 */
const API = 'https://open.tiktokapis.com/v2';
export const TIKTOK_CONSTANTS = {
  CHUNK: 10 * 1024 * 1024,
  MIN_CHUNK: 5 * 1024 * 1024,
  POLL_MS: 3000,
  MAX_POLLS: 40,
  TITLE_MAX: 150,
} as const;

export type TikTokPrivacy = 'SELF_ONLY' | 'PUBLIC_TO_EVERYONE';
export type TikTokPostStatus =
  | 'PROCESSING_UPLOAD'
  | 'PROCESSING_DOWNLOAD'
  | 'SEND_TO_USER_INBOX'
  | 'PUBLISH_COMPLETE'
  | 'FAILED';

export interface TikTokApiDeps {
  fetch?: HttpFetch;
  token: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
}

interface TtEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

export class TikTokApi {
  private readonly f: HttpFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(private readonly d: TikTokApiDeps) {
    this.f = d.fetch ?? realFetch;
    this.sleep = d.sleep ?? sleepMs;
  }

  /** Lỗi chuẩn hoá — không kèm token. */
  private fail(op: string, status: number, code?: string, message?: string): never {
    if (code === 'access_token_invalid' || status === 401)
      throw new SfError(
        'E_PERMISSION_DECLINED',
        `tiktok ${op}: token không hợp lệ hoặc đã hết hạn — dán token mới trong Cài đặt kênh`,
      );
    throw new SfError(
      'E_PROVIDER_FAILED',
      `tiktok ${op}: ${status} ${code ?? ''} ${(message ?? '').slice(0, 160)}`.trim(),
    );
  }

  private async post<T>(op: string, path: string, body: unknown): Promise<T> {
    return withRetry<T>(this.sleep, async () => {
      const r = await this.f(`${API}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.d.token()}`,
          'content-type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(body),
      });
      if (retryable(r.status)) return { retry: true, why: `tiktok ${op}: HTTP ${r.status}` };
      const j = await jsonOf<TtEnvelope<T>>(r);
      if (!r.ok || (j?.error?.code && j.error.code !== 'ok'))
        this.fail(op, r.status, j?.error?.code, j?.error?.message);
      return { value: (j?.data ?? {}) as T };
    });
  }

  /** Khởi tạo bài đăng từ tệp. `title` ≤ 150 ký tự. */
  async init(o: {
    title: string;
    privacy: TikTokPrivacy;
    size: number;
  }): Promise<{ publish_id: string; upload_url: string; chunk: number; chunks: number }> {
    const C = TIKTOK_CONSTANTS;
    // khúc 5–64 MiB; khúc cuối được lớn hơn (tới 128 MiB) nên chia lấy phần nguyên
    const chunk = o.size < C.MIN_CHUNK ? o.size : C.CHUNK;
    const chunks = Math.max(1, Math.floor(o.size / chunk));
    const d = await this.post<{ publish_id?: string; upload_url?: string }>(
      'init',
      '/post/publish/video/init/',
      {
        post_info: {
          title: o.title.slice(0, C.TITLE_MAX),
          privacy_level: o.privacy,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: o.size,
          chunk_size: chunk,
          total_chunk_count: chunks,
        },
      },
    );
    if (!d.publish_id || !d.upload_url)
      throw new SfError('E_PROVIDER_FAILED', 'tiktok init: phản hồi thiếu publish_id/upload_url');
    return { publish_id: d.publish_id, upload_url: d.upload_url, chunk, chunks };
  }

  private async readChunk(file: string, start: number, len: number): Promise<Uint8Array> {
    const fh = await open(file, 'r');
    try {
      const buf = Buffer.alloc(len);
      let got = 0;
      while (got < len) {
        const { bytesRead } = await fh.read(buf, got, len - got, start + got);
        if (bytesRead <= 0) break;
        got += bytesRead;
      }
      return new Uint8Array(buf.buffer, buf.byteOffset, got);
    } finally {
      await fh.close();
    }
  }

  /** Gửi tệp theo từng khúc tới `upload_url` (khúc lỗi mạng/5xx được thử lại). */
  async upload(o: {
    upload_url: string;
    file: string;
    chunk: number;
    chunks: number;
    mime?: string;
  }): Promise<void> {
    const total = statSync(o.file).size;
    for (let i = 0; i < o.chunks; i++) {
      const start = i * o.chunk;
      const end = i === o.chunks - 1 ? total : start + o.chunk;
      const body = await this.readChunk(o.file, start, end - start);
      await withRetry(this.sleep, async () => {
        const r = await this.f(o.upload_url, {
          method: 'PUT',
          headers: {
            'content-type': o.mime ?? 'video/mp4',
            'content-range': `bytes ${start}-${end - 1}/${total}`,
          },
          body,
        });
        if (retryable(r.status)) return { retry: true, why: `tiktok upload: HTTP ${r.status}` };
        if (![200, 201, 206].includes(r.status)) this.fail('upload', r.status);
        return { value: undefined };
      });
    }
  }

  /** Trạng thái bài đăng. */
  async status(
    publishId: string,
  ): Promise<{ status: TikTokPostStatus; fail_reason?: string; post_ids?: string[] }> {
    const d = await this.post<{
      status?: TikTokPostStatus;
      fail_reason?: string;
      publicaly_available_post_id?: (string | number)[];
    }>('status', '/post/publish/status/fetch/', { publish_id: publishId });
    return {
      status: d.status ?? 'PROCESSING_UPLOAD',
      ...(d.fail_reason ? { fail_reason: d.fail_reason } : {}),
      ...(d.publicaly_available_post_id?.length
        ? { post_ids: d.publicaly_available_post_id.map(String) }
        : {}),
    };
  }

  /** Hỏi đến khi xong hoặc hết lượt; hết lượt → `pending` (lượt tick sau hỏi tiếp, không tải lại). */
  async waitDone(
    publishId: string,
  ): Promise<
    { done: true; post_ids?: string[]; inbox: boolean } | { done: false; status: TikTokPostStatus }
  > {
    let last: TikTokPostStatus = 'PROCESSING_UPLOAD';
    for (let i = 0; i < TIKTOK_CONSTANTS.MAX_POLLS; i++) {
      const s = await this.status(publishId);
      last = s.status;
      if (s.status === 'FAILED')
        throw new SfError(
          'E_PROVIDER_FAILED',
          `tiktok: bài đăng lỗi (${s.fail_reason ?? 'không rõ'})`,
        );
      if (s.status === 'PUBLISH_COMPLETE' || s.status === 'SEND_TO_USER_INBOX')
        return {
          done: true,
          inbox: s.status === 'SEND_TO_USER_INBOX',
          ...(s.post_ids ? { post_ids: s.post_ids } : {}),
        };
      await this.sleep(TIKTOK_CONSTANTS.POLL_MS);
    }
    return { done: false, status: last };
  }
}
