// 053 · FR-AP-09 — bộ đăng YouTube: bàn giao từ bộ chạy Autopilot, riêng tư + hẹn giờ (đã kiểm duyệt) hay chỉ
// riêng tư (chưa kiểm duyệt), cửa sổ phản đối với nút Hủy đăng / Đăng ngay, thử lại, quota, tool Gateway.
// Google giả, runtime/Telegram giả.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, MemorySecretStore, type Core } from '../../src/index.js';
import { setChannelAutopilot } from '../../src/autopilot/index.js';
import { PUBLISH_CALLBACK } from '../../src/publish/service.js';
import { ytTokenSecret } from '../../src/publish/oauth.js';
import { readQuotaUsed } from '../../src/publish/quota.js';
import { WriteStore } from '../../src/store/writer.js';
import type { DailyPlan, PlanItem } from '../../src/contracts/types.js';
import type { NotifyEvent } from '../../src/telegram/format.js';
import type { PreviewMessage } from '../../src/publish/types.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';
import { workflowFixtures } from '../workflow-helpers.js';
import { fakeGoogle, googleError, type FakeGoogle } from '../publish-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const NOW = new Date('2026-10-07T03:00:00Z'); // 10:00 giờ Việt Nam
const DATE = '2026-10-07';
const ITEM = 'pi_a0000001';

interface Rig {
  core: Core;
  dir: string;
  app: string;
  g: FakeGoogle;
  secrets: MemorySecretStore;
  previews: PreviewMessage[];
  events: NotifyEvent[];
  clock: { now: Date };
  channelId: string;
  plan(): DailyPlan;
  item(): PlanItem;
  state(): NonNullable<PlanItem['publish']>['youtube'];
  log(): { event: string; message: string; level: string }[];
  setPlan(patch: Partial<PlanItem>): void;
}

function setup(
  o: { audited?: boolean; connected?: boolean; release?: boolean; item?: Partial<PlanItem> } = {},
): Rig {
  const c = copyChannel();
  const t = tempDir('app-');
  const settings = JSON.parse(readFileSync(path.join(fixtureAppData, 'settings.json'), 'utf8'));
  settings.config['publish.youtube.audited'] = o.audited === true;
  writeFileSync(path.join(t.dir, 'settings.json'), JSON.stringify(settings, null, 2));
  const channelId = JSON.parse(readFileSync(path.join(c.dir, 'channel.json'), 'utf8')).id as string;
  const g = fakeGoogle();
  const secrets = new MemorySecretStore({
    youtube_oauth_client_id: 'cid',
    youtube_oauth_client_secret: 'csecret',
    ...(o.connected === false ? {} : { [ytTokenSecret(channelId)]: 'rt_stored' }),
  });
  const clock = { now: NOW };
  const core = createCore({
    appDataDir: t.dir,
    workflowDirs: [workflowFixtures],
    secrets,
    publishFetch: g.fetch,
    publishSleep: async () => {},
    clock: () => clock.now,
    permissionTimeoutMs: 300,
  });
  cleanups.push(() => core.close(), c.cleanup, t.cleanup);
  const store = new WriteStore(c.dir);
  setChannelAutopilot(store, 'autopilot.enabled', true);
  core.autopilot.setChannels(() => [c.dir]);
  // bản render phát hành của video mẫu
  if (o.release !== false) {
    const rd = path.join(c.dir, 'videos', fixtureVideoId, 'renders', 'rd_rel00001');
    mkdirSync(rd, { recursive: true });
    writeFileSync(path.join(rd, 'video.mp4'), Buffer.alloc(3000, 7));
    writeFileSync(path.join(rd, 'description.txt'), 'Mô tả video.\n\nÂm nhạc: Thử\n');
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
  }
  const planFile = path.join(c.dir, 'autopilot', 'plans', `${DATE}.json`);
  const item: PlanItem = {
    id: ITEM as PlanItem['id'],
    status: 'produced',
    candidate_id: 'yt:a1',
    title: 'Năm 1428: Lê Lợi lên ngôi',
    angle: 'góc',
    source: { kind: 'trend' },
    workflow_id: 'narrated-explainer',
    output_profile: 'yt-1080p30',
    publish_at: '2026-10-07T21:00:00+07:00',
    platforms: ['youtube'],
    score: 80,
    reasons: [],
    video_id: fixtureVideoId as PlanItem['video_id'],
    ...o.item,
  };
  mkdirSync(path.dirname(planFile), { recursive: true });
  const base: DailyPlan = {
    schema_version: 1,
    channel_id: channelId as DailyPlan['channel_id'],
    date: DATE,
    generated_at: NOW.toISOString(),
    capacity: { videos: 1, limiting_factor: 'cap', reasons: [] },
    items: [item],
  };
  writeFileSync(planFile, JSON.stringify(base));
  const rig: Rig = {
    core,
    dir: c.dir,
    app: t.dir,
    g,
    secrets,
    previews: [],
    events: [],
    clock,
    channelId,
    plan: () => JSON.parse(readFileSync(planFile, 'utf8')) as DailyPlan,
    item: () => rig.plan().items[0]!,
    state: () => rig.item().publish?.youtube,
    log: () =>
      readFileSync(path.join(c.dir, 'autopilot', 'log', `${DATE}.jsonl`), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    setPlan: (patch) =>
      writeFileSync(
        planFile,
        JSON.stringify({ ...rig.plan(), items: [{ ...rig.item(), ...patch }] }),
      ),
  };
  core.publisher.setPreview({ send: async (m) => void rig.previews.push(m) });
  core.publisher.setNotifier({ notify: (e) => void rig.events.push(e) });
  return rig;
}

const insertCall = (r: Rig) => r.g.to(/uploadType=resumable/)[0]!;

describe('upload: not audited (default) → private, the user makes it public', () => {
  it('uploads private WITHOUT publishAt, with publish.md metadata, description.txt, SRT captions, AI + kids flags', async () => {
    const r = setup();
    expect((await r.core.publisher.process(NOW)).uploaded).toBe(1);
    const st = r.state()!;
    expect(st).toMatchObject({
      status: 'private',
      video_id: 'yt_vid_001',
      url: 'https://youtu.be/yt_vid_001',
      uploaded_at: NOW.toISOString(),
      veto_until: '2026-10-07T05:00:00.000Z',
      attempts: 1,
    });
    expect(st.publish_at).toBeUndefined();
    expect(st.note).toMatch(/chưa được Google kiểm duyệt/);
    expect(st.note).toMatch(/YouTube Studio/);
    const meta = insertCall(r).body as {
      snippet: Record<string, unknown>;
      status: Record<string, unknown>;
    };
    expect(meta.status).toEqual({
      privacyStatus: 'private',
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    });
    expect(meta.snippet).toMatchObject({
      title: 'Năm 1428: Lê Lợi lên ngôi',
      tags: ['lịch sử', 'Lê Lợi'],
      defaultLanguage: 'vi',
    });
    expect(String(meta.snippet.description)).toContain('Âm nhạc: Thử'); // description.txt của bản render (kèm ghi công)
    // phụ đề SRT từ caption_groups.json
    const cap = r.g.to(/captions/)[0]!;
    expect(String(cap.body)).toContain('Năm 1428,');
    expect(String(cap.body)).toContain('00:00:00,000 --> 00:00:01,300');
    // quota: channels.list 1 + insert 1600 + captions 400, ghi bền cho mô hình năng lực
    expect(readQuotaUsed(r.app, NOW)).toBe(2001);
    // kênh gắn với kênh YouTube của token
    expect(
      JSON.parse(readFileSync(path.join(r.dir, 'channel.json'), 'utf8')).config[
        'publish.youtube.channel_id'
      ],
    ).toBe(r.g.channel.id);
    // nhật ký vận hành + xem trước (chỉ nút Hủy, không có Đăng ngay)
    expect(r.log().map((l) => l.event)).toEqual(['publish.upload', 'publish.private']);
    expect(r.previews).toHaveLength(1);
    expect(r.previews[0]!.text).toContain('Chế độ riêng tư');
    expect(r.previews[0]!.text).toContain('https://youtu.be/yt_vid_001');
    expect(r.previews[0]!.buttons).toEqual([
      [{ text: '🛑 Hủy đăng', data: `${PUBLISH_CALLBACK}:c:youtube:${ITEM}` }],
    ]);
    // lượt sau không tải lại
    expect((await r.core.publisher.process(NOW)).uploaded).toBe(0);
    expect(r.g.to(/uploadType=resumable/)).toHaveLength(1);
  });

  it('Đăng ngay is refused with manual instructions and changes nothing', async () => {
    const r = setup();
    await r.core.publisher.process(NOW);
    const calls = r.g.calls.length;
    const res = await r.core.publisher.publishNow({ channel: r.dir, item_id: ITEM });
    expect(res.status).toBe('private');
    expect(res.note).toMatch(/chưa được kiểm duyệt.*YouTube Studio/);
    expect(r.g.calls.length).toBe(calls);
    expect(r.state()!.status).toBe('private');
  });
});

describe('upload: audited → private + publishAt (scheduled)', () => {
  it('publishAt = planned slot when later than the veto window', async () => {
    const r = setup({ audited: true });
    await r.core.publisher.process(NOW);
    const st = r.state()!;
    expect(st).toMatchObject({
      status: 'scheduled',
      publish_at: '2026-10-07T14:00:00.000Z',
      veto_until: '2026-10-07T05:00:00.000Z',
    });
    expect((insertCall(r).body as { status: Record<string, unknown> }).status).toMatchObject({
      privacyStatus: 'private',
      publishAt: '2026-10-07T14:00:00.000Z',
    });
    expect(r.previews[0]!.text).toMatch(/Tự công khai lúc/);
    expect(r.previews[0]!.text).toMatch(/Bạn có tới/);
    expect(r.previews[0]!.buttons[0]!.map((b) => b.text)).toEqual(['🛑 Hủy đăng', '🚀 Đăng ngay']);
    expect(r.log().map((l) => l.event)).toContain('publish.scheduled');
  });
  it('a slot inside the veto window is pushed to the end of the window; no slot → end of the window', async () => {
    const early = setup({ audited: true, item: { publish_at: '2026-10-07T11:00:00+07:00' } }); // 04:00Z < 05:00Z
    await early.core.publisher.process(NOW);
    expect(early.state()!.publish_at).toBe('2026-10-07T05:00:00.000Z');
    const none = setup({ audited: true, item: { publish_at: null } });
    await none.core.publisher.process(NOW);
    expect(none.state()!.publish_at).toBe('2026-10-07T05:00:00.000Z');
  });
  it('the veto window follows publish.veto_hours of the channel', async () => {
    const r = setup({ audited: true });
    setChannelAutopilot(new WriteStore(r.dir), 'publish.veto_hours', 6);
    await r.core.publisher.process(NOW);
    expect(r.state()!.veto_until).toBe('2026-10-07T09:00:00.000Z');
  });

  it('no objection: stays scheduled, then becomes public once the slot has passed and YouTube says so', async () => {
    const r = setup({ audited: true });
    await r.core.publisher.process(NOW);
    r.clock.now = new Date('2026-10-07T06:00:00Z'); // qua hạn phản đối, chưa tới giờ
    const before = r.g.calls.length;
    await r.core.publisher.process(r.clock.now);
    expect(r.state()!.status).toBe('scheduled');
    expect(r.g.calls.length).toBe(before); // chưa tới giờ: không gọi API
    r.clock.now = new Date('2026-10-07T14:05:00Z');
    r.g.privacy.value = 'private'; // YouTube chưa công khai
    await r.core.publisher.process(r.clock.now);
    expect(r.state()!.status).toBe('scheduled');
    r.g.privacy.value = 'public';
    await r.core.publisher.process(r.clock.now);
    expect(r.state()!.status).toBe('public');
    expect(r.log().at(-1)).toMatchObject({ event: 'publish.public' });
    expect(r.events.map((e) => e.kind)).toContain('publish.public');
  });
});

describe('veto actions', () => {
  it('Hủy đăng (button): the schedule is removed, the video stays private, nothing will be re-uploaded', async () => {
    const r = setup({ audited: true });
    await r.core.publisher.process(NOW);
    const res = await r.core.publisher.handleCallback(`c:youtube:${ITEM}`);
    expect(res).toMatchObject({ clear_markup: true, text: expect.stringContaining('Đã hủy đăng') });
    const upd = r.g.to(/videos\?part=status$/)[0]!;
    expect(upd.body).toMatchObject({ id: 'yt_vid_001', status: { privacyStatus: 'private' } });
    expect((upd.body as { status: Record<string, unknown> }).status).not.toHaveProperty(
      'publishAt',
    );
    expect(r.state()!.status).toBe('cancelled');
    expect(r.log().map((l) => l.event)).toContain('publish.cancelled');
    const n = r.g.calls.length;
    await r.core.publisher.process(NOW);
    expect(r.g.calls.length).toBe(n);
    // bấm lại: vô hại
    expect((await r.core.publisher.cancel({ channel: r.dir, item_id: ITEM })).status).toBe(
      'cancelled',
    );
  });
  it('Hủy đăng when not audited makes no API call but cancels', async () => {
    const r = setup();
    await r.core.publisher.process(NOW);
    const n = r.g.calls.length;
    await r.core.publisher.cancel({ channel: r.dir, item_id: ITEM });
    expect(r.g.calls.length).toBe(n);
    expect(r.state()!.status).toBe('cancelled');
  });
  it('Đăng ngay (button, audited): privacy → public, state public, Telegram text', async () => {
    const r = setup({ audited: true });
    await r.core.publisher.process(NOW);
    const res = await r.core.publisher.handleCallback(`n:youtube:${ITEM}`);
    expect(res).toMatchObject({
      text: expect.stringContaining('Đã đăng công khai'),
      clear_markup: true,
    });
    expect(r.g.to(/videos\?part=status$/)[0]!.body).toMatchObject({
      status: { privacyStatus: 'public' },
    });
    expect(r.state()).toMatchObject({ status: 'public', url: 'https://youtu.be/yt_vid_001' });
    expect(r.g.privacy.value).toBe('public');
    // đã công khai thì không hủy được
    await expect(r.core.publisher.cancel({ channel: r.dir, item_id: ITEM })).rejects.toMatchObject({
      code: 'E_SCHEMA_INVALID',
    });
    expect((await r.core.publisher.handleCallback(`c:youtube:${ITEM}`)).alert).toBe(true);
  });
  it('callbacks for unknown items or garbage answer politely', async () => {
    const r = setup();
    expect((await r.core.publisher.handleCallback('c:youtube:pi_zzzzzzzz')).alert).toBe(true);
    expect((await r.core.publisher.handleCallback('x')).alert).toBe(true);
    // chưa tải lên: chưa có trạng thái đăng
    expect((await r.core.publisher.handleCallback(`c:youtube:${ITEM}`)).alert).toBe(true);
  });
});

describe('not connected, failures, retries', () => {
  it('not connected: pending with a Vietnamese reason, warned once; connecting later uploads', async () => {
    const r = setup({ connected: false });
    await r.core.publisher.process(NOW);
    await r.core.publisher.process(NOW);
    expect(r.state()).toMatchObject({
      status: 'pending',
      error: expect.stringContaining('chưa kết nối YouTube'),
    });
    expect(r.g.calls).toHaveLength(0);
    expect(r.events.filter((e) => e.kind === 'publish.pending')).toHaveLength(1);
    await r.secrets.set(ytTokenSecret(r.channelId), 'rt_new');
    await r.core.publisher.process(NOW);
    expect(r.state()!.status).toBe('private');
    expect(r.state()!.error).toBeUndefined();
  });

  it('upload errors are retried on later passes, at most 3 attempts, then it stops and tells the user', async () => {
    const r = setup();
    r.g.inject = (c) =>
      c.url.includes('uploadType=resumable') ? googleError(500, 'backendError') : undefined;
    for (let i = 1; i <= 3; i++) {
      await r.core.publisher.process(NOW);
      expect(r.state()).toMatchObject({ status: 'failed', attempts: i });
    }
    expect(r.state()!.error).toMatch(/youtube videos.insert/);
    const n = r.g.calls.length;
    await r.core.publisher.process(NOW);
    expect(r.g.calls.length).toBe(n); // hết lượt
    const fails = r.events.filter((e) => e.kind === 'publish.failed');
    expect(fails).toHaveLength(3);
    expect(fails[2]!.message).toMatch(/dừng thử lại/);
    expect(fails[0]!.message).toMatch(/sẽ thử lại/);
    // thử lại thành công ở lần 2
    const r2 = setup();
    let n2 = 0;
    r2.g.inject = (c) =>
      c.url.includes('uploadType=resumable') && n2++ === 0
        ? googleError(500, 'backendError')
        : undefined;
    await r2.core.publisher.process(NOW);
    await r2.core.publisher.process(NOW);
    expect(r2.state()).toMatchObject({ status: 'private', attempts: 2 });
  });

  it('crash after videos.insert: the next pass reuses the stored video_id (no duplicate upload)', async () => {
    const r = setup({
      item: {
        publish: {
          youtube: {
            status: 'uploading',
            video_id: 'yt_vid_001',
            url: 'https://youtu.be/yt_vid_001',
            attempts: 1,
          },
        },
      },
    });
    await r.core.publisher.process(NOW);
    expect(r.g.to(/uploadType=resumable/)).toHaveLength(0);
    expect(r.g.to(/captions/)).toHaveLength(1);
    expect(r.state()).toMatchObject({ status: 'private', video_id: 'yt_vid_001', attempts: 2 });
  });

  it('an interrupted upload continues from the saved session URI after a restart', async () => {
    const r = setup();
    // phiên đã lưu từ lần tải trước (cùng kích thước file)
    mkdirSync(path.join(r.app, 'publish', 'sessions'), { recursive: true });
    writeFileSync(
      path.join(r.app, 'publish', 'sessions', `${ITEM}-youtube.json`),
      JSON.stringify({ uri: 'https://upload.fake/session/abc', size: 3000 }),
    );
    r.g.received.bytes = 0;
    await r.core.publisher.process(NOW);
    expect(r.g.to(/uploadType=resumable/)).toHaveLength(0);
    expect(r.state()!.status).toBe('private');
  });

  it('only a draft render exists → failed at once with a clear reason (nothing uploaded)', async () => {
    const r = setup({ release: false });
    await r.core.publisher.process(NOW);
    expect(r.state()).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('render phát hành'),
    });
    expect(r.g.calls).toHaveLength(0);
    await r.core.publisher.process(NOW);
    expect(r.g.calls).toHaveLength(0);
  });

  it('a token that belongs to another YouTube channel is refused', async () => {
    const r = setup();
    const set = new WriteStore(r.dir);
    const ch = JSON.parse(readFileSync(path.join(r.dir, 'channel.json'), 'utf8'));
    ch.config['publish.youtube.channel_id'] = 'UCbbbbbbbbbbbbbbbbbbbbb2';
    set.write('channel.json', JSON.stringify(ch, null, 2), { by: 'test' });
    await r.core.publisher.process(NOW);
    expect(r.state()).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('không phải kênh đã gắn'),
    });
    expect(r.g.to(/uploadType=resumable/)).toHaveLength(0);
  });

  it('only produced items of platforms with a publisher are handled', async () => {
    const r = setup({ item: { status: 'needs_review', platforms: ['youtube'] } });
    await r.core.publisher.process(NOW);
    expect(r.g.calls).toHaveLength(0);
    const t = setup({ item: { platforms: ['tiktok'] } });
    await t.core.publisher.process(NOW);
    expect(t.g.calls).toHaveLength(0);
    expect(t.item().publish).toBeUndefined();
  });

  it('no token or secret ever appears in the plan, the ops log or notifications', async () => {
    const r = setup({ audited: true });
    r.g.tokens.refresh_token = undefined;
    await r.core.publisher.process(NOW);
    const blob = [
      readFileSync(path.join(r.dir, 'autopilot', 'plans', `${DATE}.json`), 'utf8'),
      readFileSync(path.join(r.dir, 'autopilot', 'log', `${DATE}.jsonl`), 'utf8'),
      JSON.stringify(r.events),
      JSON.stringify(r.previews),
      readFileSync(path.join(r.dir, 'channel.json'), 'utf8'),
    ].join('\n');
    for (const secret of ['rt_stored', 'csecret', 'at_1', 'Bearer'])
      expect(blob).not.toContain(secret);
  });
});

describe('runner → publisher handoff', () => {
  it('a tick inside the work window uploads produced items; paused or outside the window it does not', async () => {
    const r = setup();
    const setApp = (k: string, v: unknown) => {
      const f = path.join(r.app, 'settings.json');
      const s = JSON.parse(readFileSync(f, 'utf8'));
      s.config[k] = v;
      writeFileSync(f, JSON.stringify(s));
    };
    setApp('autopilot.paused', true);
    await r.core.autopilot.tick();
    expect(r.g.calls).toHaveLength(0);
    setApp('autopilot.paused', false);
    r.clock.now = new Date('2026-10-07T17:00:00Z'); // 00:00 giờ VN, ngoài khung 08:00-23:00
    await r.core.autopilot.tick();
    expect(r.g.calls).toHaveLength(0);
    r.clock.now = NOW;
    await r.core.autopilot.tick();
    expect(r.state()!.status).toBe('private');
    // chạy ngay bỏ qua khung giờ
    const r2 = setup();
    r2.clock.now = new Date('2026-10-07T17:00:00Z');
    writeFileSync(
      path.join(r2.dir, 'autopilot', 'plans', `${DATE}.json`),
      JSON.stringify(r2.plan()),
    );
    await r2.core.autopilot.tick({ force: true });
    expect(r2.g.to(/uploadType=resumable/).length).toBe(1);
  });

  it('the YouTube quota used feeds the capacity model (050)', async () => {
    const r = setup();
    await r.core.publisher.process(NOW);
    const { capacityRun } = await import('../../src/autopilot/index.js');
    const run = (used?: number) =>
      capacityRun({
        db: r.core.db,
        appDataDir: r.app,
        workflows: r.core.workflows,
        channels: [],
        now: NOW.getTime(),
        ...(used ? {} : {}),
      });
    const after = run();
    // 2001 đơn vị đã dùng → (10000 − 2001) / 1600 = 4 lần tải còn lại
    expect(after.upload_quota_left).toBe(4);
  });
});

describe('Gateway tools publish.*', () => {
  const main = (r: Rig) => ({
    session_id: 'ss_main0001' as const,
    kind: 'main' as const,
    channel_dir: r.dir,
  });
  const ops = (r: Rig) => ({
    session_id: 'ss_ops00001' as const,
    kind: 'ops' as const,
    channel_dir: r.app,
  });

  it('publish.status / cancel / now work in main and ops (ops with a channel); other kinds are denied', async () => {
    const r = setup({ audited: true });
    await r.core.publisher.process(NOW);
    const g = r.core.gateway;
    const st = (await g.call(main(r), 'publish.status', {})) as {
      ok: true;
      data: { date: string; items: { id: string; publish?: { youtube?: { status: string } } }[] };
    };
    expect(st.ok).toBe(true);
    expect(st.data.items[0]).toMatchObject({
      id: ITEM,
      publish: { youtube: { status: 'scheduled' } },
    });
    const name = JSON.parse(readFileSync(path.join(r.dir, 'channel.json'), 'utf8')).name;
    expect(await g.call(ops(r), 'publish.status', {})).toMatchObject({
      ok: false,
      error: { code: 'E_SCHEMA_INVALID' },
    });
    expect(await g.call(ops(r), 'publish.status', { channel: name })).toMatchObject({ ok: true });
    const now = await g.call(ops(r), 'publish.now', { channel: name, item_id: ITEM });
    expect(now).toMatchObject({ ok: true, data: { status: 'public' } });
    expect(await g.call(main(r), 'publish.cancel', { item_id: ITEM })).toMatchObject({
      ok: false,
      error: { code: 'E_SCHEMA_INVALID' },
    });
    expect(await g.call({ ...main(r), kind: 'frame' }, 'publish.status', {})).toMatchObject({
      ok: false,
      error: { code: 'E_TOOL_DENIED' },
    });
    expect(await g.call(main(r), 'publish.cancel', { item_id: 'pi_zzzzzzzz' })).toMatchObject({
      ok: false,
      error: { code: 'E_ID_UNKNOWN' },
    });
  });
});
