// 008 · FR-CH-02/03/07, FR-WS-02 — CoreHost (tiến trình core của app): IPC D10, chat + lịch sử,
// đính kèm, explorer chỉ đọc, thẻ duyệt, job/trace (runtime agent giả, SF_GPU=0).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CoreHost,
  type AgentEvent,
  type AgentRuntime,
  type SessionOptions,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';
import { workflowFixtures } from '../workflow-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

/** Runtime giả: trả lời "Đã nhận: <text>", gọi một tool thật qua Gateway, nhớ id phiên SDK. */
function fakeRuntime(host: () => CoreHost): AgentRuntime & { opened: SessionOptions[] } {
  const opened: SessionOptions[] = [];
  return {
    id: 'fake',
    opened,
    authStatus: async () => ({ ok: true, method: 'claude-plan' }),
    async openSession(o) {
      opened.push(o);
      return {
        id: o.context.session_id,
        sdkSessionId: 'sdk-123',
        async *send(m: { text: string }): AsyncIterable<AgentEvent> {
          yield { type: 'text_delta', text: `Đã nhận: ${m.text.slice(0, 40)}` };
          yield {
            type: 'tool_call',
            id: 't1',
            name: 'mcp__sf__config_resolve',
            input: { key: 'voice.id' },
          };
          const r = await host().core.gateway.call(o.context, 'config.resolve', {
            key: 'voice.id',
          });
          yield { type: 'tool_result', id: 't1', ok: r.ok, summary: 'voice.id = vo_c3z8p1mn' };
          yield { type: 'done', stop_reason: 'end_turn' };
        },
        interrupt: async () => {},
        close: async () => {},
      } as never;
    },
  };
}

function setup() {
  const c = copyChannel();
  const t = tempDir('app-');
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const ref: { host?: CoreHost } = {};
  const rt = fakeRuntime(() => ref.host!);
  // bước script không gọi LLM thật: replay với thư mục bản ghi rỗng
  const host = (ref.host = new CoreHost({
    appDataDir: t.dir,
    workflowDirs: [workflowFixtures],
    runtime: rt,
    permissionTimeoutMs: 1000,
    textMode: 'replay',
    textFixtureDir: t.dir,
  }));
  const events: [string, unknown][] = [];
  host.on('event', (n: string, d: unknown) => events.push([n, d]));
  cleanups.push(() => host.close(), c.cleanup, t.cleanup);
  return { host, rt, dir: c.dir, app: t.dir, events };
}

describe('CoreHost IPC (008)', () => {
  it('channel open/recent, video create/list/open', async () => {
    const { host, dir } = setup();
    const open = await host.call('channel.open', { channel: dir });
    expect(open.videos.map((v) => v.id)).toContain(fixtureVideoId);
    expect((await host.call('channel.list_recent', {})).channels[0]!.path).toBe(path.resolve(dir));
    const { video_id } = await host.call('video.create', { channel: dir, title: 'Bầu trời' });
    expect(
      (await host.call('video.list', { channel: dir })).videos.find((v) => v.id === video_id),
    ).toMatchObject({ title: 'Bầu trời', phase: 'briefing' });
    const v = await host.call('video.open', { channel: dir, video: video_id });
    expect(v).toMatchObject({ state: { video_id, phase: 'briefing' }, history: [] });
    const err = await host.handle({
      id: 1,
      method: 'channel.open',
      params: { channel: path.join(dir, 'videos') },
    });
    expect(err.error).toMatchObject({ code: 'E_NOT_CHANNEL' });
  });

  it('session history lists main chats, recorded sub-sessions and trace-only sessions (048 FR-AP-14)', async () => {
    const { host, dir } = setup();
    await host.call('chat.send', { channel: dir, video: fixtureVideoId, text: 'bao nhiêu line?' });
    // phiên con có nhật ký (recorder, 048)
    const store = host.core.gateway.storeFor(dir);
    const rel = `videos/${fixtureVideoId}/sessions/ss_frm00001.jsonl`;
    const put = (o: object) => store.appendLine(rel, JSON.stringify(o), { by: 'test' });
    put({
      ts: '2026-10-07T01:00:00.000Z',
      role: 'system',
      content: 'Phiên frame · frame fr_9x2b7cqe · model m',
      session: { id: 'ss_frm00001', kind: 'frame', frame_id: 'fr_9x2b7cqe' },
    });
    put({ ts: '2026-10-07T01:00:01.000Z', role: 'user', content: 'Dựng frame fr_9x2b7cqe' });
    put({
      ts: '2026-10-07T01:00:09.000Z',
      role: 'system',
      content: 'Kết thúc: end_turn',
      usage: { input_tokens: 5, output_tokens: 7 },
    });
    // phiên con cũ: chỉ còn span
    const ins = host.core.db.prepare(
      'INSERT INTO spans (span_id, trace_id, parent_id, name, start_ms, end_ms, status, status_message, video_id, attrs, events) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    );
    ins.run(
      's1',
      't1',
      null,
      'sf.agent.session',
      1000,
      2000,
      'error',
      null,
      fixtureVideoId,
      JSON.stringify({
        'sf.session_kind': 'frame',
        'sf.session_id': 'ss_old00001',
        'sf.error': 'hit your limit',
      }),
      '[]',
    );
    ins.run(
      's2',
      't1',
      's1',
      'sf.tool',
      1100,
      1200,
      'ok',
      null,
      fixtureVideoId,
      JSON.stringify({
        'sf.tool_name': 'artifact.write',
        'sf.session_id': 'ss_old00001',
        'sf.ok': false,
        'sf.error_code': 'E_OWNER_CONFLICT',
      }),
      '[]',
    );
    const { sessions } = await host.call('sessions.list', { channel: dir });
    const by = Object.fromEntries(sessions.map((s) => [s.id, s]));
    expect(sessions.find((s) => s.source === 'chat')).toMatchObject({
      kind: 'main',
      video: fixtureVideoId,
      title: 'bao nhiêu line?',
    });
    expect(by['ss_frm00001']).toMatchObject({
      kind: 'frame',
      source: 'session',
      frame_id: 'fr_9x2b7cqe',
      title: 'Dựng frame fr_9x2b7cqe',
      tokens: 12,
      lines: 3,
    });
    expect(by['ss_old00001']).toMatchObject({
      kind: 'frame',
      source: 'trace',
      error: 'hit your limit',
    });
    const got = await host.call('sessions.get', {
      channel: dir,
      video: fixtureVideoId,
      id: 'ss_old00001',
    });
    expect(got.lines).toEqual([
      expect.objectContaining({
        role: 'tool',
        content: 'lỗi E_OWNER_CONFLICT',
        tool: { name: 'artifact.write', ok: false },
      }),
    ]);
    expect(
      (await host.call('sessions.get', { channel: dir, video: fixtureVideoId, id: 'ss_frm00001' }))
        .lines,
    ).toHaveLength(3);
  });

  it('delete a video to the channel trash, restore it, empty the trash (064)', async () => {
    const { host, dir } = setup();
    await host.call('channel.open', { channel: dir });
    const { video_id } = await host.call('video.create', { channel: dir, title: 'Rác' });
    await host.call('video.open', { channel: dir, video: video_id });
    // agent đang trả lời trong video → không xóa
    const sent = host.call('chat.send', { channel: dir, video: video_id, text: 'x' });
    const busy = await host.handle({
      id: 7,
      method: 'video.delete',
      params: { channel: dir, video: video_id },
    });
    expect(busy.error).toMatchObject({ code: 'E_VIDEO_BUSY' });
    await sent;
    const del = await host.call('video.delete', { channel: dir, video: video_id });
    expect(del.trash_id).toMatch(new RegExp(`^${video_id}-\\d{14}$`));
    expect((await host.call('video.list', { channel: dir })).videos.map((v) => v.id)).not.toContain(
      video_id,
    );
    const { entries } = await host.call('trash.list', { channel: dir });
    expect(entries).toEqual([expect.objectContaining({ video_id, title: 'Rác' })]);
    await host.call('trash.restore', { channel: dir, trash_id: del.trash_id });
    expect((await host.call('video.list', { channel: dir })).videos.map((v) => v.id)).toContain(
      video_id,
    );
    await host.call('video.delete', { channel: dir, video: video_id });
    expect((await host.call('trash.empty', { channel: dir })).removed).toHaveLength(1);
    expect((await host.call('trash.list', { channel: dir })).entries).toEqual([]);
  });

  it('lists renders and exports one outside the channel (066)', async () => {
    const { host, dir } = setup();
    await host.call('channel.open', { channel: dir });
    const { video_id } = await host.call('video.create', { channel: dir, title: 'Xuất' });
    expect((await host.call('render.list', { channel: dir, video: video_id })).renders).toEqual([]);
    const out = tempDir('sf-export-');
    try {
      const r = await host.handle({
        id: 9,
        method: 'video.export',
        params: { channel: dir, video: video_id, dest_dir: out.dir },
      });
      expect(r.error).toMatchObject({ code: 'E_FILE_NOT_FOUND' });
    } finally {
      out.cleanup();
    }
  });

  it('managed channels and per-channel Autopilot settings (047 FR-AP-01..03)', async () => {
    const { host, dir } = setup();
    // mở kênh lần đầu → vào danh sách kênh quản lý (Manual)
    await host.call('channel.open', { channel: dir });
    const list = await host.call('channels.managed', {});
    expect(list.channels).toEqual([
      expect.objectContaining({
        path: path.resolve(dir),
        exists: true,
        autopilot: false,
        competitors: 0,
      }),
    ]);
    await host.call('channel.autopilot.set', {
      channel: dir,
      key: 'autopilot.competitors',
      value: ['UCuAXFkgsw1L7xaCfnd5JJOw'],
    });
    await host.call('channel.autopilot.set', {
      channel: dir,
      key: 'autopilot.enabled',
      value: true,
    });
    const got = await host.call('channel.autopilot.get', { channel: dir });
    expect(got.settings['autopilot.enabled']).toEqual({ value: true, source: 'channel' });
    expect((await host.call('channels.managed', {})).channels[0]).toMatchObject({
      autopilot: true,
      competitors: 1,
    });
    // sai dạng → lỗi rõ; khóa tầng app qua settings.set cũng được kiểm
    const bad = await host.handle({
      id: 2,
      method: 'channel.autopilot.set',
      params: { channel: dir, key: 'publish.slots', value: ['7pm'] },
    });
    expect(bad.error).toMatchObject({ code: 'E_SCHEMA_INVALID' });
    const badApp = await host.handle({
      id: 3,
      method: 'settings.set',
      params: { key: 'autopilot.work_window', value: '8-23' },
    });
    expect(badApp.error).toMatchObject({ code: 'E_SCHEMA_INVALID' });
    await host.call('channels.managed.remove', { channel: dir });
    expect((await host.call('channels.managed', {})).channels).toEqual([]);
    await host.call('channels.managed.add', { channel: dir });
    expect((await host.call('channels.managed', {})).channels).toHaveLength(1);
  });

  it('research.latest returns the newest research scan of a channel (049 FR-AP-04)', async () => {
    const { host, dir } = setup();
    expect(await host.call('research.latest', { channel: dir })).toEqual({ doc: null });
    const sample = readFileSync(
      path.join(fixtureAppData, '..', '..', 'research', 'research-doc.json'),
      'utf8',
    );
    mkdirSync(path.join(dir, 'research'));
    writeFileSync(
      path.join(dir, 'research', '2026-10-06.json'),
      sample.replace('2026-10-07"', '2026-10-06"'),
    );
    writeFileSync(path.join(dir, 'research', '2026-10-07.json'), sample);
    const r = await host.call('research.latest', { channel: dir });
    expect(r.doc).toMatchObject({ date: '2026-10-07', candidates: [{ id: 'yt:aaaaaaaaa01' }] });
  });

  it('autopilot.capacity for Autopilot channels; daily_tokens override checked (050 FR-AP-05)', async () => {
    const { host, dir } = setup();
    await host.call('channel.open', { channel: dir });
    // chưa kênh nào bật Autopilot → 0 video, lý do rõ
    const none = await host.call('autopilot.capacity', {});
    expect(none).toMatchObject({ videos: 0, limiting_factor: 'cap', channels: [] });
    await host.call('channel.autopilot.set', {
      channel: dir,
      key: 'autopilot.enabled',
      value: true,
    });
    await host.call('channel.autopilot.set', {
      channel: dir,
      key: 'autopilot.max_per_day',
      value: 2,
    });
    await host.call('settings.set', { key: 'autopilot.work_window', value: '00:00-23:59' });
    await host.call('settings.set', { key: 'autopilot.daily_tokens', value: 100_000_000 });
    const r = await host.call('autopilot.capacity', {});
    expect(r.channels).toEqual([
      expect.objectContaining({ channel: path.resolve(dir), cap_left: 2 }),
    ]);
    expect(r.daily_tokens_source).toBe('override');
    expect(r.by_workflow.length).toBeGreaterThan(0);
    expect(r.reasons.length).toBeGreaterThan(0);
    // chọn kênh tường minh (xem trước khi chưa bật)
    expect((await host.call('autopilot.capacity', { channels: [dir] })).channels).toHaveLength(1);
    const bad = await host.handle({
      id: 4,
      method: 'settings.set',
      params: { key: 'autopilot.daily_tokens', value: -5 },
    });
    expect(bad.error).toMatchObject({ code: 'E_SCHEMA_INVALID' });
    await host.call('settings.set', { key: 'autopilot.daily_tokens', value: null });
    expect((await host.call('autopilot.capacity', {})).daily_tokens_source).not.toBe('override');
  });

  it('autopilot.plan.get/run/update: daily plan of Autopilot channels, edit rules (051 FR-AP-06)', async () => {
    const { host, dir } = setup();
    await host.call('channel.open', { channel: dir });
    const set = (key: string, value: unknown) =>
      host.call('channel.autopilot.set', { channel: dir, key, value });
    // chưa kênh nào bật Autopilot → không có kế hoạch
    expect(await host.call('autopilot.plan.get', {})).toEqual({ plans: [] });
    await set('autopilot.enabled', true);
    await set('autopilot.max_per_day', 2);
    // khung giờ bắt đầu từ giờ hiện tại, dài ~24 h (qua nửa đêm): luôn đủ thời gian máy, chạy giờ nào cũng như nhau
    const hour = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
    const prev = String((Number(hour) + 23) % 24).padStart(2, '0');
    await host.call('settings.set', {
      key: 'autopilot.work_window',
      value: `${hour}:00-${prev}:59`,
    });
    await host.call('settings.set', { key: 'autopilot.daily_tokens', value: 100_000_000 });
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const sample = JSON.parse(
      readFileSync(path.join(fixtureAppData, '..', '..', 'research', 'research-doc.json'), 'utf8'),
    );
    sample.date = today;
    sample.candidates = [
      { ...sample.candidates[0], id: 'yt:p1', title: 'Chủ đề thứ nhất về sử Việt', score: 90 },
      {
        ...sample.candidates[0],
        id: 'yt:p2',
        title: 'Chiếc thuyền buồm cổ',
        score: 80,
        source_channel: { id: 'UCz', title: 'Z' },
        pillar: undefined,
      },
      {
        ...sample.candidates[0],
        id: 'yt:p3',
        title: 'Làng nghề gốm Bát Tràng',
        score: 70,
        source_channel: { id: 'UCy', title: 'Y' },
        pillar: undefined,
      },
    ];
    mkdirSync(path.join(dir, 'research'));
    writeFileSync(path.join(dir, 'research', `${today}.json`), JSON.stringify(sample));

    // chưa lập → plan null
    expect(await host.call('autopilot.plan.get', { channel: dir, date: today })).toMatchObject({
      plans: [{ channel: path.resolve(dir), date: today, plan: null }],
    });
    // date khác hôm nay bị từ chối
    const old = await host.handle({
      id: 5,
      method: 'autopilot.plan.run',
      params: { date: '2020-01-01' },
    });
    expect(old.error).toMatchObject({ code: 'E_SCHEMA_INVALID' });
    const { job_id } = await host.call('autopilot.plan.run', {});
    const job = await host.core.queue.wait(job_id, 15_000);
    expect(job.status).toBe('succeeded');
    const got = await host.call('autopilot.plan.get', {});
    expect(got.plans).toHaveLength(1);
    const plan = got.plans[0]!.plan!;
    expect(plan.items).toHaveLength(2); // trần 2
    expect(plan.items.every((i) => i.status === 'planned' && i.publish_at)).toBe(true);
    const id = plan.items[0]!.id;
    const edit = (patch: Record<string, unknown>, item = id) =>
      host.handle({
        id: 9,
        method: 'autopilot.plan.update',
        params: { channel: dir, date: today, item_id: item, patch },
      });

    const ok = await host.call('autopilot.plan.update', {
      channel: dir,
      date: today,
      item_id: id,
      patch: {
        status: 'skipped',
        title: 'Tên mới',
        angle: 'Góc mới',
        publish_at: '2030-01-02T19:00:00+07:00',
      },
    });
    expect(ok.item).toMatchObject({ status: 'skipped', title: 'Tên mới', angle: 'Góc mới' });
    expect(
      (await host.call('autopilot.plan.get', { channel: dir })).plans[0]!.plan!.items[0],
    ).toMatchObject({ title: 'Tên mới' });
    expect((await edit({ workflow_id: 'khong-co' })).error).toMatchObject({
      code: 'E_SCHEMA_INVALID',
    });
    expect((await edit({ publish_at: 'ngày mai' })).error).toMatchObject({
      code: 'E_SCHEMA_INVALID',
    });
    expect((await edit({ title: 'x' }, 'pi_zzzzzzzz')).error).toMatchObject({
      code: 'E_ID_UNKNOWN',
    });
    // lập lại: mục đã bỏ qua giữ nguyên, chủ đề của nó không bị lập lại, chỗ trống được lấp
    const again = await host.core.queue.wait(
      (await host.call('autopilot.plan.run', {})).job_id,
      15_000,
    );
    expect(again.status).toBe('succeeded');
    const items = (await host.call('autopilot.plan.get', { channel: dir })).plans[0]!.plan!.items;
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ id, status: 'skipped' });
    expect(new Set(items.map((i) => i.candidate_id)).size).toBe(3);
    // mục đang làm không sửa được
    const f = path.join(dir, 'autopilot', 'plans', `${today}.json`);
    const doc = JSON.parse(readFileSync(f, 'utf8'));
    doc.items[1].status = 'in_production';
    writeFileSync(f, JSON.stringify(doc));
    expect((await edit({ title: 'x' }, doc.items[1].id)).error).toMatchObject({
      code: 'E_SCHEMA_INVALID',
    });
    // năng lực: trần đếm mục Autopilot đã bắt đầu (1)
    expect((await host.call('autopilot.capacity', {})).channels[0]).toMatchObject({ cap_left: 1 });
  });

  it('autopilot.status/pause/resume/run_now, autopilot.updated and app.activity (052 FR-AP-07/08)', async () => {
    const { host, dir, app, events } = setup();
    await host.call('channel.open', { channel: dir });
    const call = (key: string, value: unknown) =>
      host.call('channel.autopilot.set', { channel: dir, key, value });
    // chưa kênh nào bật Autopilot: trạng thái trống, không đang làm gì
    expect(await host.call('autopilot.status', {})).toEqual({
      paused: false,
      running: false,
      today: [],
    });
    await call('autopilot.enabled', true);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const channelId = JSON.parse(readFileSync(path.join(dir, 'channel.json'), 'utf8')).id;
    const item = (id: string, status: string, extra: object = {}) => ({
      id,
      status,
      candidate_id: `yt:${id}`,
      title: `Video ${id}`,
      angle: 'góc',
      source: { kind: 'trend' },
      workflow_id: 'demo-explainer',
      output_profile: 'yt-1080p30',
      publish_at: null,
      platforms: ['youtube'],
      score: 70,
      reasons: [],
      ...extra,
    });
    const putPlan = (items: object[]) => {
      mkdirSync(path.join(dir, 'autopilot', 'plans'), { recursive: true });
      writeFileSync(
        path.join(dir, 'autopilot', 'plans', `${today}.json`),
        JSON.stringify({
          schema_version: 1,
          channel_id: channelId,
          date: today,
          generated_at: new Date().toISOString(),
          capacity: { videos: 3, limiting_factor: 'cap', reasons: [] },
          items,
        }),
      );
    };
    const { video_id } = await host.call('video.create', { channel: dir, title: 'Đang làm' });
    putPlan([
      item('pi_a0000001', 'in_production', { video_id }),
      item('pi_a0000002', 'needs_review', {
        video_id: fixtureVideoId,
        note: 'Điểm 6,5 thấp hơn ngưỡng 8',
      }),
      item('pi_a0000003', 'skipped'),
    ]);
    const st = await host.call('autopilot.status', {});
    expect(st).toMatchObject({ paused: false, running: false });
    expect(st.today).toEqual([
      {
        channel: path.resolve(dir),
        name: expect.any(String),
        date: today,
        items: [
          expect.objectContaining({ id: 'pi_a0000001', status: 'in_production', video_id }),
          expect.objectContaining({
            id: 'pi_a0000002',
            status: 'needs_review',
            note: 'Điểm 6,5 thấp hơn ngưỡng 8',
          }),
          expect.objectContaining({ id: 'pi_a0000003', status: 'skipped' }),
        ],
      },
    ]);
    // đóng app khi video Autopilot đang làm dở → cảnh báo (045)
    expect((await host.call('app.activity', {})).autopilot).toEqual([
      {
        channel: path.resolve(dir),
        video: video_id,
        item_id: 'pi_a0000001',
        title: 'Video pi_a0000001',
      },
    ]);

    // tạm dừng / tiếp tục: ghi `autopilot.paused` (app), phát autopilot.updated
    events.length = 0;
    expect(await host.call('autopilot.pause', {})).toEqual({ paused: true });
    expect(JSON.parse(readFileSync(path.join(app, 'settings.json'), 'utf8')).config).toMatchObject({
      'autopilot.paused': true,
    });
    expect((await host.call('autopilot.status', {})).paused).toBe(true);
    expect(
      events.some(([n, d]) => n === 'autopilot.updated' && (d as { paused: boolean }).paused),
    ).toBe(true);
    expect(await host.call('autopilot.run_now', {})).toEqual({ started: false, reason: 'paused' });
    expect(await host.call('autopilot.resume', {})).toEqual({ paused: false });
    expect((await host.call('autopilot.status', {})).paused).toBe(false);

    // chạy ngay: không còn mục chờ làm (needs_review / skipped không được xếp hàng) → lượt chạy xong ngay
    putPlan([
      item('pi_a0000002', 'needs_review', { video_id: fixtureVideoId }),
      item('pi_a0000003', 'skipped'),
    ]);
    expect(await host.call('autopilot.run_now', {})).toEqual({ started: true });
    for (let i = 0; i < 100 && (await host.call('autopilot.status', {})).running; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect((await host.call('autopilot.status', {})).running).toBe(false);
    expect(events.some(([n]) => n === 'autopilot.updated')).toBe(true);
  });

  it('chat streams events, stores history, resumes the SDK session after reopen (FR-CH-02/07)', async () => {
    const { host, dir, app, events } = setup();
    await host.call('chat.send', { channel: dir, video: fixtureVideoId, text: 'Xin chào' });
    expect(
      events.filter(([n]) => n === 'chat.event').map(([, d]) => (d as { type: string }).type),
    ).toEqual(['text_delta', 'tool_call', 'tool_result', 'done']);
    const h = (await host.call('chat.history', { channel: dir, video: fixtureVideoId })).history;
    expect(h.map((l) => l.role)).toEqual(['user', 'assistant', 'tool']);
    expect(h[2]).toMatchObject({
      tool: { name: 'mcp__sf__config_resolve', output_summary: 'voice.id = vo_c3z8p1mn' },
    });
    host.close();
    // mở lại: phiên main tiếp tục bằng `resume`
    const ref2: { host?: CoreHost } = {};
    const rt2 = fakeRuntime(() => ref2.host!);
    const host2 = (ref2.host = new CoreHost({
      appDataDir: app,
      runtime: rt2,
      textMode: 'replay',
      textFixtureDir: app,
    }));
    cleanups.unshift(() => host2.close());
    expect(
      (await host2.call('video.open', { channel: dir, video: fixtureVideoId })).history,
    ).toHaveLength(3);
    await host2.call('chat.send', { channel: dir, video: fixtureVideoId, text: 'Tiếp' });
    expect(rt2.opened[0]).toMatchObject({ kind: 'main', resume: 'sdk-123' });
  });

  it('uploads go through the write module; types and sizes are checked (FR-CH-03)', async () => {
    const { host, dir } = setup();
    const t = tempDir('up-');
    cleanups.push(t.cleanup);
    writeFileSync(path.join(t.dir, 'giọng mẫu.wav'), Buffer.alloc(100));
    const r = await host.call('upload.ingest', {
      channel: dir,
      video: fixtureVideoId,
      path_on_disk: path.join(t.dir, 'giọng mẫu.wav'),
    });
    expect(r).toMatchObject({
      rel_path: expect.stringMatching(/^uploads\/[0-9a-f-]+\.wav$/),
      mime: 'audio/wav',
    });
    expect(existsSync(path.join(dir, 'videos', fixtureVideoId, r.rel_path))).toBe(true);
    writeFileSync(path.join(t.dir, 'x.exe'), 'x');
    expect(
      (
        await host.handle({
          id: 2,
          method: 'upload.ingest',
          params: { channel: dir, path_on_disk: path.join(t.dir, 'x.exe') },
        })
      ).error?.code,
    ).toBe('E_SCHEMA_INVALID');
  });

  it('explorer is a read-only view without derived folders (FR-WS-02)', async () => {
    const { host, dir } = setup();
    const tree = await host.call('explorer.tree', { channel: dir });
    const names = (tree.children ?? []).map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(['videos', 'channel.json', 'profile']));
    expect(names).not.toContain('cache');
    const md = await host.call('explorer.read', {
      channel: dir,
      path: `videos/${fixtureVideoId}/SCRIPT.md`,
    });
    expect(md).toMatchObject({ kind: 'text', content: expect.stringContaining('Lê Lợi') });
    expect((await host.call('explorer.read', { channel: dir, path: 'channel.json' })).kind).toBe(
      'json',
    );
    expect(
      (
        await host.handle({
          id: 3,
          method: 'explorer.read',
          params: { channel: dir, path: '../outside.txt' },
        })
      ).error?.code,
    ).toBe('E_PATH_OUTSIDE');
  });

  it('workflow selection raises an approval card; deciding it starts the workflow', async () => {
    const { host, dir, events } = setup();
    const { video_id } = await host.call('video.create', { channel: dir, title: 'Thử' });
    await host.call('video.open', { channel: dir, video: video_id });
    expect((await host.call('workflow.list', {})).workflows.map((w) => w.id)).toContain(
      'demo-explainer',
    );
    await host.call('workflow.select', {
      channel: dir,
      video: video_id,
      workflow_id: 'demo-explainer',
      output_profile: 'yt-1080p30',
    });
    const card = events.find(([n]) => n === 'approval.requested')![1] as {
      approval_id: string;
      title: string;
      step_id: string;
    };
    expect(card).toMatchObject({ step_id: 'brief', title: 'Brief' });
    const st = await host.call('approval.decide', {
      channel: dir,
      video: video_id,
      approval_id: card.approval_id,
      decision: 'approve',
    });
    expect(st.phase).toBe('workflow');
    expect(events.some(([n]) => n === 'workflow.updated')).toBe(true);
    // 041: agent báo tình trạng bước trong chat, lưu vào lịch sử của video
    await vi.waitFor(() => expect(events.some(([n]) => n === 'workflow.notice')).toBe(true));
    const notice = events.find(([n]) => n === 'workflow.notice')![1] as {
      line: { role: string; notice: { event: string; step_title: string } };
    };
    expect(notice.line.role).toBe('assistant');
    const h = await host.call('chat.history', { channel: dir, video: video_id });
    expect(h.history.some((l) => l.notice?.step_title === notice.line.notice.step_title)).toBe(
      true,
    );
  });

  it('jobs, traces, settings and status for the side panels', async () => {
    const { host, dir, events, app } = setup();
    // 045: chat đang trả lời → có trong app.activity (cảnh báo khi đóng app); xong → hết
    const sent = host.call('chat.send', { channel: dir, video: fixtureVideoId, text: 'x' });
    expect((await host.call('app.activity', {})).chats).toEqual([
      { channel: path.resolve(dir), video: fixtureVideoId },
    ]);
    await sent;
    expect(await host.call('app.activity', {})).toEqual({
      studio: [],
      steps: [],
      jobs: [],
      chats: [],
      autopilot: [],
    });
    const traces = (await host.call('trace.list', { video: fixtureVideoId })).traces as {
      trace_id: string;
      name: string;
    }[];
    expect(traces.length).toBeGreaterThan(0);
    expect(
      ((await host.call('trace.get', { trace_id: traces[0]!.trace_id })).spans as unknown[]).length,
    ).toBeGreaterThan(0);
    const r = (await host.core.gateway.call(
      { session_id: 'ss_test0001', kind: 'main', channel_dir: dir, video_id: fixtureVideoId },
      'tts.synthesize',
      { line_ids: 'all' },
    )) as { job_id: string };
    await host.core.gateway.call(
      { session_id: 'ss_test0001', kind: 'main', channel_dir: dir },
      'job.wait',
      { job_id: r.job_id, timeout_ms: 20_000 },
    );
    expect((await host.call('job.list', { video: fixtureVideoId })).jobs[0]).toMatchObject({
      kind: 'graph.build',
      status: 'succeeded',
    });
    expect(events.some(([n]) => n === 'job.updated')).toBe(true);
    await host.call('settings.set', { key: 'frame_build.parallel', value: 3 });
    expect(
      JSON.parse(readFileSync(path.join(app, 'settings.json'), 'utf8')).config[
        'frame_build.parallel'
      ],
    ).toBe(3);
    const status = await host.call('app.status', {});
    expect(status).toMatchObject({ auth: { ok: true }, core_version: expect.any(String) });
  });
});
