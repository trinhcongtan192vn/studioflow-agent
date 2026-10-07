// 055 · FR-AP-11/12 — bot Telegram + phiên `ops`: chính sách tool của Gateway, OpsAgent với runtime giả, nhật ký
// phiên ở ops/sessions/, vòng nhận tin → lệnh/hỏi đáp → trả lời, thông báo từ bộ chạy Autopilot, IPC telegram.*.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CoreHost,
  MemorySecretStore,
  type AgentEvent,
  type AgentRuntime,
  type SessionOptions,
} from '../../src/index.js';
import { setChannelAutopilot } from '../../src/autopilot/index.js';
import { RUNTIME_BUILTINS } from '../../src/agent/policy.js';
import { sessionOptionsFor, MAX_TURNS } from '../../src/agent/options.js';
import { OPS_SYSTEM_APPEND } from '../../src/agent/system-append.js';
import { OpsAgent, OPS_CONSTANTS } from '../../src/telegram/ops.js';
import { WriteStore } from '../../src/store/writer.js';
import { copyChannel, fixtureAppData, tempDir } from '../domain-helpers.js';
import { workflowFixtures } from '../workflow-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const TOKEN = '123456789:AAEhBP0av28gXAAxxxxxxxxxxxxxxxxxxxx';
const GROUP = -100777;

/** Runtime giả: ghi lại SessionOptions, trả lời từ `answer` (mặc định "Trả lời: <câu hỏi>"), có thể gọi tool qua Gateway. */
function fakeRuntime(
  host: () => CoreHost | undefined,
  o: {
    answer?: (text: string, opts: SessionOptions) => string;
    events?: (text: string) => AgentEvent[];
  } = {},
) {
  const opened: SessionOptions[] = [];
  const asked: string[] = [];
  const rt: AgentRuntime = {
    id: 'fake',
    authStatus: async () => ({ ok: true, method: 'claude-plan' }),
    async openSession(opts) {
      opened.push(opts);
      return {
        id: opts.context.session_id,
        async *send(m: { text: string }): AsyncIterable<AgentEvent> {
          asked.push(m.text);
          if (o.events) {
            yield* o.events(m.text);
            return;
          }
          if (opts.kind === 'ops' && host()) {
            const r = await host()!.core.gateway.call(opts.context, 'ops.channels', {});
            yield { type: 'tool_call', id: 't1', name: 'mcp__sf__ops_channels', input: {} };
            yield { type: 'tool_result', id: 't1', ok: r.ok, summary: r.ok ? 'ok' : 'lỗi' };
          }
          yield {
            type: 'text_delta',
            text: o.answer ? o.answer(m.text, opts) : `Trả lời: ${m.text.slice(0, 60)}`,
          };
          yield { type: 'done', stop_reason: 'end_turn' };
        },
        interrupt: async () => {},
        close: async () => {},
      } as never;
    },
  };
  return { rt, opened, asked };
}

/** `fetch` giả của Bot API: hàng đợi update, ghi lại sendMessage/answerCallbackQuery. */
function fakeTelegram() {
  const queue: object[] = [];
  const sent: { chat_id: number | string; text: string; parse_mode?: string }[] = [];
  const answered: object[] = [];
  const calls: string[] = [];
  const reply = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
  const f = async (url: string, init?: { body?: unknown }) => {
    const method = url.split('/').pop()!;
    calls.push(method);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    if (method === 'getMe')
      return reply({ id: 900, is_bot: true, username: 'sf_bot', first_name: 'SF' });
    if (method === 'getUpdates') {
      if (queue.length) return reply(queue.splice(0));
      await new Promise((r) => setTimeout(r, 15));
      return reply([]);
    }
    if (method === 'sendMessage') {
      sent.push(body);
      return reply({ message_id: sent.length, chat: { id: body.chat_id, type: 'supergroup' } });
    }
    if (method === 'answerCallbackQuery') answered.push(body);
    return reply(true);
  };
  let uid = 1000;
  const say = (text: string, extra: object = {}, from = { id: 11, first_name: 'Alice' }) =>
    queue.push({
      update_id: ++uid,
      message: { message_id: uid, chat: { id: GROUP, type: 'supergroup' }, from, text, ...extra },
    });
  return { f, sent, answered, calls, queue, say };
}

const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
};

function setup(rtOpts: Parameters<typeof fakeRuntime>[1] = {}) {
  const c = copyChannel();
  const t = tempDir('app-');
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const tg = fakeTelegram();
  const secrets = new MemorySecretStore({ telegram_bot_token: TOKEN });
  const ref: { host?: CoreHost } = {};
  const rtr = fakeRuntime(() => ref.host, rtOpts);
  const host = (ref.host = new CoreHost({
    appDataDir: t.dir,
    workflowDirs: [workflowFixtures],
    runtime: rtr.rt,
    permissionTimeoutMs: 500,
    textMode: 'replay',
    textFixtureDir: t.dir,
    secrets,
    telegramFetch: tg.f as never,
    telegramSleep: async () => {},
  }));
  cleanups.push(() => host.close(), c.cleanup, t.cleanup);
  return { host, dir: c.dir, app: t.dir, tg, secrets, ...rtr };
}

async function enableAutopilot(host: CoreHost, dir: string) {
  await host.call('channel.open', { channel: dir });
  setChannelAutopilot(new WriteStore(dir), 'autopilot.enabled', true);
  setChannelAutopilot(new WriteStore(dir), 'autopilot.max_per_day', 5);
}

function putPlan(dir: string, items: object[], date = DATE) {
  const channel = JSON.parse(readFileSync(path.join(dir, 'channel.json'), 'utf8'));
  mkdirSync(path.join(dir, 'autopilot', 'plans'), { recursive: true });
  writeFileSync(
    path.join(dir, 'autopilot', 'plans', `${date}.json`),
    JSON.stringify({
      schema_version: 1,
      channel_id: channel.id,
      date,
      generated_at: new Date().toISOString(),
      capacity: { videos: 3, limiting_factor: 'cap', reasons: [] },
      items,
    }),
  );
  return channel.name as string;
}
const item = (id: string, status: string, extra: object = {}) => ({
  id,
  status,
  candidate_id: `yt:${id}`,
  title: `Video ${id}`,
  angle: 'góc',
  source: { kind: 'trend' },
  workflow_id: 'demo-explainer',
  output_profile: 'yt-1080p30',
  publish_at: '2026-10-07T19:00:00+07:00',
  platforms: ['youtube'],
  score: 70,
  reasons: [],
  ...extra,
});

const opsCtx = (app: string) => ({
  session_id: 'ss_ops00001' as const,
  kind: 'ops' as const,
  channel_dir: app,
});

describe('ops session policy (D5 mục 4)', () => {
  it('tool set: read tools + pause/resume + plan_update; nothing that writes files', async () => {
    const { host } = setup();
    const names = host.core.gateway.list('ops').map((t) => t.name);
    expect(names).toEqual(
      [
        'autopilot.pause',
        'autopilot.plan_get',
        'autopilot.plan_update',
        'autopilot.resume',
        'autopilot.status',
        'job.list',
        'ops.channels',
        'ops.log',
        'ops.sessions',
        'research.get',
      ].sort(),
    );
    expect(names).not.toContain('artifact.write');
    expect(RUNTIME_BUILTINS.ops).toEqual([]);
    const o = sessionOptionsFor('ops', opsCtx('/app'), host.core.gateway);
    expect(o).toMatchObject({ kind: 'ops', maxTurns: MAX_TURNS.ops, plugins: [] });
    expect(o.tools.allowed.every((t) => t.startsWith('mcp__sf__'))).toBe(true);
    expect(o.systemAppend).toBe(OPS_SYSTEM_APPEND);
    expect(OPS_SYSTEM_APPEND).toMatch(/tiếng Việt/);
    // main không mất tool nào và nhận thêm pause/resume
    const main = host.core.gateway.list('main').map((t) => t.name);
    expect(main).toEqual(
      expect.arrayContaining(['autopilot.plan_run', 'autopilot.pause', 'research.scan']),
    );
    expect(main).not.toContain('ops.channels');
  });

  it('denied for ops: writes, plan_run, research.scan, workflow, config', async () => {
    const { host, app } = setup();
    for (const [tool, input] of [
      ['artifact.write', { path: 'x.md', content: 'x' }],
      ['autopilot.plan_run', {}],
      ['research.scan', {}],
      ['workflow.state', {}],
      ['config.set', { key: 'voice.id', value: 'x', tier: 'channel' }],
      ['script.run', {}],
    ] as const) {
      const r = await host.core.gateway.call(opsCtx(app), tool, input);
      expect(r, tool).toMatchObject({ ok: false, error: { code: 'E_TOOL_DENIED' } });
    }
  });

  it('channel argument: by name or path; unknown → E_ID_UNKNOWN; required where needed; refused for main', async () => {
    const { host, dir, app } = setup();
    await enableAutopilot(host, dir);
    const name = putPlan(dir, [
      item('pi_a0000001', 'planned'),
      item('pi_a0000002', 'needs_review', { note: 'Điểm 6,5' }),
    ]);
    const g = host.core.gateway;
    const byName = (await g.call(opsCtx(app), 'autopilot.plan_get', {
      channel: name.toUpperCase(),
    })) as { ok: true; data: { items: unknown[] } };
    expect(byName.ok).toBe(true);
    expect(byName.data.items).toHaveLength(2);
    expect(
      await g.call(opsCtx(app), 'autopilot.plan_get', { channel: path.resolve(dir) }),
    ).toMatchObject({ ok: true });
    expect(
      await g.call(opsCtx(app), 'autopilot.plan_get', { channel: 'không có kênh này' }),
    ).toMatchObject({ ok: false, error: { code: 'E_ID_UNKNOWN' } });
    expect(await g.call(opsCtx(app), 'autopilot.plan_get', {})).toMatchObject({
      ok: false,
      error: { code: 'E_SCHEMA_INVALID', message: expect.stringContaining('channel is required') },
    });
    const main = { session_id: 'ss_main0001' as const, kind: 'main' as const, channel_dir: dir };
    expect(await g.call(main, 'autopilot.plan_get', { channel: name })).toMatchObject({
      ok: false,
      error: { code: 'E_SCHEMA_INVALID' },
    });
    expect(await g.call(main, 'autopilot.plan_get', {})).toMatchObject({ ok: true });
  });

  it('ops.channels, autopilot.status (all channels / one), ops.log, plan_update (skip), pause/resume, job.list', async () => {
    const { host, dir, app } = setup();
    await enableAutopilot(host, dir);
    const name = putPlan(dir, [
      item('pi_a0000001', 'planned'),
      item('pi_a0000002', 'needs_review', { note: 'Điểm 6,5' }),
    ]);
    const g = host.core.gateway;
    const call = async (tool: string, input: object) =>
      (await g.call(opsCtx(app), tool, input)) as { ok: boolean; data: any; error?: any };
    const ch = await call('ops.channels', {});
    expect(ch.data.channels).toEqual([
      { path: path.resolve(dir), name, date: DATE, items: { planned: 1, needs_review: 1 } },
    ]);
    const all = await call('autopilot.status', {});
    expect(all.data.today).toHaveLength(1);
    const one = await call('autopilot.status', { channel: name });
    expect(one.data.today.items.map((i: { id: string }) => i.id)).toEqual([
      'pi_a0000001',
      'pi_a0000002',
    ]);
    new WriteStore(dir).appendLine(
      `autopilot/log/${DATE}.jsonl`,
      JSON.stringify({
        ts: '2026-10-07T01:00:00.000Z',
        level: 'warn',
        event: 'item.parked',
        message: 'Đỗ video',
      }),
      { by: 'test' },
    );
    const log = await call('ops.log', { channel: name, limit: 5 });
    expect(log.data.lines).toEqual([expect.objectContaining({ event: 'item.parked' })]);
    expect((await call('ops.log', {})).error.code).toBe('E_SCHEMA_INVALID');
    // bỏ qua một mục
    const upd = await call('autopilot.plan_update', {
      channel: name,
      date: DATE,
      item_id: 'pi_a0000001',
      patch: { status: 'skipped' },
    });
    expect(upd.data.status).toBe('skipped');
    // tạm dừng / tiếp tục
    expect((await call('autopilot.pause', {})).data).toEqual({ paused: true });
    expect((await call('autopilot.status', {})).data.paused).toBe(true);
    expect(
      JSON.parse(readFileSync(path.join(app, 'settings.json'), 'utf8')).config['autopilot.paused'],
    ).toBe(true);
    expect((await call('autopilot.resume', {})).data).toEqual({ paused: false });
    expect((await call('job.list', {})).ok).toBe(true);
  });
});

describe('OpsAgent', () => {
  function agent(answer: (t: string) => string = (t) => `ok: ${t}`) {
    const { rt, opened, asked } = fakeRuntime(() => undefined, { answer });
    const a = new OpsAgent({
      runtime: rt,
      gateway: { list: () => [] } as never,
      appDataDir: '/app',
    });
    return { a, opened, asked };
  }
  it('one session per chat, reused for MAX_QUESTIONS then renewed', async () => {
    const { a, opened } = agent();
    expect(await a.ask('c1', 'một')).toBe('ok: một');
    await a.ask('c1', 'hai');
    await a.ask('c2', 'khác chat');
    expect(opened.map((o) => o.kind)).toEqual(['ops', 'ops']);
    expect(opened[0]!.context).toMatchObject({ kind: 'ops', channel_dir: '/app' });
    for (let i = 0; i < OPS_CONSTANTS.MAX_QUESTIONS; i++) await a.ask('c1', `câu ${i}`);
    expect(opened).toHaveLength(3);
    expect(new Set(opened.map((o) => o.context.session_id)).size).toBe(3);
  });
  it('runtime errors become a Vietnamese message and the next question opens a fresh session', async () => {
    const { rt, opened } = fakeRuntime(() => undefined, {
      events: () => [{ type: 'error', code: 'E_RUNTIME_RATE_LIMIT', message: 'hit your limit' }],
    });
    const a = new OpsAgent({
      runtime: rt,
      gateway: { list: () => [] } as never,
      appDataDir: '/app',
    });
    expect(await a.ask('c', 'x')).toMatch(/chưa trả lời được.*E_RUNTIME_RATE_LIMIT/);
    await a.ask('c', 'y');
    expect(opened).toHaveLength(2);
  });
});

describe('Telegram end to end through the host', () => {
  async function ready(rtOpts?: Parameters<typeof fakeRuntime>[1]) {
    const s = setup(rtOpts);
    await enableAutopilot(s.host, s.dir);
    await s.host.call('settings.set', { key: 'telegram.chat_id', value: String(GROUP) });
    await s.host.call('settings.set', { key: 'telegram.enabled', value: true });
    await until(() => s.tg.calls.includes('getUpdates'));
    return s;
  }

  it('settings are validated; telegram.status shows the bot running; telegram.test posts to the group', async () => {
    const s = await ready();
    const bad = await s.host.handle({
      id: 1,
      method: 'settings.set',
      params: { key: 'telegram.chat_id', value: 'nhóm abc' },
    });
    expect(bad.error).toMatchObject({ code: 'E_SCHEMA_INVALID' });
    expect(
      (
        await s.host.handle({
          id: 2,
          method: 'settings.set',
          params: { key: 'telegram.allowed_user_ids', value: ['abc'] },
        })
      ).error,
    ).toMatchObject({ code: 'E_SCHEMA_INVALID' });
    await new Promise((r) => setTimeout(r, 50));
    expect(await s.host.call('telegram.status', {})).toMatchObject({
      enabled: true,
      state: 'running',
      bot_username: 'sf_bot',
      chat_id_set: true,
      has_token: true,
    });
    expect(await s.host.call('telegram.test', {})).toEqual({ ok: true });
    expect(s.tg.sent.at(-1)).toMatchObject({
      chat_id: String(GROUP),
      text: expect.stringContaining('đã kết nối Telegram'),
    });
  });

  it('telegram.set_token verifies with getMe, stores the secret and never echoes it', async () => {
    const s = setup();
    expect(await s.host.call('telegram.status', {})).toMatchObject({
      enabled: false,
      has_token: true,
    });
    const r = await s.host.call('telegram.set_token', {
      token: '555555555:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    });
    expect(r).toEqual({ ok: true, bot_username: 'sf_bot' });
    expect(await s.secrets.get('telegram_bot_token')).toBe(
      '555555555:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    );
    expect(JSON.stringify(r)).not.toContain('BBBB');
    expect(
      (await s.host.handle({ id: 3, method: 'telegram.set_token', params: { token: 'xin chào' } }))
        .error,
    ).toMatchObject({ code: 'E_SCHEMA_INVALID' });
    expect(JSON.stringify(readFileSync(path.join(s.app, 'settings.json'), 'utf8'))).not.toContain(
      'BBBBBBBB',
    );
  });

  it('commands: /status and /plan reply with live data; /pause and /resume flip autopilot.paused', async () => {
    const s = await ready();
    const name = putPlan(s.dir, [
      item('pi_a0000001', 'produced'),
      item('pi_a0000002', 'needs_review', { note: 'Điểm 6,5 thấp hơn ngưỡng 8' }),
    ]);
    s.tg.say('/status');
    await until(() => s.tg.sent.some((m) => m.text.includes('Autopilot đang chờ lượt')));
    const status = s.tg.sent.find((m) => m.text.includes('Autopilot đang chờ lượt'))!;
    expect(status.parse_mode).toBe('HTML');
    expect(status.text).toContain(name.replace(/&/g, '&amp;'));
    s.tg.say('/plan');
    await until(() => s.tg.sent.some((m) => m.text.includes('Điểm 6,5 thấp hơn ngưỡng 8')));
    s.tg.say('/pause');
    await until(() => s.tg.sent.some((m) => m.text.includes('Đã tạm dừng')));
    expect((await s.host.call('autopilot.status', {})).paused).toBe(true);
    s.tg.say('/resume');
    await until(() => s.tg.sent.some((m) => m.text.includes('Đã tiếp tục')));
    expect((await s.host.call('autopilot.status', {})).paused).toBe(false);
    s.tg.say('/report');
    await until(() => s.tg.sent.some((m) => m.text.includes('Báo cáo hằng ngày')));
  });

  it('a question (mention) goes to an ops session; the answer is posted; the session is logged under ops/sessions', async () => {
    const s = await ready({ answer: () => 'Hôm nay có 2 video: 1 xong, 1 cần bạn xem.' });
    putPlan(s.dir, [item('pi_a0000001', 'produced')]);
    const text = '@sf_bot hôm nay thế nào?';
    s.tg.say(text, { entities: [{ type: 'mention', offset: 0, length: 7 }] });
    await until(() => s.tg.sent.some((m) => m.text.includes('Hôm nay có 2 video')));
    expect(s.opened.map((o) => o.kind)).toEqual(['ops']);
    expect(s.asked[0]).toContain('hôm nay thế nào?');
    expect(s.asked[0]).toContain('Alice');
    expect(s.asked[0]).not.toContain('@sf_bot');
    // nhật ký phiên ở ops/sessions/ và liệt kê qua IPC khi không có kênh
    const { sessions } = await s.host.call('sessions.list', {});
    expect(sessions).toEqual([
      expect.objectContaining({
        kind: 'ops',
        source: 'session',
        lines: expect.any(Number),
        title: expect.stringContaining('hôm nay thế nào?'),
      }),
    ]);
    const lines = (await s.host.call('sessions.get', { id: sessions[0]!.id })).lines;
    expect(lines.map((l) => l.role)).toEqual(
      expect.arrayContaining(['system', 'user', 'tool', 'assistant']),
    );
    expect(lines.find((l) => l.role === 'tool')!.tool).toMatchObject({
      name: 'mcp__sf__ops_channels',
      ok: true,
    });
    expect(existsOps(s.app, sessions[0]!.id)).toBe(true);
    // plain group chatter and strangers are ignored
    s.tg.say('chào mọi người');
    s.tg.say('/status', {}, { id: 77, first_name: 'Người lạ' });
    await new Promise((r) => setTimeout(r, 80));
    expect(s.asked).toHaveLength(1);
  });

  it('the allow-list blocks other members', async () => {
    const s = await ready();
    await s.host.call('settings.set', { key: 'telegram.allowed_user_ids', value: ['99'] });
    s.tg.say('/status');
    await new Promise((r) => setTimeout(r, 120));
    expect(s.tg.sent.filter((m) => m.text.includes('Autopilot'))).toHaveLength(0);
  });

  it('the offset is persisted in app-data and holds no secrets', async () => {
    const s = await ready();
    s.tg.say('/help');
    await until(() => s.tg.sent.some((m) => m.text.includes('StudioFlow Autopilot')));
    await new Promise((r) => setTimeout(r, 30));
    const f = path.join(s.app, 'telegram', 'offset.json');
    const o = JSON.parse(readFileSync(f, 'utf8'));
    expect(o.offset).toBeGreaterThan(1000);
    expect(readFileSync(f, 'utf8')).not.toContain('AAEh');
  });

  it('notifier: a failed Autopilot item is announced in the group', async () => {
    const s = await ready();
    const name = putPlan(s.dir, [item('pi_a0000001', 'planned')]);
    s.host.core.autopilot.setBrief(async () => {
      throw new Error('agent chết');
    });
    await s.host.call('settings.set', { key: 'autopilot.work_window', value: '00:00-23:59' });
    await s.host.call('autopilot.run_now', {});
    await until(() => s.tg.sent.some((m) => m.text.startsWith('❌')), 8000);
    const m = s.tg.sent.find((x) => x.text.startsWith('❌'))!;
    expect(m.text).toContain(`<b>${name.replace(/&/g, '&amp;')}</b>`);
    expect(m.text).toContain('agent chết');
    expect(m.parse_mode).toBe('HTML');
  });

  it('401 from Telegram disables the bot with a clear status; nothing crashes', async () => {
    const s = setup();
    const bad = (async () =>
      new Response(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }), {
        status: 401,
      })) as never;
    s.host.close();
    const c = copyChannel();
    const t = tempDir('app-');
    copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
    const host = new CoreHost({
      appDataDir: t.dir,
      workflowDirs: [workflowFixtures],
      runtime: fakeRuntime(() => undefined).rt,
      secrets: new MemorySecretStore({ telegram_bot_token: TOKEN }),
      telegramFetch: bad,
      telegramSleep: async () => {},
    });
    cleanups.push(() => host.close(), c.cleanup, t.cleanup);
    await host.call('settings.set', { key: 'telegram.enabled', value: true });
    await until(() => host.telegram['botStatus'].state === 'disabled');
    expect(await host.call('telegram.status', {})).toMatchObject({
      enabled: true,
      state: 'disabled',
      reason: 'token_invalid',
    });
  });
});

function existsOps(app: string, id: string): boolean {
  try {
    return readFileSync(path.join(app, 'ops', 'sessions', `${id}.jsonl`), 'utf8').length > 0;
  } catch {
    return false;
  }
}
