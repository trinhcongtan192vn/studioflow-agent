// 008 · FR-CH-02/03/07, FR-WS-02 — CoreHost (tiến trình core của app): IPC D10, chat + lịch sử,
// đính kèm, explorer chỉ đọc, thẻ duyệt, job/trace (runtime agent giả, SF_GPU=0).
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
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
  });

  it('jobs, traces, settings and status for the side panels', async () => {
    const { host, dir, events, app } = setup();
    await host.call('chat.send', { channel: dir, video: fixtureVideoId, text: 'x' });
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
