// 053 · FR-AP-09 — IPC publish.* của CoreHost, kết nối YouTube, tin xem trước Telegram với nút Hủy đăng / Đăng ngay.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CoreHost, MemorySecretStore, type AgentRuntime } from '../../src/index.js';
import { setChannelAutopilot } from '../../src/autopilot/index.js';
import { ytTokenSecret } from '../../src/publish/oauth.js';
import { WriteStore } from '../../src/store/writer.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';
import { workflowFixtures } from '../workflow-helpers.js';
import { fakeGoogle, fakeTelegramApi } from '../publish-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const NOW = new Date('2026-10-07T03:00:00Z');
const DATE = '2026-10-07';
const ITEM = 'pi_a0000001';
const GROUP = -100777;
const TOKEN = '123456789:AAEhBP0av28gXAAxxxxxxxxxxxxxxxxxxxx';
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

function setup(o: { audited?: boolean } = {}) {
  const c = copyChannel();
  const t = tempDir('app-');
  const settings = JSON.parse(readFileSync(path.join(fixtureAppData, 'settings.json'), 'utf8'));
  settings.config['publish.youtube.audited'] = o.audited === true;
  writeFileSync(path.join(t.dir, 'settings.json'), JSON.stringify(settings));
  const channelId = JSON.parse(readFileSync(path.join(c.dir, 'channel.json'), 'utf8')).id as string;
  const g = fakeGoogle();
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
    clock: () => NOW,
    permissionTimeoutMs: 300,
  });
  cleanups.push(() => host.close(), c.cleanup, t.cleanup);
  const events: [string, unknown][] = [];
  host.on('event', (n: string, d: unknown) => events.push([n, d]));
  return { host, g, tg, secrets, dir: c.dir, app: t.dir, channelId, events };
}

function seedProduced(dir: string, channelId: string) {
  const rd = path.join(dir, 'videos', fixtureVideoId, 'renders', 'rd_rel00001');
  mkdirSync(rd, { recursive: true });
  writeFileSync(path.join(rd, 'video.mp4'), Buffer.alloc(2000, 3));
  writeFileSync(
    path.join(rd, 'render.json'),
    JSON.stringify({
      schema_version: 1,
      id: 'rd_rel00001',
      mode: 'release',
      output_profile: 'yt-1080p30',
      started_at: '2026-10-07T01:00:00Z',
      finished_at: '2026-10-07T01:05:00Z',
      status: 'done',
      file: 'renders/rd_rel00001/video.mp4',
      duration_ms: 2700,
      gate_results: [],
      index_hash: 'ff'.repeat(32),
    }),
  );
  mkdirSync(path.join(dir, 'autopilot', 'plans'), { recursive: true });
  writeFileSync(
    path.join(dir, 'autopilot', 'plans', `${DATE}.json`),
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
          workflow_id: 'narrated-explainer',
          output_profile: 'yt-1080p30',
          publish_at: '2026-10-07T21:00:00+07:00',
          platforms: ['youtube'],
          score: 80,
          reasons: [],
          video_id: fixtureVideoId,
        },
      ],
    }),
  );
}

describe('YouTube connection through IPC', () => {
  it('connect → auth_url; the loopback callback stores the token, maps the YouTube channel, status shows the title; disconnect revokes', async () => {
    const s = setup();
    await s.host.call('channel.open', { channel: s.dir });
    expect(await s.host.call('publish.youtube.status', { channel: s.dir })).toMatchObject({
      connected: false,
      audited: false,
      quota: { used: 0, limit: 10000 },
    });
    const { auth_url } = await s.host.call('publish.youtube.connect', { channel: s.dir });
    const p = new URL(auth_url).searchParams;
    await fetch(`${p.get('redirect_uri')}?state=${p.get('state')}&code=AUTHCODE`);
    await until(() => s.events.some(([n]) => n === 'publish.updated'));
    expect(s.events.find(([n]) => n === 'publish.updated')![1]).toEqual({
      channel: path.resolve(s.dir),
    });
    expect(await s.secrets.get(ytTokenSecret(s.channelId))).toBe('rt_initial');
    expect(
      JSON.parse(readFileSync(path.join(s.dir, 'channel.json'), 'utf8')).config[
        'publish.youtube.channel_id'
      ],
    ).toBe(s.g.channel.id);
    expect(await s.host.call('publish.youtube.status', { channel: s.dir })).toMatchObject({
      connected: true,
      youtube_channel_id: s.g.channel.id,
      channel_title: 'Sử Kể Mẫu',
      quota: { used: 1, limit: 10000 },
    });
    expect(await s.host.call('publish.youtube.disconnect', { channel: s.dir })).toEqual({
      ok: true,
    });
    expect(await s.secrets.get(ytTokenSecret(s.channelId))).toBeUndefined();
    expect(s.g.to(/revoke/)).toHaveLength(1);
    expect(await s.host.call('publish.youtube.status', { channel: s.dir })).toMatchObject({
      connected: false,
    });
  });
  it('missing OAuth client → a clear error; the audited flag is reported', async () => {
    const s = setup({ audited: true });
    await s.secrets.delete('youtube_oauth_client_secret');
    const r = await s.host.handle({
      id: 1,
      method: 'publish.youtube.connect',
      params: { channel: s.dir },
    });
    expect(r.error).toMatchObject({ code: 'E_PROVIDER_UNAVAILABLE' });
    expect((await s.host.call('publish.youtube.status', { channel: s.dir })).audited).toBe(true);
  });
});

describe('Telegram preview with buttons', () => {
  async function uploaded(audited = true) {
    const s = setup({ audited });
    await s.host.call('channel.open', { channel: s.dir });
    setChannelAutopilot(new WriteStore(s.dir), 'autopilot.enabled', true);
    await s.secrets.set(ytTokenSecret(s.channelId), 'rt_stored');
    seedProduced(s.dir, s.channelId);
    await s.host.call('settings.set', { key: 'telegram.chat_id', value: String(GROUP) });
    await s.host.call('settings.set', { key: 'telegram.enabled', value: true });
    await until(() => s.tg.sent.length >= 0 && true);
    await s.host.core.publisher.process(NOW);
    await until(() => s.tg.sent.some((m) => m.reply_markup));
    return s;
  }
  const state = (s: Awaited<ReturnType<typeof uploaded>>) =>
    JSON.parse(readFileSync(path.join(s.dir, 'autopilot', 'plans', `${DATE}.json`), 'utf8'))
      .items[0].publish.youtube;

  it('the preview lands in the group with Hủy đăng / Đăng ngay; pressing Hủy cancels, answers the query and clears the buttons', async () => {
    const s = await uploaded();
    const msg = s.tg.sent.find((m) => m.reply_markup)!;
    expect(msg.chat_id).toBe(String(GROUP));
    expect(msg.parse_mode).toBe('HTML');
    expect(msg.text).toContain('Năm 1428: Lê Lợi lên ngôi');
    expect(msg.text).toContain('https://youtu.be/yt_vid_001');
    expect(msg.reply_markup!.inline_keyboard[0]!.map((b) => b.callback_data)).toEqual([
      `pub:c:youtube:${ITEM}`,
      `pub:n:youtube:${ITEM}`,
    ]);
    s.tg.press(`pub:c:youtube:${ITEM}`);
    await until(() => s.tg.answered.length > 0);
    expect(s.tg.answered[0]!.text).toContain('Đã hủy đăng');
    await until(() => s.tg.edited.length > 0);
    expect(state(s).status).toBe('cancelled');
    expect(s.g.to(/videos\?part=status$/)[0]!.body).toMatchObject({
      status: { privacyStatus: 'private' },
    });
  });

  it('pressing Đăng ngay publishes (audited); a user outside the allow-list gets an alert and nothing happens', async () => {
    const s = await uploaded();
    await s.host.call('settings.set', { key: 'telegram.allowed_user_ids', value: ['11'] });
    s.tg.press(`pub:n:youtube:${ITEM}`, { id: 99, first_name: 'Lạ' });
    await until(() => s.tg.answered.length > 0);
    expect(s.tg.answered[0]).toMatchObject({ show_alert: true });
    expect(state(s).status).toBe('scheduled');
    s.tg.press(`pub:n:youtube:${ITEM}`);
    await until(() => s.tg.answered.length > 1);
    expect(state(s).status).toBe('public');
  });

  it('not audited: Đăng ngay is absent from the keyboard; IPC publish.now explains instead of failing', async () => {
    const s = await uploaded(false);
    const msg = s.tg.sent.find((m) => m.reply_markup)!;
    expect(msg.reply_markup!.inline_keyboard[0]!.map((b) => b.callback_data)).toEqual([
      `pub:c:youtube:${ITEM}`,
    ]);
    const r = await s.host.call('publish.now', { channel: s.dir, date: DATE, item_id: ITEM });
    expect(r.status).toBe('private');
    expect(r.note).toMatch(/YouTube Studio/);
    expect(
      (await s.host.call('publish.cancel', { channel: s.dir, date: DATE, item_id: ITEM })).status,
    ).toBe('cancelled');
    const bad = await s.host.handle({
      id: 5,
      method: 'publish.cancel',
      params: { channel: s.dir, date: DATE, item_id: 'pi_zzzzzzzz' },
    });
    expect(bad.error).toMatchObject({ code: 'E_ID_UNKNOWN' });
  });

  it('the quota used by uploads shows in autopilot.capacity (upload_quota_left)', async () => {
    const s = await uploaded();
    const cap = await s.host.call('autopilot.capacity', { channels: [s.dir] });
    expect(cap.upload_quota_left).toBe(4); // (10000 − 2001) / 1600
  });
});
