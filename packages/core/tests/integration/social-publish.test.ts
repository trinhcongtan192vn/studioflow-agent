// 056 · FR-AP-10 — TikTok (FILE_UPLOAD) và Facebook Page Reels qua khung bộ đăng chung: chỉ video dọc, SELF_ONLY khi chưa
// kiểm duyệt, hẹn giờ Facebook, hủy / đăng ngay, tiếp tục không tải trùng, thử lại, không rò token. Mạng giả.
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CoreHost, MemorySecretStore, type AgentRuntime } from '../../src/index.js';
import { setChannelAutopilot } from '../../src/autopilot/index.js';
import { setConfig } from '../../src/config/resolve.js';
import { WriteStore } from '../../src/store/writer.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';
import { fakeFacebook, fakeTikTok, graphError, tiktokError } from '../social-helpers.js';
import { fakeTelegramApi } from '../publish-helpers.js';
import { workflowFixtures } from '../workflow-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const NOW = new Date('2026-10-07T03:00:00Z');
const DATE = '2026-10-07';
const ITEM = 'pi_a0000001';
const GROUP = -100777;
const TT_TOKEN = 'act.tiktokSECRETtoken0123456789abcdef';
const FB_TOKEN = 'EAAGsecretFacebookPageToken0123456789';
const BOT = '123456789:AAEhBP0av28gXAAxxxxxxxxxxxxxxxxxxxx';
const MiB = 1024 * 1024;
const idleRuntime: AgentRuntime = {
  id: 'fake',
  authStatus: async () => ({ ok: true, method: 'claude-plan' }),
  openSession: async () => {
    throw new Error('không dùng');
  },
};
const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

type Opts = {
  profile?: string;
  tiktokAudited?: boolean;
  platforms?: string[];
  publishAt?: string | null;
  sizeBytes?: number;
  fbPage?: boolean;
  connect?: ('tiktok' | 'facebook')[];
};

async function setup(o: Opts = {}) {
  const c = copyChannel();
  const t = tempDir('app-');
  const settings = JSON.parse(readFileSync(path.join(fixtureAppData, 'settings.json'), 'utf8'));
  settings.config['publish.tiktok.audited'] = o.tiktokAudited === true;
  writeFileSync(path.join(t.dir, 'settings.json'), JSON.stringify(settings));
  const channelId = JSON.parse(readFileSync(path.join(c.dir, 'channel.json'), 'utf8')).id as string;
  const tt = fakeTikTok();
  const fb = fakeFacebook();
  const both: typeof tt.fetch = (url, init) =>
    /tiktok/.test(url) ? tt.fetch(url, init) : fb.fetch(url, init);
  const tg = fakeTelegramApi(GROUP);
  const secrets = new MemorySecretStore({ telegram_bot_token: BOT });
  const sleeps: number[] = [];
  const host = new CoreHost({
    appDataDir: t.dir,
    workflowDirs: [workflowFixtures],
    runtime: idleRuntime,
    secrets,
    publishFetch: both,
    publishSleep: async (ms) => void sleeps.push(ms),
    telegramFetch: tg.f as never,
    telegramSleep: async () => {},
    clock: () => NOW,
    permissionTimeoutMs: 300,
  });
  cleanups.push(() => host.close(), c.cleanup, t.cleanup);
  await host.call('channel.open', { channel: c.dir });
  setChannelAutopilot(new WriteStore(c.dir), 'autopilot.enabled', true);
  for (const p of o.connect ?? ['tiktok', 'facebook'])
    await secrets.set(`oauth:${p}:${channelId}`, p === 'tiktok' ? TT_TOKEN : FB_TOKEN);
  if (o.fbPage !== false)
    setConfig(new WriteStore(c.dir), 'publish.facebook.page_id', '1122334455', { tier: 'channel' });
  // seed: bản render phát hành + kế hoạch
  const rd = path.join(c.dir, 'videos', fixtureVideoId, 'renders', 'rd_rel00001');
  mkdirSync(rd, { recursive: true });
  const vf = path.join(rd, 'video.mp4');
  writeFileSync(vf, Buffer.alloc(o.sizeBytes && o.sizeBytes < 1 * MiB ? o.sizeBytes : 3000, 3));
  if (o.sizeBytes && o.sizeBytes >= MiB) truncateSync(vf, o.sizeBytes);
  writeFileSync(
    path.join(rd, 'render.json'),
    JSON.stringify({
      schema_version: 1,
      id: 'rd_rel00001',
      mode: 'release',
      output_profile: o.profile ?? 'yt-shorts-1080x1920',
      started_at: '2026-10-07T01:00:00Z',
      finished_at: '2026-10-07T01:05:00Z',
      status: 'done',
      file: 'renders/rd_rel00001/video.mp4',
      duration_ms: 2700,
      gate_results: [],
      index_hash: 'ff'.repeat(32),
    }),
  );
  mkdirSync(path.join(c.dir, 'autopilot', 'plans'), { recursive: true });
  writeFileSync(
    path.join(c.dir, 'autopilot', 'plans', `${DATE}.json`),
    JSON.stringify({
      schema_version: 1,
      channel_id: channelId,
      date: DATE,
      generated_at: NOW.toISOString(),
      capacity: { videos: 1, limiting_factor: 'cap', reasons: [] },
      items: [
        {
          id: ITEM,
          status: 'produced',
          candidate_id: 'yt:a1',
          title: 'Năm 1428: Lê Lợi lên ngôi',
          angle: 'g',
          source: { kind: 'trend' },
          workflow_id: 'shorts',
          output_profile: o.profile ?? 'yt-shorts-1080x1920',
          publish_at: o.publishAt === undefined ? '2026-10-07T21:00:00+07:00' : o.publishAt,
          platforms: o.platforms ?? ['tiktok', 'facebook'],
          score: 80,
          reasons: [],
          video_id: fixtureVideoId,
        },
      ],
    }),
  );
  await host.call('settings.set', { key: 'telegram.chat_id', value: String(GROUP) });
  await host.call('settings.set', { key: 'telegram.enabled', value: true });
  return { host, tt, fb, tg, secrets, dir: c.dir, app: t.dir, channelId, sleeps };
}
type S = Awaited<ReturnType<typeof setup>>;

const plan = (s: S) =>
  JSON.parse(readFileSync(path.join(s.dir, 'autopilot', 'plans', `${DATE}.json`), 'utf8')).items[0];
const log = (s: S) => {
  const f = path.join(s.dir, 'autopilot', 'log', `${DATE}.jsonl`);
  try {
    return readFileSync(f, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
function allText(dir: string): string {
  let out = '';
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    const st = statSync(f);
    if (st.isDirectory()) out += allText(f);
    else if (st.size < 1_000_000) out += readFileSync(f, 'utf8');
  }
  return out;
}

describe('TikTok', () => {
  it('not audited: FILE_UPLOAD init → one chunk → status poll; SELF_ONLY, private state with a Vietnamese note', async () => {
    const s = await setup({ platforms: ['tiktok'] });
    await s.host.core.publisher.process(NOW);
    const init = s.tt.to(/video\/init/)[0]!;
    expect(init.headers.authorization).toBe(`Bearer ${TT_TOKEN}`);
    expect(init.body).toMatchObject({
      post_info: { title: 'Năm 1428: Lê Lợi lên ngôi', privacy_level: 'SELF_ONLY' },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: 3000,
        chunk_size: 3000,
        total_chunk_count: 1,
      },
    });
    expect(s.tt.to(/upload\.tiktok\.fake/).map((c) => c.headers['content-range'])).toEqual([
      'bytes 0-2999/3000',
    ]);
    expect(s.tt.to(/status\/fetch/)).toHaveLength(2);
    expect(plan(s).publish.tiktok).toMatchObject({
      status: 'private',
      video_id: s.tt.publishId,
      attempts: 1,
    });
    expect(plan(s).publish.tiktok.note).toMatch(/chưa được kiểm duyệt/);
    expect(plan(s).publish.tiktok.publish_at).toBeUndefined();
    expect(log(s).some((l) => l.event === 'publish.private' && l.data?.platform === 'tiktok')).toBe(
      true,
    );
  });

  it('a 25 MiB video goes in 10 MiB chunks, the last one takes the remainder', async () => {
    const s = await setup({ platforms: ['tiktok'], sizeBytes: 25 * MiB });
    await s.host.core.publisher.process(NOW);
    expect(s.tt.to(/video\/init/)[0]!.body).toMatchObject({
      source_info: { video_size: 25 * MiB, chunk_size: 10 * MiB, total_chunk_count: 2 },
    });
    expect(s.tt.to(/upload\.tiktok\.fake/).map((c) => c.headers['content-range'])).toEqual([
      `bytes 0-${10 * MiB - 1}/${25 * MiB}`,
      `bytes ${10 * MiB}-${25 * MiB - 1}/${25 * MiB}`,
    ]);
  });

  it('a 503 on a chunk is retried with backoff; the video is not initialised twice', async () => {
    const s = await setup({ platforms: ['tiktok'] });
    let failed = 0;
    s.tt.inject = (c) =>
      /upload\.tiktok\.fake/.test(c.url) && failed++ < 2
        ? new Response('x', { status: 503 })
        : undefined;
    await s.host.core.publisher.process(NOW);
    expect(s.tt.to(/video\/init/)).toHaveLength(1);
    expect(s.tt.to(/upload\.tiktok\.fake/)).toHaveLength(3);
    expect(s.sleeps).toEqual(expect.arrayContaining([1000, 2000]));
    expect(plan(s).publish.tiktok.status).toBe('private');
  });

  it('still processing after the poll budget → failed(attempt 1) keeping publish_id; next pass only polls (no second init/upload)', async () => {
    const s = await setup({ platforms: ['tiktok'] });
    s.tt.statuses = [{ status: 'PROCESSING_UPLOAD' }];
    await s.host.core.publisher.process(NOW);
    expect(plan(s).publish.tiktok).toMatchObject({
      status: 'failed',
      attempts: 1,
      video_id: s.tt.publishId,
    });
    expect(plan(s).publish.tiktok.error).toMatch(/đang xử lý/);
    s.tt.statuses = [{ status: 'PUBLISH_COMPLETE', ids: ['7300000000000000001'] }];
    await s.host.core.publisher.process(NOW);
    expect(s.tt.to(/video\/init/)).toHaveLength(1);
    expect(s.tt.to(/upload\.tiktok\.fake/)).toHaveLength(1);
    expect(plan(s).publish.tiktok).toMatchObject({
      status: 'private',
      video_id: '7300000000000000001',
      attempts: 2,
    });
  });

  it('FAILED from TikTok and an invalid token are reported in Vietnamese; 3 attempts then stop', async () => {
    const s = await setup({ platforms: ['tiktok'] });
    s.tt.statuses = [{ status: 'FAILED', fail_reason: 'file_format_check_failed' }];
    await s.host.core.publisher.process(NOW);
    expect(plan(s).publish.tiktok.error).toMatch(/file_format_check_failed/);
    const s2 = await setup({ platforms: ['tiktok'] });
    s2.tt.inject = (c) =>
      /video\/init/.test(c.url) ? tiktokError(401, 'access_token_invalid') : undefined;
    await s2.host.core.publisher.process(NOW);
    expect(plan(s2).publish.tiktok).toMatchObject({ status: 'failed' });
    expect(plan(s2).publish.tiktok.error).toMatch(/dán token mới/);
    expect(plan(s2).publish.tiktok.error).not.toContain(TT_TOKEN);
  });

  it('audited: waits until the publish time (pending, nothing uploaded), then posts PUBLIC_TO_EVERYONE', async () => {
    const s = await setup({ platforms: ['tiktok'], tiktokAudited: true });
    await s.host.core.publisher.process(NOW);
    expect(s.tt.calls).toHaveLength(0);
    expect(plan(s).publish.tiktok).toMatchObject({ status: 'pending' });
    expect(plan(s).publish.tiktok.note).toMatch(/Chờ tới/);
    const later = new Date('2026-10-07T14:00:30Z'); // 21:00:30 giờ VN
    await s.host.core.publisher.process(later);
    expect(s.tt.to(/video\/init/)[0]!.body).toMatchObject({
      post_info: { privacy_level: 'PUBLIC_TO_EVERYONE' },
    });
    expect(plan(s).publish.tiktok.status).toBe('public');
  });

  it('cancel keeps the post private with an honest note; publish.now explains instead of failing', async () => {
    const s = await setup({ platforms: ['tiktok'] });
    await s.host.core.publisher.process(NOW);
    const now = await s.host.call('publish.now', {
      channel: s.dir,
      date: DATE,
      item_id: ITEM,
      platform: 'tiktok',
    });
    expect(now.status).toBe('private');
    expect(now.note).toMatch(/app TikTok/);
    const r = await s.host.call('publish.cancel', {
      channel: s.dir,
      date: DATE,
      item_id: ITEM,
      platform: 'tiktok',
    });
    expect(r.status).toBe('cancelled');
    expect(r.note).toMatch(/riêng tư/);
  });
});

describe('Facebook Reels', () => {
  it('start → upload (offset/file_size, OAuth header) → finish SCHEDULED at max(plan slot, upload + veto)', async () => {
    const s = await setup({ platforms: ['facebook'] });
    await s.host.core.publisher.process(NOW);
    expect(s.fb.to(/video_reels$/)[0]!.body).toEqual({ upload_phase: 'start' });
    expect(s.fb.to(/video_reels$/)[0]!.headers.authorization).toBe(`OAuth ${FB_TOKEN}`);
    const up = s.fb.to(/rupload/)[0]!;
    expect(up.headers).toMatchObject({ offset: '0', file_size: '3000' });
    const fin = s.fb.to(/video_reels$/)[1]!.body as Record<string, unknown>;
    // 21:00 VN = 14:00Z; veto mặc định (giờ) từ 03:00Z không vượt quá → giờ trong kế hoạch
    expect(fin).toMatchObject({
      upload_phase: 'finish',
      video_id: s.fb.videoId,
      video_state: 'SCHEDULED',
      scheduled_publish_time: Date.parse('2026-10-07T14:00:00Z') / 1000,
    });
    expect(plan(s).publish.facebook).toMatchObject({
      status: 'scheduled',
      video_id: s.fb.videoId,
      publish_at: '2026-10-07T14:00:00.000Z',
      url: `https://www.facebook.com/reel/${s.fb.videoId}`,
    });
  });

  it('veto window pushes the slot later; a past slot is clamped to at least 11 minutes ahead', async () => {
    const s = await setup({ platforms: ['facebook'], publishAt: '2026-10-07T03:01:00Z' });
    await s.host.core.publisher.process(NOW);
    const t = (s.fb.to(/video_reels$/)[1]!.body as { scheduled_publish_time: number })
      .scheduled_publish_time;
    expect(t * 1000).toBeGreaterThanOrEqual(NOW.getTime() + 11 * 60_000);
    expect(t * 1000).toBeGreaterThanOrEqual(NOW.getTime() + 60_000); // ≥ veto_hours
  });

  it('refresh turns scheduled into public once Facebook reports it published; publish.now / cancel via IPC', async () => {
    const s = await setup({ platforms: ['facebook'] });
    await s.host.core.publisher.process(NOW);
    s.fb.published.value = true;
    await s.host.core.publisher.process(NOW);
    expect(plan(s).publish.facebook.status).toBe('public');
    expect(log(s).some((l) => l.event === 'publish.public')).toBe(true);

    const s2 = await setup({ platforms: ['facebook'] });
    await s2.host.core.publisher.process(NOW);
    const now = await s2.host.call('publish.now', {
      channel: s2.dir,
      date: DATE,
      item_id: ITEM,
      platform: 'facebook',
    });
    expect(now.status).toBe('public');
    expect(s2.fb.to(/graph\.facebook\.com.*\/\d+$/).find((c) => c.method === 'POST')!.body).toEqual(
      { is_published: true },
    );

    const s3 = await setup({ platforms: ['facebook'] });
    await s3.host.core.publisher.process(NOW);
    const c = await s3.host.call('publish.cancel', {
      channel: s3.dir,
      date: DATE,
      item_id: ITEM,
      platform: 'facebook',
    });
    expect(c.status).toBe('cancelled');
    expect(
      s3.fb.calls.some((x) => x.method === 'DELETE' && x.url.endsWith(`/${s3.fb.videoId}`)),
    ).toBe(true);
  });

  it('503 on the file upload is retried; token error 190 → clear Vietnamese error without the token', async () => {
    const s = await setup({ platforms: ['facebook'] });
    let n = 0;
    s.fb.inject = (c) =>
      /rupload/.test(c.url) && n++ < 2 ? new Response('x', { status: 503 }) : undefined;
    await s.host.core.publisher.process(NOW);
    expect(s.fb.to(/rupload/)).toHaveLength(3);
    expect(
      s.fb
        .to(/video_reels$/)
        .filter((c) => (c.body as { upload_phase?: string }).upload_phase === 'start'),
    ).toHaveLength(1);
    expect(plan(s).publish.facebook.status).toBe('scheduled');

    const bad = await setup({ platforms: ['facebook'] });
    bad.fb.inject = (c) =>
      /video_reels$/.test(c.url) ? graphError(400, 190, 'Invalid OAuth access token') : undefined;
    await bad.host.core.publisher.process(NOW);
    expect(plan(bad).publish.facebook.status).toBe('failed');
    expect(plan(bad).publish.facebook.error).toMatch(/dán token mới/);
    expect(plan(bad).publish.facebook.error).not.toContain(FB_TOKEN);
  });

  it('a retry after a crash between start and finish reuses the video_id (no second start)', async () => {
    const s = await setup({ platforms: ['facebook'] });
    s.fb.inject = (c) =>
      /rupload/.test(c.url) && !s.fb.calls.some((x) => /rupload/.test(x.url) && x !== c)
        ? graphError(400, 100, 'upload failed')
        : undefined;
    await s.host.core.publisher.process(NOW);
    expect(plan(s).publish.facebook).toMatchObject({ status: 'failed', video_id: s.fb.videoId });
    s.fb.inject = () => undefined;
    await s.host.core.publisher.process(NOW);
    const starts = s.fb
      .to(/video_reels$/)
      .filter((c) => (c.body as { upload_phase?: string }).upload_phase === 'start');
    expect(starts).toHaveLength(1);
    expect(plan(s).publish.facebook.status).toBe('scheduled');
  });
});

describe('eligibility, connection and Telegram', () => {
  it('horizontal video: both platforms skipped with a Vietnamese note, no network call', async () => {
    const s = await setup({ profile: 'yt-1080p30' });
    await s.host.core.publisher.process(NOW);
    expect(s.tt.calls).toHaveLength(0);
    expect(s.fb.calls).toHaveLength(0);
    expect(plan(s).publish.tiktok).toMatchObject({ status: 'cancelled' });
    expect(plan(s).publish.tiktok.note).toMatch(/Bỏ qua TikTok.*dọc 9:16/);
    expect(plan(s).publish.facebook.note).toMatch(/Bỏ qua Facebook Reels/);
    expect(log(s).filter((l) => l.event === 'publish.skipped')).toHaveLength(2);
  });

  it('not connected / no page id → pending with a hint; nothing is sent', async () => {
    const s = await setup({ connect: [], platforms: ['tiktok', 'facebook'] });
    await s.host.core.publisher.process(NOW);
    expect(plan(s).publish.tiktok).toMatchObject({ status: 'pending' });
    expect(plan(s).publish.tiktok.error).toMatch(/chưa kết nối TikTok/);
    expect(plan(s).publish.facebook.error).toMatch(/chưa kết nối Facebook/);
    expect(s.tt.calls.length + s.fb.calls.length).toBe(0);
  });

  it('YouTube is untouched when only vertical social platforms are listed; platforms run one after another', async () => {
    const s = await setup();
    const out = await s.host.core.publisher.process(NOW);
    expect(out.uploaded).toBe(2);
    expect(Object.keys(plan(s).publish).sort()).toEqual(['facebook', 'tiktok']);
  });

  it('Telegram preview per platform: TikTok private has only Hủy; Facebook scheduled has Hủy + Đăng ngay', async () => {
    const s = await setup();
    await until(() => true);
    await s.host.core.publisher.process(NOW);
    await until(() => s.tg.sent.filter((m) => m.reply_markup).length >= 2);
    const kb = s.tg.sent
      .filter((m) => m.reply_markup)
      .map((m) => m.reply_markup!.inline_keyboard[0]!.map((b) => b.callback_data));
    expect(kb).toContainEqual([`pub:c:tiktok:${ITEM}`]);
    expect(kb).toContainEqual([`pub:c:facebook:${ITEM}`, `pub:n:facebook:${ITEM}`]);
  });
});

describe('token connection (IPC) and secrecy', () => {
  it('set_token stores under oauth:<platform>:<channel_id>, status never returns the token, disconnect deletes; Facebook page_id lands in channel config', async () => {
    const s = await setup({ connect: [], fbPage: false });
    expect(await s.host.call('publish.tiktok.status', { channel: s.dir })).toEqual({
      connected: false,
      audited: false,
    });
    await s.host.call('publish.tiktok.set_token', { channel: s.dir, token: TT_TOKEN });
    expect(await s.secrets.get(`oauth:tiktok:${s.channelId}`)).toBe(TT_TOKEN);
    const st = await s.host.call('publish.tiktok.status', { channel: s.dir });
    expect(st).toEqual({ connected: true, audited: false });
    expect(JSON.stringify(st)).not.toContain(TT_TOKEN);
    await s.host.call('publish.facebook.set_token', {
      channel: s.dir,
      token: FB_TOKEN,
      page_id: '1122334455',
    });
    expect(await s.host.call('publish.facebook.status', { channel: s.dir })).toEqual({
      connected: true,
      page_id: '1122334455',
    });
    expect(
      JSON.parse(readFileSync(path.join(s.dir, 'channel.json'), 'utf8')).config[
        'publish.facebook.page_id'
      ],
    ).toBe('1122334455');
    await s.host.call('publish.tiktok.disconnect', { channel: s.dir });
    expect(await s.secrets.get(`oauth:tiktok:${s.channelId}`)).toBeUndefined();
  });

  it('rejects malformed tokens / page ids', async () => {
    const s = await setup({ connect: [] });
    for (const [method, params] of [
      ['publish.tiktok.set_token', { channel: s.dir, token: 'short' }],
      [
        'publish.tiktok.set_token',
        { channel: s.dir, token: 'has space inside the token value 123' },
      ],
      ['publish.facebook.set_token', { channel: s.dir, token: FB_TOKEN, page_id: 'abc' }],
    ] as const) {
      const r = await s.host.handle({ id: 1, method, params } as never);
      expect(r.error).toMatchObject({ code: 'E_SCHEMA_INVALID' });
    }
  });

  it('tokens never reach plan, logs, channel or app files, Telegram text or the ops log', async () => {
    const s = await setup();
    await s.host.core.publisher.process(NOW);
    await until(() => s.tg.sent.length >= 2);
    const blob = allText(s.dir) + allText(s.app) + JSON.stringify(s.tg.sent);
    for (const secret of [TT_TOKEN, FB_TOKEN]) expect(blob).not.toContain(secret);
    expect(JSON.stringify([...s.tt.calls, ...s.fb.calls].map((c) => c.url))).not.toMatch(
      /act\.tiktok|EAAG/,
    );
  });
});
