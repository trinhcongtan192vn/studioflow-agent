// 023 · SC-001 (FR-SC-07) — refine-loop storyboard: producer = phiên `producer` mới mỗi vòng, critic =
// text.review; vòng 2 nhận vấn đề của vòng 1; ghi reviews/ + steps.storyboard.refine.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCore,
  createVideo,
  storyboardExecutor,
  type AgentEvent,
  type AgentRuntime,
  type Core,
  type TextService,
  type VideoState,
  setAdvanced,
  setConfig,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideo, tempDir } from '../domain-helpers.js';

const c = copyChannel();
const t = tempDir('app-');
const packs = tempDir('packs-');
let core: Core;
let videoId = '';
const sessions: { id: string; kind: string; text: string }[] = [];
const reviews: number[] = [];

function stubText(): TextService {
  const usage = { input: 100, output: 20 };
  return {
    models: () => ({
      producer: { provider: 'claude', model: 'p' },
      critic: { provider: 'claude', model: 'c' },
      aux: { provider: 'claude', model: 'a' },
    }),
    generate: async () => ({ text: '', usage, cost_usd: 0, model: 'p' }),
    review: async (input) => {
      reviews.push(reviews.length + 1);
      const first = reviews.length === 1;
      return {
        score: first ? 6 : 9,
        criteria: input.rubric.criteria.map((x) => ({
          id: x.id,
          score: first ? 6 : 9,
          weight: x.weight,
        })),
        issues: first
          ? [
              {
                severity: 'major' as const,
                location: 'fr_*',
                text: 'Thiếu cảnh mở đầu giới thiệu bối cảnh',
              },
            ]
          : [],
        usage,
        cost_usd: 0,
        model: 'c',
      };
    },
  };
}

/** Phiên producer giả: ghi STORYBOARD mẫu (theo video) rồi báo xong bước. */
function producerRuntime(): AgentRuntime {
  return {
    id: 'fake',
    authStatus: async () => ({ ok: true, method: 'claude-plan' }),
    async openSession(o) {
      return {
        id: o.context.session_id,
        async *send(m: { text: string }): AsyncIterable<AgentEvent> {
          sessions.push({ id: o.context.session_id, kind: o.kind, text: m.text });
          const sb = readFileSync(path.join(fixtureVideo, 'STORYBOARD.md'), 'utf8').replace(
            'vd_8m2pq7rt',
            videoId,
          );
          const w = await core.gateway.call(o.context, 'artifact.write', {
            path: 'STORYBOARD.md',
            content: sb,
          });
          if (!w.ok) throw new Error(JSON.stringify(w));
          await core.gateway.call(o.context, 'workflow.step_complete', {
            step_id: 'storyboard',
            outputs: ['STORYBOARD.md'],
          });
          yield { type: 'done', stop_reason: 'end_turn' };
        },
        interrupt: async () => {},
        close: async () => {},
      };
    },
  };
}

beforeAll(() => {
  process.env.SF_GPU = '0';
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const dir = path.join(packs.dir, 'sb-refine');
  mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), '{"name": "workflow-sb-refine"}');
  writeFileSync(
    path.join(dir, 'workflow.yaml'),
    [
      'id: sb-refine',
      'version: 1.0.0',
      'title: Storyboard refine',
      'description: test 023',
      "app_api: '>=1.0 <2.0'",
      'output_profiles: [yt-1080p30]',
      'requires: [tts.synthesize]',
      'steps:',
      '  - { id: script, uses: script, title: Kịch bản }',
      '  - { id: storyboard, uses: storyboard, title: Storyboard, refine: { enabled: true, rubric: storyboard-default }, approval: { required: true } }',
      '',
    ].join('\n'),
  );
  core = createCore({ appDataDir: t.dir, workflowDirs: [packs.dir], permissionTimeoutMs: 2000 });
  // kịch bản viết sẵn (SCRIPT.md của video mẫu) — bước script giữ nguyên
  core.workflows.registerExecutor('script', async () => ({ outputs: ['SCRIPT.md'] }));
  core.workflows.registerExecutor(
    'storyboard',
    storyboardExecutor({
      text: stubText(),
      gateway: core.gateway,
      runtime: () => producerRuntime(),
    }),
  );
  const store = core.gateway.storeFor(c.dir);
  videoId = createVideo(store, { title: 'Thử' }).video_id;
  // 085: refine là tính năng nâng cao
  setAdvanced(store, 'advanced.refine', true);
  setConfig(store, 'refine.min_rounds', 2, { tier: 'channel' });
  // kịch bản có sẵn (line/beat của video mẫu)
  store.write(
    `videos/${videoId}/SCRIPT.md`,
    readFileSync(path.join(fixtureVideo, 'SCRIPT.md'), 'utf8').replace('vd_8m2pq7rt', videoId),
    { by: 'test' },
  );
});
afterAll(() => {
  core.close();
  c.cleanup();
  t.cleanup();
  packs.cleanup();
});

describe('storyboard refine-loop (023 FR-SC-07)', () => {
  it('runs a fresh producer session per round and stops when the critic passes', async () => {
    const e = core.workflows.engine(c.dir, videoId);
    await e.select('sb-refine', 'yt-1080p30');
    for (let i = 0; i < 3; i++) {
      await e.idle();
      const st = JSON.parse(
        readFileSync(path.join(c.dir, 'videos', videoId, 'state.json'), 'utf8'),
      ) as VideoState;
      const failed = Object.entries(st.steps).find(([, s]) => s.status === 'failed');
      if (failed) throw new Error(JSON.stringify(failed[1].error));
      const pending = st.approvals.find((a) => a.status === 'pending' && a.step_id === 'brief');
      if (pending) await e.approve(pending.id);
      else break;
    }
    const st = JSON.parse(
      readFileSync(path.join(c.dir, 'videos', videoId, 'state.json'), 'utf8'),
    ) as VideoState;
    expect(st.steps.storyboard).toMatchObject({
      status: 'waiting_approval',
      refine: { rounds: 2, final_score: 9 },
    });
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.kind === 'producer')).toBe(true);
    expect(new Set(sessions.map((s) => s.id)).size).toBe(2);
    expect(sessions[1]!.text).toContain('Thiếu cảnh mở đầu');
    for (const n of [1, 2])
      expect(
        existsSync(path.join(c.dir, 'videos', videoId, 'reviews', 'storyboard', `round-${n}.json`)),
      ).toBe(true);
    const note = st.approvals.find((a) => a.step_id === 'storyboard')!.note!;
    expect(note).toContain('Vòng 1: 6.0');
  }, 120_000);
});
