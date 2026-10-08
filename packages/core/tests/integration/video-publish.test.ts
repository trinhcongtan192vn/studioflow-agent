// 091 · FR-PB-91-01..04 — bước `publish` của video làm tay: chờ người dùng chọn nền tảng, đăng ngay lên nhiều
// nền tảng cùng lúc (tiêu đề/mô tả/thẻ đi kèm), chạy lại chỉ thử nền tảng lỗi, Autopilot bỏ qua. Mạng giả.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CoreHost, MemorySecretStore, type AgentRuntime } from '../../src/index.js';
import { setConfig } from '../../src/config/resolve.js';
import { ytTokenSecret } from '../../src/publish/oauth.js';
import { WriteStore } from '../../src/store/writer.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';
import { fakeGoogle, googleError } from '../publish-helpers.js';
import { fakeFacebook, fakeTikTok } from '../social-helpers.js';
import { workflowFixtures } from '../workflow-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const NOW = new Date('2026-10-07T03:00:00Z');
const TT_TOKEN = 'act.tiktokSECRETtoken0123456789abcdef';
const FB_TOKEN = 'EAAGsecretFacebookPageToken0123456789';
const WAIT = 'waiting for you to choose where to publish';
const idleRuntime: AgentRuntime = {
  id: 'fake',
  authStatus: async () => ({ ok: true, method: 'claude-plan' }),
  openSession: async () => {
    throw new Error('không dùng');
  },
};
const until = async (cond: () => boolean, ms = 6000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

type Opts = {
  profile?: string;
  youtubeAudited?: boolean;
  tiktokAudited?: boolean;
  connect?: ('youtube' | 'tiktok' | 'facebook')[];
  autopilot?: boolean;
  platforms?: string[];
};

async function setup(o: Opts = {}) {
  const c = copyChannel();
  const t = tempDir('app-');
  const settings = JSON.parse(readFileSync(path.join(fixtureAppData, 'settings.json'), 'utf8'));
  settings.config['publish.youtube.audited'] = o.youtubeAudited === true;
  settings.config['publish.tiktok.audited'] = o.tiktokAudited === true;
  writeFileSync(path.join(t.dir, 'settings.json'), JSON.stringify(settings));
  const channelId = JSON.parse(readFileSync(path.join(c.dir, 'channel.json'), 'utf8')).id as string;
  const g = fakeGoogle();
  const tt = fakeTikTok();
  const fb = fakeFacebook();
  const fetch: typeof g.fetch = (url, init) =>
    /tiktok/.test(url)
      ? tt.fetch(url, init)
      : /facebook/.test(url)
        ? fb.fetch(url, init)
        : g.fetch(url, init);
  const connect = o.connect ?? ['youtube', 'tiktok', 'facebook'];
  const secrets = new MemorySecretStore({
    youtube_oauth_client_id: 'cid',
    youtube_oauth_client_secret: 'csecret',
    ...(connect.includes('youtube') ? { [ytTokenSecret(channelId)]: 'rt_stored' } : {}),
    ...(connect.includes('tiktok') ? { [`oauth:tiktok:${channelId}`]: TT_TOKEN } : {}),
    ...(connect.includes('facebook') ? { [`oauth:facebook:${channelId}`]: FB_TOKEN } : {}),
  });
  const host = new CoreHost({
    appDataDir: t.dir,
    workflowDirs: [workflowFixtures],
    runtime: idleRuntime,
    secrets,
    publishFetch: fetch,
    publishSleep: async () => {},
    clock: () => NOW,
    permissionTimeoutMs: 300,
  });
  cleanups.push(() => host.close(), c.cleanup, t.cleanup);
  await host.call('channel.open', { channel: c.dir });
  const store = new WriteStore(c.dir);
  setConfig(store, 'publish.facebook.page_id', '1122334455', { tier: 'channel' });
  if (o.platforms) setConfig(store, 'publish.platforms', o.platforms, { tier: 'channel' });
  const vdir = path.join(c.dir, 'videos', fixtureVideoId);
  // video đang ở workflow `publish-demo` (chỉ bước publish)
  const st = JSON.parse(readFileSync(path.join(vdir, 'state.json'), 'utf8'));
  st.workflow = { id: 'publish-demo', version: '1.0.0' };
  st.output_profile = o.profile ?? 'yt-1080p30';
  st.steps = {};
  st.approvals = [];
  if (o.autopilot)
    st.autopilot = { plan_date: '2026-10-07', item_id: 'pi_a0000001', channel_id: st.channel_id };
  writeFileSync(path.join(vdir, 'state.json'), JSON.stringify(st));
  const release = (id: string, finished: string) => {
    const rd = path.join(vdir, 'renders', id);
    mkdirSync(rd, { recursive: true });
    writeFileSync(path.join(rd, 'video.mp4'), Buffer.alloc(3000, 7));
    writeFileSync(path.join(rd, 'description.txt'), 'Mô tả video.\n\nÂm nhạc: Thử\n');
    writeFileSync(
      path.join(rd, 'render.json'),
      JSON.stringify({
        schema_version: 1,
        id,
        mode: 'release',
        output_profile: o.profile ?? 'yt-1080p30',
        started_at: '2026-10-07T01:00:00Z',
        finished_at: finished,
        status: 'done',
        file: `renders/${id}/video.mp4`,
        duration_ms: 2700,
        gate_results: [],
        index_hash: 'ff'.repeat(32),
      }),
    );
  };
  release('rd_rel00001', '2026-10-07T01:05:00Z');
  const ref = { channel: c.dir, video: fixtureVideoId };
  const state = () =>
    JSON.parse(readFileSync(path.join(vdir, 'state.json'), 'utf8')) as {
      steps: Record<string, { status: string; error?: { code: string; message: string } }>;
    };
  const record = () =>
    JSON.parse(readFileSync(path.join(vdir, 'publish-state.json'), 'utf8')) as {
      render_id: string | null;
      requested_at: string | null;
      platforms: string[];
      results: Record<
        string,
        { status: string; url?: string; note?: string; error?: string; publish_at?: string }
      >;
    };
  const step = () => state().steps.publish;
  const settle = () => until(() => ['done', 'failed'].includes(step()?.status ?? ''));
  return { host, dir: c.dir, vdir, g, tt, fb, ref, state, step, record, settle, release };
}

describe('publish step (091)', () => {
  it('waits for the user to choose platforms; options list connection and eligibility', async () => {
    const r = await setup({ platforms: ['youtube', 'facebook'] });
    await r.host.call('workflow.run_step', { ...r.ref, step_id: 'publish' });
    await r.settle();
    expect(r.step()!.status).toBe('failed');
    expect(r.step()!.error!.code).toBe('E_STEP_INCOMPLETE');
    expect(r.step()!.error!.message).toMatch(new RegExp(`${WAIT}$`));
    // chưa gọi mạng
    expect(r.g.to(/upload\/youtube/)).toHaveLength(0);
    const opt = await r.host.call('publish.video.options', r.ref);
    expect(opt.render).toEqual({ id: 'rd_rel00001', output_profile: 'yt-1080p30' });
    expect(opt.meta.title).toBe('Năm 1428: Lê Lợi lên ngôi');
    expect(opt.meta.tags).toEqual(['lịch sử', 'Lê Lợi']);
    expect(opt.requested_at).toBeNull();
    const by = Object.fromEntries(opt.platforms.map((p) => [p.platform, p]));
    expect(by.youtube).toMatchObject({ label: 'YouTube', connected: true, eligible: true });
    expect(by.youtube!.checked).toBe(true);
    // video ngang: TikTok/Reels không chọn được, có lý do
    expect(by.tiktok).toMatchObject({ connected: true, eligible: false, checked: false });
    expect(by.tiktok!.reason).toMatch(/video dọc/);
    expect(by.facebook).toMatchObject({ eligible: false, checked: false });
  });

  it('publishes to several platforms at once with title, description and tags (vertical video)', async () => {
    const r = await setup({ profile: 'yt-shorts-1080x1920' });
    await r.host.call('publish.video.start', {
      ...r.ref,
      platforms: ['youtube', 'tiktok', 'facebook'],
    });
    await r.settle();
    expect(r.step()!.status).toBe('done');
    const rec = r.record();
    expect(rec.render_id).toBe('rd_rel00001');
    expect(rec.platforms).toEqual(['youtube', 'tiktok', 'facebook']);
    // YouTube chưa kiểm duyệt → riêng tư, không publishAt; metadata đủ
    expect(rec.results.youtube).toMatchObject({
      status: 'private',
      url: 'https://youtu.be/yt_vid_001',
    });
    expect(rec.results.youtube!.note).toMatch(/YouTube Studio/);
    const ins = r.g.to(/upload\/youtube\/v3\/videos/)[0]!.body as {
      snippet: { title: string; description: string; tags: string[] };
      status: { privacyStatus: string; publishAt?: string };
    };
    expect(ins.snippet.title).toBe('Năm 1428: Lê Lợi lên ngôi');
    expect(ins.snippet.description).toMatch(/^Mô tả video\./);
    expect(ins.snippet.tags).toEqual(['lịch sử', 'Lê Lợi']);
    expect(ins.status.publishAt).toBeUndefined();
    // TikTok chưa kiểm duyệt → chỉ mình tôi; chú thích = tiêu đề + hashtag
    expect(rec.results.tiktok!.status).toBe('private');
    const init = r.tt.to(/publish\/video\/init/)[0]!.body as {
      post_info: { title: string; privacy_level: string };
    };
    expect(init.post_info.title).toBe('Năm 1428: Lê Lợi lên ngôi #lịchsử #LêLợi');
    expect(init.post_info.privacy_level).toBe('SELF_ONLY');
    // Facebook Reels đăng ngay, không hẹn giờ
    expect(rec.results.facebook!.status).toBe('public');
    const fin = r.fb
      .to(/video_reels$/)
      .map((c) => c.body as Record<string, unknown>)
      .find((b) => b.upload_phase === 'finish')!;
    expect(fin.video_state).toBe('PUBLISHED');
    expect(fin.scheduled_publish_time).toBeUndefined();
    expect(fin.title).toBe('Năm 1428: Lê Lợi lên ngôi');
    expect(String(fin.description)).toMatch(/Mô tả video\.[\s\S]*#lịchsử #LêLợi/);
    // không rò token
    expect(readFileSync(path.join(r.vdir, 'publish-state.json'), 'utf8')).not.toMatch(
      /SECRET|EAAG|rt_stored/,
    );
  });

  it('audited APIs publish publicly right away', async () => {
    const r = await setup({
      profile: 'yt-shorts-1080x1920',
      youtubeAudited: true,
      tiktokAudited: true,
    });
    await r.host.call('publish.video.start', { ...r.ref, platforms: ['youtube', 'tiktok'] });
    await r.settle();
    expect(r.step()!.status).toBe('done');
    const ins = r.g.to(/upload\/youtube\/v3\/videos/)[0]!.body as {
      status: { privacyStatus: string; publishAt?: string };
    };
    expect(ins.status.privacyStatus).toBe('public');
    expect(ins.status.publishAt).toBeUndefined();
    expect(r.record().results.youtube!.status).toBe('public');
    expect(r.record().results.tiktok!.status).toBe('public');
    const init = r.tt.to(/publish\/video\/init/)[0]!.body as {
      post_info: { privacy_level: string };
    };
    expect(init.post_info.privacy_level).toBe('PUBLIC_TO_EVERYONE');
  });

  it('a failed platform fails the step; running it again retries only that platform', async () => {
    const r = await setup({ profile: 'yt-shorts-1080x1920' });
    let fail = true;
    r.g.inject = (c) =>
      fail && /upload\/youtube\/v3\/videos/.test(c.url) && c.method === 'POST'
        ? googleError(400, 'invalidTitle', 'tiêu đề không hợp lệ')
        : undefined;
    await r.host.call('publish.video.start', { ...r.ref, platforms: ['youtube', 'facebook'] });
    await r.settle();
    expect(r.step()!.status).toBe('failed');
    expect(r.step()!.error!.code).toBe('E_PROVIDER_FAILED');
    expect(r.step()!.error!.message).toMatch(/YouTube/);
    expect(r.record().results.youtube!.status).toBe('failed');
    expect(r.record().results.facebook!.status).toBe('public');
    const fbStarts = () =>
      r.fb
        .to(/video_reels$/)
        .filter((c) => (c.body as { upload_phase?: string }).upload_phase === 'start').length;
    expect(fbStarts()).toBe(1);
    fail = false;
    await r.host.call('workflow.run_step', { ...r.ref, step_id: 'publish' });
    await until(() => r.step()!.status === 'done');
    expect(r.record().results.youtube!.status).toBe('private');
    // Facebook đã đăng không tải lại
    expect(fbStarts()).toBe(1);
  });

  it('"Không đăng" completes the step without network calls', async () => {
    const r = await setup();
    await r.host.call('publish.video.start', { ...r.ref, platforms: [] });
    await r.settle();
    expect(r.step()!.status).toBe('done');
    expect(r.record().platforms).toEqual([]);
    expect(r.g.calls).toHaveLength(0);
  });

  it('a new release render is published again', async () => {
    const r = await setup({ profile: 'yt-shorts-1080x1920' });
    await r.host.call('publish.video.start', { ...r.ref, platforms: ['facebook'] });
    await r.settle();
    expect(r.record().render_id).toBe('rd_rel00001');
    r.release('rd_rel00002', '2026-10-07T02:05:00Z');
    const opt = await r.host.call('publish.video.options', r.ref);
    expect(opt.render!.id).toBe('rd_rel00002');
    // trạng thái cũ thuộc bản render cũ → không hiện như đã đăng
    expect(opt.platforms.find((p) => p.platform === 'facebook')!.state).toBeUndefined();
    await r.host.call('publish.video.start', { ...r.ref, platforms: ['facebook'] });
    await until(() => r.step()!.status === 'done' && r.record().render_id === 'rd_rel00002');
    expect(
      r.fb
        .to(/video_reels$/)
        .filter((c) => (c.body as { upload_phase?: string }).upload_phase === 'start'),
    ).toHaveLength(2);
  });

  it('Autopilot videos skip the step (the daily plan publishes them)', async () => {
    const r = await setup({ autopilot: true });
    await r.host.call('workflow.run_step', { ...r.ref, step_id: 'publish' });
    await r.settle();
    expect(r.step()!.status).toBe('done');
    expect(r.g.calls).toHaveLength(0);
  });

  it('rejects unknown platforms and a video without a release render', async () => {
    const r = await setup();
    await expect(
      r.host.call('publish.video.start', { ...r.ref, platforms: ['myspace'] }),
    ).rejects.toMatchObject({ code: 'E_SCHEMA_INVALID' });
    const rd = path.join(r.vdir, 'renders', 'rd_rel00001', 'render.json');
    const rec = JSON.parse(readFileSync(rd, 'utf8'));
    rec.mode = 'draft';
    writeFileSync(rd, JSON.stringify(rec));
    await expect(
      r.host.call('publish.video.start', { ...r.ref, platforms: ['youtube'] }),
    ).rejects.toMatchObject({ code: 'E_FILE_NOT_FOUND' });
    expect((await r.host.call('publish.video.options', r.ref)).render).toBeNull();
  });
});
