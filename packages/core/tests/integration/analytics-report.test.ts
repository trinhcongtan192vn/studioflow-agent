// 054 · FR-AP-11 — thu số liệu YouTube Analytics vào SQLite, báo cáo ngày theo lịch (idempotent, chịu khởi động lại),
// /report, IPC report.*, tool report.get. Mạng giả: fakeGoogle + fakeTelegramApi.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CoreHost, MemorySecretStore, type AgentRuntime } from '../../src/index.js';
import { setChannelAutopilot } from '../../src/autopilot/index.js';
import {
  channelDays,
  lastFetchedAt,
  latestVideoStats,
  videoViews,
} from '../../src/analytics/index.js';
import { ytTokenSecret } from '../../src/publish/oauth.js';
import { WriteStore } from '../../src/store/writer.js';
import { copyChannel, fixtureAppData, tempDir } from '../domain-helpers.js';
import { workflowFixtures } from '../workflow-helpers.js';
import { fakeGoogle, fakeTelegramApi } from '../publish-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const GROUP = -100777;
const TOKEN = '123456789:AAEhBP0av28gXAAxxxxxxxxxxxxxxxxxxxx';
const DATE = '2026-10-07';
const VID = 'yt_vid_001';
const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const idleRuntime: AgentRuntime = {
  id: 'fake',
  authStatus: async () => ({ ok: true, method: 'claude-plan' }),
  openSession: async () => {
    throw new Error('không dùng');
  },
};

/** Giờ giả (UTC); `publish.timezone` mặc định của fixture là Asia/Ho_Chi_Minh (UTC+7). */
const clock = { now: new Date('2026-10-07T03:00:00Z') };

function plan(channelId: string) {
  return {
    schema_version: 1,
    channel_id: channelId,
    date: DATE,
    generated_at: clock.now.toISOString(),
    capacity: { videos: 2, limiting_factor: 'cap', reasons: [] },
    items: [
      {
        id: 'pi_a0000001',
        status: 'produced',
        candidate_id: 'yt:a1',
        title: 'Năm 1428: Lê Lợi lên ngôi',
        angle: 'g',
        source: { kind: 'trend' },
        workflow_id: 'narrated-explainer',
        output_profile: 'yt-1080p30',
        publish_at: '2026-10-07T21:00:00+07:00',
        platforms: ['youtube'],
        score: 80,
        reasons: [],
        publish: { youtube: { status: 'public', video_id: VID, url: `https://youtu.be/${VID}` } },
      },
    ],
  };
}

function setup(o: { connected?: boolean; app?: string; settings?: Record<string, unknown> } = {}) {
  clock.now = new Date('2026-10-07T03:00:00Z');
  const c = copyChannel();
  const t = o.app ? { dir: o.app, cleanup: () => {} } : tempDir('app-');
  if (!o.app) {
    const settings = JSON.parse(readFileSync(path.join(fixtureAppData, 'settings.json'), 'utf8'));
    Object.assign(settings.config, o.settings ?? {});
    writeFileSync(path.join(t.dir, 'settings.json'), JSON.stringify(settings));
  }
  const channelId = JSON.parse(readFileSync(path.join(c.dir, 'channel.json'), 'utf8')).id as string;
  const g = fakeGoogle();
  g.analytics.channel = {
    '2026-09-30': 100,
    '2026-10-01': 100,
    '2026-10-02': 100,
    '2026-10-03': 100,
    '2026-10-04': 100,
    '2026-10-05': 100,
    '2026-10-06': 130,
  };
  g.analytics.videos[VID] = { '2026-10-05': 40, '2026-10-06': 60 };
  g.analytics.stats[VID] = { view: 1234, like: 56, comment: 7 };
  const tg = fakeTelegramApi(GROUP);
  const secrets = new MemorySecretStore({
    youtube_oauth_client_id: 'cid',
    youtube_oauth_client_secret: 'csecret',
    telegram_bot_token: TOKEN,
  });
  const host = new CoreHost({
    appDataDir: t.dir,
    workflowDirs: [workflowFixtures],
    runtime: idleRuntime,
    secrets,
    publishFetch: g.fetch,
    publishSleep: async () => {},
    telegramFetch: tg.f as never,
    telegramSleep: async () => {},
    clock: () => clock.now,
    permissionTimeoutMs: 300,
  });
  // đóng mọi host trước khi xóa thư mục (host khởi động lại dùng chung app-data — Windows khóa file DB đang mở)
  cleanups.unshift(() => host.close());
  cleanups.push(c.cleanup, t.cleanup);
  return {
    host,
    g,
    tg,
    secrets,
    dir: c.dir,
    app: t.dir,
    channelId,
    connected: o.connected !== false,
  };
}

async function ready(o: Parameters<typeof setup>[0] = {}) {
  const s = setup(o);
  await s.host.call('channel.open', { channel: s.dir });
  setChannelAutopilot(new WriteStore(s.dir), 'autopilot.enabled', true);
  if (s.connected) await s.secrets.set(ytTokenSecret(s.channelId), 'rt_stored');
  mkdirSync(path.join(s.dir, 'autopilot', 'plans'), { recursive: true });
  writeFileSync(
    path.join(s.dir, 'autopilot', 'plans', `${DATE}.json`),
    JSON.stringify(plan(s.channelId)),
  );
  await s.host.call('settings.set', { key: 'telegram.chat_id', value: String(GROUP) });
  await s.host.call('settings.set', { key: 'telegram.enabled', value: true });
  await botUp(s.host);
  return s;
}
const botUp = async (host: CoreHost) => {
  for (let i = 0; i < 400; i++) {
    if ((await host.telegram.status()).state === 'running') return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('bot không chạy');
};
const reports = (s: { tg: ReturnType<typeof fakeTelegramApi> }) =>
  s.tg.sent.filter((m) => m.text.includes('báo cáo'));
const reportFile = (dir: string) => path.join(dir, 'autopilot', 'reports', `${DATE}.json`);

describe('collector', () => {
  it('collects channel days, per-video days and cumulative stats; second call is fresh; force re-collects idempotently', async () => {
    const s = await ready();
    const col = s.host.core.metrics;
    const r1 = await col.collect(s.dir);
    expect(r1).toMatchObject({ collected: true, days: 7, videos: 1 });
    const db = s.host.core.db;
    const days = channelDays(db, s.channelId, 'youtube', '2026-09-30', '2026-10-06');
    expect(days).toHaveLength(7);
    expect(days.at(-1)).toMatchObject({ day: '2026-10-06', views: 130, subs_gained: 10 });
    expect(videoViews(db, s.channelId, 'youtube', '2026-09-30', '2026-10-06')).toEqual([
      { video_ref: VID, views: 100 },
    ]);
    expect(latestVideoStats(db, s.channelId, 'youtube')[0]).toMatchObject({
      video_ref: VID,
      view_count: 1234,
    });
    expect(lastFetchedAt(db, s.channelId, 'youtube')).toBe(clock.now.toISOString());
    const calls = s.g.to(/youtubeanalytics/).length;
    expect(await col.collect(s.dir)).toEqual({ collected: false, reason: 'fresh' });
    expect(s.g.to(/youtubeanalytics/)).toHaveLength(calls);
    // quá 6 giờ → thu lại; ghi đè theo khóa nên không nhân đôi hàng
    clock.now = new Date('2026-10-07T10:00:00Z');
    expect((await col.collect(s.dir)).collected).toBe(true);
    expect(channelDays(db, s.channelId, 'youtube', '2026-09-30', '2026-10-06')).toHaveLength(7);
    // uses channel token only; API calls carry the bearer, never the refresh token
    expect(JSON.stringify(s.g.calls.map((c) => c.headers))).not.toContain('rt_stored');
  });

  it('a failing video does not break the collection; not-connected channels are skipped', async () => {
    const s = await ready();
    s.g.analytics.failVideo = VID;
    const r = await s.host.core.metrics.collect(s.dir);
    expect(r).toMatchObject({ collected: true, days: 7, videos: 0 });
    const n = await ready({ connected: false });
    expect(await n.host.core.metrics.collect(n.dir)).toEqual({
      collected: false,
      reason: 'not_connected',
    });
    expect(n.g.to(/youtubeanalytics/)).toHaveLength(0);
  });
});

describe('scheduled daily report', () => {
  it('not before report.time; at 21:00 local sends once to the group, marks delivered; later ticks do not resend', async () => {
    const s = await ready();
    await s.host.core.autopilot.tick();
    expect(reports(s)).toHaveLength(0);
    expect(existsSync(reportFile(s.dir))).toBe(false);
    clock.now = new Date('2026-10-07T14:05:00Z'); // 21:05 giờ Việt Nam
    await s.host.core.autopilot.tick();
    expect(reports(s)).toHaveLength(1);
    const msg = reports(s)[0]!;
    expect(String(msg.chat_id)).toBe(String(GROUP));
    expect(msg.parse_mode).toBe('HTML');
    expect(msg.text).toContain('↑ 30% so với hôm trước');
    expect(msg.text).toContain('Năm 1428: Lê Lợi lên ngôi');
    const file = JSON.parse(readFileSync(reportFile(s.dir), 'utf8'));
    expect(file).toMatchObject({ date: DATE, delivered_at: clock.now.toISOString() });
    expect(file.youtube.views).toBe(130);
    await s.host.core.autopilot.tick();
    await s.host.core.autopilot.tick();
    expect(reports(s)).toHaveLength(1);
    // đọc qua IPC
    const latest = await s.host.call('report.latest', { channel: s.dir });
    expect(latest.reports[0]).toMatchObject({ date: DATE });
    // không nhúng token vào báo cáo/log
    expect(readFileSync(reportFile(s.dir), 'utf8')).not.toMatch(/rt_stored|AAEhBP0av28g/);
  });

  it('still runs while Autopilot is paused (report is read-only)', async () => {
    const s = await ready();
    await s.host.call('settings.set', { key: 'autopilot.paused', value: true });
    clock.now = new Date('2026-10-07T14:05:00Z');
    await s.host.core.autopilot.tick();
    expect(reports(s)).toHaveLength(1);
  });

  it('survives restart: a new host on the same app data does not resend a delivered report', async () => {
    const s = await ready();
    clock.now = new Date('2026-10-07T14:05:00Z');
    await s.host.core.autopilot.tick();
    expect(reports(s)).toHaveLength(1);
    const again = setup({ app: s.app });
    // cùng dữ liệu kênh: dùng lại thư mục kênh của host cũ
    expect(again.app).toBe(s.app);
    await again.host.call('channel.open', { channel: s.dir });
    setChannelAutopilot(new WriteStore(s.dir), 'autopilot.enabled', true);
    clock.now = new Date('2026-10-07T15:00:00Z');
    await again.host.core.autopilot.tick();
    expect(reports(again)).toHaveLength(0);
  });

  it('undelivered (Telegram off) keeps the file without delivered_at and sends when Telegram is back', async () => {
    const s = await ready();
    await s.host.call('settings.set', { key: 'telegram.enabled', value: false });
    clock.now = new Date('2026-10-07T14:05:00Z');
    await s.host.core.autopilot.tick();
    expect(reports(s)).toHaveLength(0);
    expect(JSON.parse(readFileSync(reportFile(s.dir), 'utf8')).delivered_at).toBeUndefined();
    await s.host.call('settings.set', { key: 'telegram.enabled', value: true });
    await botUp(s.host);
    await s.host.core.autopilot.tick();
    expect(reports(s)).toHaveLength(1);
    expect(JSON.parse(readFileSync(reportFile(s.dir), 'utf8')).delivered_at).toBeTruthy();
  });

  it('report.enabled=false sends nothing; report.time follows the channel timezone and validates input', async () => {
    const s = await ready({ settings: { 'report.enabled': false } });
    clock.now = new Date('2026-10-07T14:05:00Z');
    await s.host.core.autopilot.tick();
    expect(reports(s)).toHaveLength(0);
    await s.host.call('settings.set', { key: 'report.enabled', value: true });
    await s.host.call('settings.set', { key: 'report.time', value: '23:30' });
    await s.host.core.autopilot.tick();
    expect(reports(s)).toHaveLength(0); // 21:05 < 23:30
    clock.now = new Date('2026-10-07T16:31:00Z'); // 23:31
    await s.host.core.autopilot.tick();
    expect(reports(s)).toHaveLength(1);
    await expect(
      s.host.call('settings.set', { key: 'report.time', value: '9pm' }),
    ).rejects.toThrow();
    await expect(
      s.host.call('settings.set', { key: 'report.enabled', value: 'x' }),
    ).rejects.toThrow();
  });

  it('a Google outage still produces a report with a note (no throw)', async () => {
    const s = await ready();
    s.g.inject = (c) =>
      /youtubeanalytics/.test(c.url) ? new Response('boom', { status: 500 }) : undefined;
    clock.now = new Date('2026-10-07T14:05:00Z');
    await s.host.core.autopilot.tick();
    expect(reports(s)).toHaveLength(1);
    expect(reports(s)[0]!.text).toMatch(/lỗi/);
  });
});

describe('on demand', () => {
  it('/report in the group replies with the report without marking it delivered', async () => {
    const s = await ready();
    s.tg.say('/report');
    await until(() => reports(s).length >= 1);
    expect(reports(s)[0]!.text).toContain('Năm 1428');
    expect(existsSync(reportFile(s.dir))).toBe(false);
  });

  it('IPC report.run returns structured reports (+ optional send); report.get tool is available to main and ops', async () => {
    const s = await ready();
    const r = await s.host.call('report.run', { channel: s.dir });
    expect(r.reports[0]).toMatchObject({ date: DATE, production: { produced: 1 } });
    expect(r.text).toContain('báo cáo 07/10');
    expect(reports(s)).toHaveLength(0);
    await s.host.call('report.run', { channel: s.dir, send: true });
    expect(reports(s)).toHaveLength(1);
    const g = s.host.core.gateway;
    expect(g.list('main').map((t) => t.name)).toContain('report.get');
    expect(g.list('ops').map((t) => t.name)).toContain('report.get');
    expect(g.list('producer').map((t) => t.name)).not.toContain('report.get');
    const out = await s.host.core.reports.get(s.dir);
    expect(out.youtube.views).toBe(130);
    await expect(s.host.core.reports.get(s.dir, '2026-01-01')).rejects.toThrow();
  });
});
