import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SfError } from '../errors.js';
import type { SecretStore } from '../secrets/store.js';
import { jsonOf, realFetch, type HttpFetch } from './http.js';

/**
 * OAuth YouTube theo kênh (053, D4 9.6): ứng dụng cài đặt, chuyển hướng loopback `127.0.0.1:<cổng ngẫu nhiên>`
 * + PKCE (S256) + `state`. Client id/secret là bí mật `youtube_oauth_client_id/secret`; refresh token mỗi kênh là
 * bí mật `oauth:youtube:<channel_id>`. Access token chỉ ở bộ nhớ.
 */
export const YT_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];
export const YT_CLIENT_ID_SECRET = 'youtube_oauth_client_id';
export const YT_CLIENT_SECRET_SECRET = 'youtube_oauth_client_secret';
export const ytTokenSecret = (channelId: string): string => `oauth:youtube:${channelId}`;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const OAUTH_CONSTANTS = { WAIT_MS: 5 * 60_000, REFRESH_MARGIN_MS: 60_000 } as const;

const b64url = (b: Buffer) => b.toString('base64url');

export interface YouTubeAuthDeps {
  secrets: SecretStore;
  fetch?: HttpFetch;
  now?: () => number;
  /** Chờ người dùng cấp quyền (test rút ngắn). */
  waitMs?: number;
}

interface Flow {
  server: Server;
  finish: (e?: Error) => void;
}

export class YouTubeAuth {
  private readonly f: HttpFetch;
  private readonly now: () => number;
  private readonly cache = new Map<string, { token: string; exp: number }>();
  private readonly flows = new Map<string, Flow>();

  constructor(private readonly d: YouTubeAuthDeps) {
    this.f = d.fetch ?? realFetch;
    this.now = d.now ?? Date.now;
  }

  private async client(): Promise<{ id: string; secret: string }> {
    const [id, secret] = await Promise.all([
      this.d.secrets.get(YT_CLIENT_ID_SECRET),
      this.d.secrets.get(YT_CLIENT_SECRET_SECRET),
    ]);
    if (!id || !secret)
      throw new SfError(
        'E_PROVIDER_UNAVAILABLE',
        'chưa có OAuth client YouTube (youtube_oauth_client_id / youtube_oauth_client_secret) — tạo "OAuth client ID" loại Desktop trong Google Cloud Console và nhập vào Cài đặt',
      );
    return { id, secret };
  }

  async connected(channelId: string): Promise<boolean> {
    return Boolean(await this.d.secrets.get(ytTokenSecret(channelId)));
  }

  /**
   * Bắt đầu kết nối: mở cổng loopback, trả `auth_url` để mở bằng trình duyệt; `done` xong khi người dùng cấp
   * quyền (refresh token đã lưu) hoặc lỗi (từ chối, hết 5 phút, `state` sai không làm hỏng luồng mà bị từ chối).
   */
  async begin(channelId: string): Promise<{ auth_url: string; done: Promise<void> }> {
    const { id, secret } = await this.client();
    this.flows
      .get(channelId)
      ?.finish(new SfError('E_PERMISSION_DECLINED', 'một lần kết nối mới đã thay lần trước'));
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = b64url(randomBytes(16));
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    const redirect = `http://127.0.0.1:${port}/oauth2callback`;

    let settle!: { ok: () => void; fail: (e: Error) => void };
    const done = new Promise<void>((ok, fail) => (settle = { ok, fail }));
    let closed = false;
    const timer = setTimeout(
      () => finish(new SfError('E_PERMISSION_DECLINED', 'hết thời gian chờ cấp quyền YouTube')),
      this.d.waitMs ?? OAUTH_CONSTANTS.WAIT_MS,
    );
    timer.unref?.();
    const finish = (e?: Error) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      this.flows.delete(channelId);
      server.closeAllConnections?.();
      server.close();
      if (e) settle.fail(e);
      else settle.ok();
    };
    this.flows.set(channelId, { server, finish });
    done.catch(() => {});

    const page = (title: string, body: string) =>
      `<!doctype html><meta charset="utf-8"><title>StudioFlow</title><body style="font:16px sans-serif;margin:3em"><h2>${title}</h2><p>${body}</p>`;
    server.on('request', (req, res) => {
      const u = new URL(req.url ?? '/', redirect);
      const send = (code: number, html: string) => {
        res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
        res.end(html);
      };
      if (u.pathname !== '/oauth2callback') return send(404, page('Không tìm thấy', ''));
      // chống giả mạo: `state` phải đúng; sai → từ chối nhưng vẫn chờ lần gọi đúng
      if (u.searchParams.get('state') !== state)
        return send(400, page('Yêu cầu không hợp lệ', 'Mã xác thực (state) không khớp.'));
      const err = u.searchParams.get('error');
      if (err) {
        send(200, page('Chưa kết nối', 'Bạn đã từ chối cấp quyền. Có thể đóng tab này.'));
        return finish(
          new SfError('E_PERMISSION_DECLINED', `YouTube từ chối cấp quyền (${err.slice(0, 40)})`),
        );
      }
      const code = u.searchParams.get('code');
      if (!code) return send(400, page('Yêu cầu không hợp lệ', 'Thiếu mã cấp quyền.'));
      void this.exchange({ code, verifier, redirect, id, secret, channelId }).then(
        () => {
          send(200, page('Đã kết nối YouTube', 'Có thể đóng tab này và quay lại StudioFlow.'));
          finish();
        },
        (e: Error) => {
          send(200, page('Chưa kết nối', 'Không đổi được mã cấp quyền. Thử lại trong StudioFlow.'));
          finish(e);
        },
      );
    });

    const q = new URLSearchParams({
      client_id: id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: YT_SCOPES.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    return { auth_url: `${AUTH_URL}?${q}`, done };
  }

  private async token(form: Record<string, string>): Promise<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  }> {
    let r: Response;
    try {
      r = await this.f(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      });
    } catch {
      throw new SfError('E_PROVIDER_FAILED', 'không kết nối được máy chủ OAuth của Google');
    }
    const j = (await jsonOf<Record<string, unknown>>(r)) ?? {};
    return j as never;
  }

  private async exchange(o: {
    code: string;
    verifier: string;
    redirect: string;
    id: string;
    secret: string;
    channelId: string;
  }): Promise<void> {
    const j = await this.token({
      code: o.code,
      client_id: o.id,
      client_secret: o.secret,
      redirect_uri: o.redirect,
      grant_type: 'authorization_code',
      code_verifier: o.verifier,
    });
    if (!j.access_token)
      throw new SfError(
        'E_PROVIDER_FAILED',
        `Google từ chối mã cấp quyền: ${j.error ?? 'không rõ'}`,
      );
    if (!j.refresh_token)
      throw new SfError(
        'E_PROVIDER_FAILED',
        'Google không cấp refresh token — gỡ quyền của StudioFlow tại myaccount.google.com/permissions rồi kết nối lại',
      );
    await this.d.secrets.set(ytTokenSecret(o.channelId), j.refresh_token);
    this.cache.set(o.channelId, {
      token: j.access_token,
      exp: this.now() + (j.expires_in ?? 3600) * 1000,
    });
  }

  /** Access token còn hạn (làm mới bằng refresh token khi còn < 60 s). */
  async accessToken(channelId: string, force = false): Promise<string> {
    const c = this.cache.get(channelId);
    if (!force && c && c.exp - this.now() > OAUTH_CONSTANTS.REFRESH_MARGIN_MS) return c.token;
    const refresh = await this.d.secrets.get(ytTokenSecret(channelId));
    if (!refresh)
      throw new SfError(
        'E_PROVIDER_UNAVAILABLE',
        'kênh chưa kết nối YouTube — kết nối trong Cài đặt kênh',
      );
    const { id, secret } = await this.client();
    const j = await this.token({
      refresh_token: refresh,
      client_id: id,
      client_secret: secret,
      grant_type: 'refresh_token',
    });
    if (!j.access_token) {
      this.cache.delete(channelId);
      if (j.error === 'invalid_grant') {
        // refresh token bị thu hồi/hết hạn: xóa để trạng thái "chưa kết nối" đúng
        await this.d.secrets.delete(ytTokenSecret(channelId));
        throw new SfError(
          'E_PROVIDER_UNAVAILABLE',
          'quyền YouTube đã bị thu hồi hoặc hết hạn — kết nối lại kênh',
        );
      }
      throw new SfError(
        'E_PROVIDER_FAILED',
        `không làm mới được token YouTube: ${j.error ?? 'không rõ'}`,
      );
    }
    if (j.refresh_token && j.refresh_token !== refresh)
      await this.d.secrets.set(ytTokenSecret(channelId), j.refresh_token);
    this.cache.set(channelId, {
      token: j.access_token,
      exp: this.now() + (j.expires_in ?? 3600) * 1000,
    });
    return j.access_token;
  }

  /** Ngắt kết nối: thu hồi ở Google (cố gắng tối đa) rồi xóa bí mật. */
  async disconnect(channelId: string): Promise<void> {
    this.flows.get(channelId)?.finish(new SfError('E_PERMISSION_DECLINED', 'đã ngắt kết nối'));
    const refresh = await this.d.secrets.get(ytTokenSecret(channelId));
    if (refresh) {
      try {
        await this.f(REVOKE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: refresh }).toString(),
        });
      } catch {
        /* thu hồi không được thì vẫn xóa token ở máy */
      }
      await this.d.secrets.delete(ytTokenSecret(channelId));
    }
    this.cache.delete(channelId);
  }

  /** Đóng mọi cổng loopback đang chờ (tắt app). */
  close(): void {
    for (const f of [...this.flows.values()])
      f.finish(new SfError('E_PERMISSION_DECLINED', 'app đang đóng'));
  }
}
