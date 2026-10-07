import { statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { SfError } from '../errors.js';
import { jsonOf, realFetch, sleepMs, type HttpFetch } from './http.js';
import { YT_UNITS, type QuotaLedger } from './quota.js';
import type { VideoMetadata } from './youtube-meta.js';

/**
 * Client YouTube Data API v3 cho việc đăng (053, D4 9.6): tải lên có thể tiếp tục, cập nhật trạng thái, phụ đề,
 * hình đại diện, kênh của token. Mọi lời gọi trừ vào sổ quota TRƯỚC khi gọi (Google tính cả lời gọi lỗi).
 */
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';
export const UPLOAD_CONSTANTS = {
  CHUNK: 8 * 1024 * 1024,
  CHUNK_RETRIES: 5,
  BACKOFF_MS: [1000, 2000, 4000, 8000, 16000],
} as const;

export interface YouTubeApiDeps {
  fetch?: HttpFetch;
  /** Access token; `force` = bỏ cache và làm mới (sau khi nhận 401). */
  token: (force?: boolean) => Promise<string>;
  quota: QuotaLedger;
  sleep?: (ms: number) => Promise<void>;
}

interface GoogleError {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
}

export class YouTubeApi {
  private readonly f: HttpFetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly d: YouTubeApiDeps) {
    this.f = d.fetch ?? realFetch;
    this.sleep = d.sleep ?? sleepMs;
  }

  private async fail(op: string, r: Response): Promise<never> {
    const j = await jsonOf<GoogleError>(r);
    const reason = j?.error?.errors?.[0]?.reason ?? '';
    const msg = (j?.error?.message ?? `HTTP ${r.status}`).slice(0, 200);
    const hint =
      reason === 'quotaExceeded' || reason === 'dailyLimitExceeded'
        ? ' — hết quota YouTube hôm nay, thử lại sau 0:00 giờ Thái Bình Dương'
        : reason === 'uploadLimitExceeded'
          ? ' — kênh đã chạm giới hạn số video tải lên trong ngày'
          : '';
    throw new SfError('E_PROVIDER_FAILED', `youtube ${op}: ${r.status} ${reason || msg}${hint}`);
  }

  /** Gọi có xác thực; 401 → làm mới token một lần. */
  private async authed(
    op: string,
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array },
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.d.token(attempt > 0);
      let r: Response;
      try {
        r = await this.f(url, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${token}` },
        });
      } catch {
        throw new SfError('E_PROVIDER_FAILED', `youtube ${op}: không kết nối được`);
      }
      if (r.status === 401 && attempt === 0) continue;
      return r;
    }
  }

  /** Kênh YouTube của token (`channels.list mine=true`, 1 đơn vị). */
  async channelsMine(): Promise<{ id: string; title: string }> {
    this.d.quota.add(YT_UNITS.LIST);
    const r = await this.authed('channels.list', `${API}/channels?part=snippet&mine=true`, {});
    if (!r.ok) return this.fail('channels.list', r);
    const j = await jsonOf<{ items?: { id: string; snippet?: { title?: string } }[] }>(r);
    const c = j?.items?.[0];
    if (!c) throw new SfError('E_PROVIDER_FAILED', 'tài khoản Google này chưa có kênh YouTube');
    return { id: c.id, title: c.snippet?.title ?? c.id };
  }

  /** Trạng thái video (`videos.list part=status`, 1 đơn vị); không thấy video → `undefined`. */
  async videoStatus(
    id: string,
  ): Promise<{ privacyStatus?: string; publishAt?: string; uploadStatus?: string } | undefined> {
    this.d.quota.add(YT_UNITS.LIST);
    const r = await this.authed(
      'videos.list',
      `${API}/videos?part=status&id=${encodeURIComponent(id)}`,
      {},
    );
    if (!r.ok) return this.fail('videos.list', r);
    const j = await jsonOf<{
      items?: { status?: { privacyStatus?: string; publishAt?: string; uploadStatus?: string } }[];
    }>(r);
    return j?.items?.[0]?.status;
  }

  /** Đổi trạng thái riêng tư/hẹn giờ (50 đơn vị). Bỏ `publishAt` = bỏ lịch. */
  async updateStatus(
    id: string,
    status: { privacyStatus: 'private' | 'public' | 'unlisted'; publishAt?: string },
  ): Promise<void> {
    this.d.quota.add(YT_UNITS.UPDATE);
    const r = await this.authed('videos.update', `${API}/videos?part=status`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        id,
        status: { ...status, selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
      }),
    });
    if (!r.ok) return this.fail('videos.update', r);
  }

  /** Phụ đề SRT (`captions.insert`, 400 đơn vị). */
  async insertCaption(
    videoId: string,
    c: { language: string; name: string; srt: string },
  ): Promise<void> {
    this.d.quota.add(YT_UNITS.CAPTION);
    const boundary = `sf${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({
      snippet: { videoId, language: c.language, name: c.name, isDraft: false },
    });
    const body =
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n${c.srt}\r\n--${boundary}--`;
    const r = await this.authed(
      'captions.insert',
      `${UPLOAD}/captions?uploadType=multipart&part=snippet`,
      {
        method: 'POST',
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    if (!r.ok) return this.fail('captions.insert', r);
  }

  /** Hình đại diện (`thumbnails.set`, 50 đơn vị). */
  async setThumbnail(
    videoId: string,
    bytes: Uint8Array,
    mime: 'image/jpeg' | 'image/png',
  ): Promise<void> {
    this.d.quota.add(YT_UNITS.THUMBNAIL);
    const r = await this.authed(
      'thumbnails.set',
      `${UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
      { method: 'POST', headers: { 'content-type': mime }, body: bytes },
    );
    if (!r.ok) return this.fail('thumbnails.set', r);
  }

  // ---------- tải video lên (resumable) ----------

  /** Đọc một khúc file (chỉ đọc). */
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

  /** Hỏi máy chủ đã nhận tới đâu: số byte (0 nếu chưa nhận gì) hoặc `done` khi đã xong. */
  private async probe(
    uri: string,
    total: number,
  ): Promise<{ offset: number } | { done: { id: string } } | { expired: true }> {
    let r: Response;
    try {
      r = await this.authed('upload.status', uri, {
        method: 'PUT',
        headers: { 'content-range': `bytes */${total}` },
      });
    } catch {
      return { offset: -1 };
    }
    if (r.status === 200 || r.status === 201) {
      const j = await jsonOf<{ id?: string }>(r);
      if (j?.id) return { done: { id: j.id } };
    }
    if (r.status === 404 || r.status === 410) return { expired: true };
    if (r.status === 308) return { offset: nextOffset(r) };
    return { offset: -1 };
  }

  /**
   * Tải `file` lên: tiếp tục phiên `sessionUri` nếu còn, không thì mở phiên mới (1600 đơn vị). Khúc lỗi mạng/5xx
   * được thử lại sau khi hỏi vị trí đã nhận; trả ID video.
   */
  async insertVideo(o: {
    file: string;
    metadata: VideoMetadata;
    sessionUri?: string;
    onSession?: (uri: string) => void;
    onProgress?: (sent: number, total: number) => void;
  }): Promise<{ id: string }> {
    const total = statSync(o.file).size;
    if (total <= 0) throw new SfError('E_PROVIDER_FAILED', 'file video rỗng');
    let uri = o.sessionUri;
    let offset = 0;
    if (uri) {
      const p = await this.probe(uri, total);
      if ('done' in p) return p.done;
      if ('expired' in p) uri = undefined;
      else offset = Math.max(0, p.offset);
    }
    if (!uri) {
      this.d.quota.add(YT_UNITS.INSERT);
      const r = await this.authed(
        'videos.insert',
        `${UPLOAD}/videos?uploadType=resumable&part=snippet,status`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=UTF-8',
            'x-upload-content-length': String(total),
            'x-upload-content-type': 'video/mp4',
          },
          body: JSON.stringify(o.metadata),
        },
      );
      if (!r.ok) return this.fail('videos.insert', r);
      uri = r.headers.get('location') ?? undefined;
      if (!uri)
        throw new SfError(
          'E_PROVIDER_FAILED',
          'youtube videos.insert: thiếu địa chỉ phiên tải lên',
        );
      o.onSession?.(uri);
      offset = 0;
    }
    let failures = 0;
    while (offset < total) {
      const len = Math.min(UPLOAD_CONSTANTS.CHUNK, total - offset);
      const body = await this.readChunk(o.file, offset, len);
      let r: Response | undefined;
      try {
        r = await this.authed('upload.chunk', uri, {
          method: 'PUT',
          headers: { 'content-range': `bytes ${offset}-${offset + len - 1}/${total}` },
          body,
        });
      } catch {
        r = undefined;
      }
      if (r && (r.status === 200 || r.status === 201)) {
        const j = await jsonOf<{ id?: string }>(r);
        if (j?.id) return { id: j.id };
        throw new SfError('E_PROVIDER_FAILED', 'youtube upload: phản hồi cuối thiếu ID video');
      }
      if (r && r.status === 308) {
        offset = nextOffset(r);
        failures = 0;
        o.onProgress?.(offset, total);
        continue;
      }
      if (r && r.status < 500 && r.status !== 429) return this.fail('upload', r);
      // lỗi mạng / 5xx / 429: lùi rồi hỏi vị trí đã nhận
      if (++failures > UPLOAD_CONSTANTS.CHUNK_RETRIES)
        throw new SfError(
          'E_PROVIDER_FAILED',
          `youtube upload: lỗi liên tục ở byte ${offset}/${total}`,
        );
      await this.sleep(UPLOAD_CONSTANTS.BACKOFF_MS[Math.min(failures, 5) - 1]!);
      const p = await this.probe(uri, total);
      if ('done' in p) return p.done;
      if ('expired' in p)
        throw new SfError(
          'E_PROVIDER_FAILED',
          'youtube upload: phiên tải lên đã hết hạn, sẽ tải lại từ đầu',
        );
      if (p.offset >= 0) offset = p.offset;
    }
    throw new SfError(
      'E_PROVIDER_FAILED',
      'youtube upload: đã gửi hết nhưng không nhận được ID video',
    );
  }
}

/** `Range: bytes=0-N` của phản hồi 308 → byte kế tiếp; không có Range = chưa nhận gì. */
function nextOffset(r: Response): number {
  const m = /bytes=0-(\d+)/.exec(r.headers.get('range') ?? '');
  return m ? Number(m[1]) + 1 : 0;
}
