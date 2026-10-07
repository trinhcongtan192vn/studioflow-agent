// 053 · FR-AP-09 — OAuth YouTube theo kênh: loopback + PKCE + state, đổi mã, làm mới token, thu hồi.
// Google giả; chỉ cổng loopback 127.0.0.1 là thật.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemorySecretStore } from '../../src/secrets/store.js';
import { YouTubeAuth, YT_SCOPES, ytTokenSecret } from '../../src/publish/oauth.js';
import { fakeGoogle } from '../publish-helpers.js';

const CH = 'ch_k3v9q2xa';
const clientSecrets = {
  youtube_oauth_client_id: 'cid.apps.googleusercontent.com',
  youtube_oauth_client_secret: 'csecret',
};

function rig(o: { secrets?: Record<string, string>; waitMs?: number; now?: () => number } = {}) {
  const g = fakeGoogle();
  const secrets = new MemorySecretStore({ ...clientSecrets, ...o.secrets });
  const auth = new YouTubeAuth({
    secrets,
    fetch: g.fetch,
    ...(o.waitMs ? { waitMs: o.waitMs } : {}),
    ...(o.now ? { now: o.now } : {}),
  });
  return { g, secrets, auth };
}
const params = (url: string) => new URL(url).searchParams;

describe('connect flow', () => {
  it('without OAuth client secrets → E_PROVIDER_UNAVAILABLE with instructions', async () => {
    const auth = new YouTubeAuth({ secrets: new MemorySecretStore(), fetch: fakeGoogle().fetch });
    await expect(auth.begin(CH)).rejects.toMatchObject({
      code: 'E_PROVIDER_UNAVAILABLE',
      message: expect.stringContaining('OAuth client'),
    });
  });

  it('auth URL: S256 PKCE, state, offline access, loopback redirect, all four scopes', async () => {
    const { auth } = rig();
    const { auth_url, done } = await auth.begin(CH);
    const p = params(auth_url);
    expect(auth_url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    expect(p.get('client_id')).toBe('cid.apps.googleusercontent.com');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/);
    expect(p.get('scope')!.split(' ')).toEqual(YT_SCOPES);
    expect(YT_SCOPES.map((s) => s.split('/').pop())).toEqual([
      'youtube.upload',
      'youtube.readonly',
      'yt-analytics.readonly',
      'youtube.force-ssl',
    ]);
    await auth.disconnect(CH); // đóng cổng
    await done.catch(() => {});
  });

  it('a callback with the wrong state is refused and the flow keeps waiting; the right one stores the refresh token', async () => {
    const { auth, g, secrets } = rig();
    const { auth_url, done } = await auth.begin(CH);
    const p = params(auth_url);
    const redirect = p.get('redirect_uri')!;
    const bad = await fetch(`${redirect}?state=wrong&code=evil`);
    expect(bad.status).toBe(400);
    expect(g.to(/oauth2\.googleapis\.com\/token/)).toHaveLength(0);
    expect(await secrets.get(ytTokenSecret(CH))).toBeUndefined();
    const ok = await fetch(`${redirect}?state=${p.get('state')}&code=AUTHCODE`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Đã kết nối YouTube');
    await done;
    const tok = g.to(/oauth2\.googleapis\.com\/token/);
    expect(tok).toHaveLength(1);
    const form = new URLSearchParams(tok[0]!.body as string);
    expect(form.get('code')).toBe('AUTHCODE');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('redirect_uri')).toBe(redirect);
    expect(form.get('client_secret')).toBe('csecret');
    // PKCE: code_verifier băm S256 phải ra đúng code_challenge đã gửi
    expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(
      p.get('code_challenge'),
    );
    expect(await secrets.get(ytTokenSecret(CH))).toBe('rt_initial');
    expect(await auth.connected(CH)).toBe(true);
    expect(await auth.accessToken(CH)).toBe('at_1'); // access token ở bộ nhớ, không gọi lại
    expect(g.tokens.n).toBe(1);
    // cổng đã đóng
    await expect(fetch(`${redirect}?state=${p.get('state')}&code=X`)).rejects.toThrow();
  });

  it('the user refusing consent → E_PERMISSION_DECLINED', async () => {
    const { auth } = rig();
    const { auth_url, done } = await auth.begin(CH);
    const p = params(auth_url);
    const r = await fetch(`${p.get('redirect_uri')}?state=${p.get('state')}&error=access_denied`);
    expect(r.status).toBe(200);
    await expect(done).rejects.toMatchObject({ code: 'E_PERMISSION_DECLINED' });
    expect(await auth.connected(CH)).toBe(false);
  });

  it('no consent within the wait → rejected and the port is closed', async () => {
    const { auth } = rig({ waitMs: 60 });
    const { auth_url, done } = await auth.begin(CH);
    await expect(done).rejects.toMatchObject({
      code: 'E_PERMISSION_DECLINED',
      message: expect.stringContaining('hết thời gian'),
    });
    await expect(fetch(params(auth_url).get('redirect_uri')!)).rejects.toThrow();
  });

  it('no refresh token from Google (consent already granted) → clear instructions', async () => {
    const { auth, g } = rig();
    g.tokens.refresh_token = undefined;
    const orig = g.fetch;
    const noRefresh: typeof g.fetch = async (u, i) => {
      const r = await orig(u, i);
      if (u.includes('/token')) {
        const j = await r.json();
        delete j.refresh_token;
        return new Response(JSON.stringify(j));
      }
      return r;
    };
    const a2 = new YouTubeAuth({ secrets: new MemorySecretStore(clientSecrets), fetch: noRefresh });
    const { auth_url, done } = await a2.begin(CH);
    const p = params(auth_url);
    await fetch(`${p.get('redirect_uri')}?state=${p.get('state')}&code=C`);
    await expect(done).rejects.toMatchObject({
      code: 'E_PROVIDER_FAILED',
      message: expect.stringContaining('refresh token'),
    });
    void auth;
  });

  it('a second begin for the same channel replaces the first', async () => {
    const { auth } = rig();
    const a = await auth.begin(CH);
    const b = await auth.begin(CH);
    await expect(a.done).rejects.toMatchObject({ code: 'E_PERMISSION_DECLINED' });
    expect(params(a.auth_url).get('redirect_uri')).not.toBe(params(b.auth_url).get('redirect_uri'));
    await auth.disconnect(CH);
    await b.done.catch(() => {});
  });
});

describe('access token', () => {
  it('refreshes with the stored refresh token once it is within 60 s of expiry', async () => {
    let t = 1_000_000;
    const { auth, g } = rig({ secrets: { [ytTokenSecret(CH)]: 'rt_stored' }, now: () => t });
    expect(await auth.accessToken(CH)).toBe('at_1');
    expect(await auth.accessToken(CH)).toBe('at_1');
    t += 3600_000 - 30_000; // còn 30 s → làm mới
    expect(await auth.accessToken(CH)).toBe('at_2');
    expect(g.tokens.n).toBe(2);
    const form = new URLSearchParams(g.to(/token/)[0]!.body as string);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('rt_stored');
    expect(await auth.accessToken(CH, true)).toBe('at_3'); // ép làm mới (sau 401)
  });
  it('a rotated refresh token is stored', async () => {
    const { auth, g, secrets } = rig({ secrets: { [ytTokenSecret(CH)]: 'old' } });
    g.tokens.refresh_token = 'new_rt';
    await auth.accessToken(CH);
    expect(await secrets.get(ytTokenSecret(CH))).toBe('new_rt');
  });
  it('invalid_grant: the secret is deleted and the user is told to reconnect', async () => {
    const { auth, g, secrets } = rig({ secrets: { [ytTokenSecret(CH)]: 'revoked' } });
    g.tokens.error = 'invalid_grant';
    await expect(auth.accessToken(CH)).rejects.toMatchObject({
      code: 'E_PROVIDER_UNAVAILABLE',
      message: expect.stringContaining('kết nối lại'),
    });
    expect(await secrets.get(ytTokenSecret(CH))).toBeUndefined();
  });
  it('not connected → E_PROVIDER_UNAVAILABLE', async () => {
    const { auth } = rig();
    await expect(auth.accessToken(CH)).rejects.toMatchObject({ code: 'E_PROVIDER_UNAVAILABLE' });
  });
  it('disconnect revokes at Google and deletes the secret; tokens never leak into errors', async () => {
    const { auth, g, secrets } = rig({ secrets: { [ytTokenSecret(CH)]: 'rt_secret_value' } });
    await auth.disconnect(CH);
    expect(g.to(/revoke/)).toHaveLength(1);
    expect(new URLSearchParams(g.to(/revoke/)[0]!.body as string).get('token')).toBe(
      'rt_secret_value',
    );
    expect(await secrets.get(ytTokenSecret(CH))).toBeUndefined();
    const e = (await auth.accessToken(CH).catch((x: Error) => x)) as Error;
    expect(e.message).not.toContain('rt_secret_value');
  });
});
