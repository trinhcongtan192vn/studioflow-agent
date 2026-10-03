// 015 · FR-OB-01 — trace cục bộ (D11 mục 1): span lồng tool → job → provider, refine round,
// phiên agent (TRACEPARENT), che bí mật, CLI sf trace.
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ClaudeAgentRuntime,
  createCore,
  getTrace,
  listTraces,
  runRefine,
  sessionOptionsFor,
  withSpan,
  type Core,
  type SessionContext,
} from '../../src/index.js';
import { runSf } from '../helpers.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function setup(): { core: Core; dir: string; app: string; session: SessionContext } {
  const c = copyChannel();
  const t = tempDir('app-');
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 1000, backoffMs: [10, 20] });
  cleanups.push(() => core.close(), c.cleanup, t.cleanup);
  return {
    core,
    dir: c.dir,
    app: t.dir,
    session: {
      session_id: 'ss_test0001',
      kind: 'main',
      channel_dir: c.dir,
      video_id: fixtureVideoId,
    },
  };
}

describe('trace store (015 FR-OB-01)', () => {
  it('tool → job → provider spans share one trace', async () => {
    const { core, session } = setup();
    const r = (await core.gateway.call(session, 'tts.synthesize', {
      line_ids: ['ln_9w3b6tqa'],
    })) as { job_id: string };
    await core.gateway.call(session, 'job.wait', { job_id: r.job_id, timeout_ms: 20_000 });
    const root = listTraces(core.db, { videoId: fixtureVideoId }).find(
      (s) => s.name === 'sf.tool' && s.attrs['sf.tool_name'] === 'tts.synthesize',
    )!;
    expect(root).toBeDefined();
    const spans = getTrace(core.db, root.trace_id);
    const job = spans.find((s) => s.name === 'sf.job')!;
    expect(job).toMatchObject({
      parent_id: root.span_id,
      depth: 1,
      attrs: { 'sf.kind': 'graph.build', 'sf.job_id': r.job_id },
    });
    const prov = spans.find((s) => s.name === 'sf.provider.run')!;
    expect(prov.attrs).toMatchObject({
      'sf.capability': 'tts.synthesize',
      'sf.provider': 'tts.fake',
      'sf.from_cache': false,
    });
    expect(prov.depth).toBeGreaterThan(job.depth);
    expect(root.attrs).toMatchObject({ 'sf.ok': true, 'sf.session_id': 'ss_test0001' });
  });

  it('refine rounds are child spans with scores; secrets are masked', async () => {
    const { core } = setup();
    const gen = { text: 'x', usage: { input: 1, output: 1 }, cost_usd: 0, model: 'p' };
    await withSpan(
      'sf.workflow.step',
      {
        'sf.step_id': 'script',
        'sf.video_id': 'vd_trace001',
        note: 'key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV',
      },
      () =>
        runRefine({
          min: 2,
          max: 2,
          threshold: 8,
          produce: async () => gen,
          revise: async () => gen,
          review: async () => ({
            score: 9,
            criteria: [],
            issues: [{ severity: 'minor', text: 'a' }],
            usage: { input: 1, output: 1 },
            cost_usd: 0,
            model: 'c',
          }),
          checks: () => [],
          canSpend: () => true,
        }),
    );
    const root = listTraces(core.db, { videoId: 'vd_trace001' })[0]!;
    expect(String(root.attrs.note)).not.toContain('ABCDEFGHIJKLMNOPQRSTUV');
    const rounds = getTrace(core.db, root.trace_id).filter((s) => s.name === 'sf.refine.round');
    expect(rounds.map((s) => s.attrs['sf.round'])).toEqual([1, 2]);
    expect(rounds[0]!.attrs).toMatchObject({
      'sf.score': 9,
      'sf.producer_model': 'p',
      'sf.critic_model': 'c',
      'sf.issues.minor': 1,
    });
  });

  it('agent sessions get a span with token usage and pass TRACEPARENT to the SDK', async () => {
    const { core, dir } = setup();
    let env: Record<string, string> = {};
    const rt = new ClaudeAgentRuntime({
      gateway: core.gateway,
      query: ((args: { options: { env: Record<string, string> } }) => {
        env = args.options.env;
        return (async function* () {
          yield {
            type: 'assistant',
            session_id: 's1',
            message: { content: [{ type: 'text', text: 'chào' }] },
          };
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 's1',
            usage: { input_tokens: 12, output_tokens: 3 },
            total_cost_usd: 0,
          };
        })();
      }) as never,
    });
    const ctx: SessionContext = {
      session_id: 'ss_agent001',
      kind: 'main',
      channel_dir: dir,
      video_id: fixtureVideoId,
    };
    const s = await rt.openSession(sessionOptionsFor('main', ctx, core.gateway));
    for await (const e of s.send({ text: 'xin chào' })) void e;
    expect(env.TRACEPARENT).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const span = listTraces(core.db, { videoId: fixtureVideoId }).find(
      (x) => x.name === 'sf.agent.session',
    )!;
    expect(span.attrs).toMatchObject({
      'sf.session_kind': 'main',
      'sf.session_id': 'ss_agent001',
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 3,
    });
    expect(env.TRACEPARENT).toContain(span.trace_id);
  });

  it('sf trace list/show read studioflow.db', async () => {
    const { core, app, session } = setup();
    await core.gateway.call(session, 'config.resolve', { key: 'voice.id' });
    const r = runSf(['trace', 'list', '--video', fixtureVideoId], { env: { SF_APP_DATA: app } });
    expect(r.code).toBe(0);
    const t = JSON.parse(r.stdout).traces.find((x: { name: string }) => x.name === 'sf.tool');
    expect(t).toBeDefined();
    const show = runSf(['trace', 'show', t.trace_id], { env: { SF_APP_DATA: app } });
    expect(JSON.parse(show.stdout).spans[0]).toMatchObject({ name: 'sf.tool', depth: 0 });
  });
});
