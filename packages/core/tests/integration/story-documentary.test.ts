// 023 · SC-002 (FR-WF-06) — workflow `story-documentary` chạy hết tới MP4 phát hành: TTS/ASR/ảnh giả
// (SF_GPU=0), text giả cho script/critic/meta, phiên producer giả cho storyboard (refine), phiên frame
// giả; asset sinh qua nút `asset`; HyperFrames + FFmpeg thật.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCore,
  createVideo,
  parseBlocksDoc,
  publishMetaExecutor,
  scriptExecutor,
  serializeBlocksDoc,
  storyboardExecutor,
  type AgentEvent,
  type AgentRuntime,
  type Core,
  type FramePacket,
  type SessionContext,
  type TextService,
  type VideoState,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, tempDir } from '../domain-helpers.js';
import { sampleFrame } from '../frame-helpers.js';

const SCRIPT_BODY = [
  '## Khởi nghĩa <!-- sf:beat -->',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Năm một nghìn bốn trăm mười tám, Lê Lợi dựng cờ khởi nghĩa ở Lam Sơn.',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Mười năm kháng chiến bắt đầu từ vùng núi Thanh Hóa.',
  '',
  '## Thắng lợi <!-- sf:beat -->',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Trận Chi Lăng năm một nghìn bốn trăm hai mươi bảy quyết định thế cục.',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Năm sau, nhà Hậu Lê ra đời.',
  '',
].join('\n');

const usage = { input: 10, output: 5 };
function stubText(): TextService {
  return {
    models: () => ({
      producer: { provider: 'claude', model: 'p' },
      critic: { provider: 'claude', model: 'c' },
      aux: { provider: 'claude', model: 'a' },
    }),
    generate: async (_r, input) => ({
      text: input.messages.some((m) => m.content.includes('JSON'))
        ? '{"title": "Khởi nghĩa Lam Sơn", "description": "Mười năm kháng chiến của Lê Lợi.", "tags": ["lịch sử"]}'
        : SCRIPT_BODY,
      usage,
      cost_usd: 0,
      model: 'p',
    }),
    review: async (input) => ({
      score: 9,
      criteria: input.rubric.criteria.map((c) => ({ id: c.id, score: 9, weight: c.weight })),
      issues: [],
      usage,
      cost_usd: 0,
      model: 'c',
    }),
  };
}

let core: Core;
let videoId = '';
const kinds: string[] = [];

/** Storyboard tài liệu: scene có setting/time_of_day/mood/look, layer nền sinh ảnh. */
function storyboard(script: string): string {
  const lines = [...script.matchAll(/sf:line id=(ln_[0-9a-z]{8})/g)].map((m) => m[1]!);
  const beats = [...script.matchAll(/sf:beat id=(bt_[0-9a-z]{8})/g)].map((m) => m[1]!);
  const frame = (i: number, ids: string[], beat: string, prompt: string, tr: boolean) =>
    [
      `### Frame ${i}`,
      '```sf-frame',
      `beat_ids: [${beat}]`,
      `line_ids: [${ids.join(', ')}]`,
      `intent: "Ảnh nền chậm rãi phóng to, chữ năm xuất hiện"`,
      'layers:',
      `  - { kind: background, asset_request: { source: generate, prompt: "${prompt}", aspect: "16:9" } }`,
      `  - { kind: text, text: "Mốc ${i}" }`,
      ...(tr ? ['transition_in: { type: crossfade, duration_ms: 500 }'] : []),
      '```',
      '',
    ].join('\n');
  return [
    '---',
    'schema_version: 1',
    `video_id: ${videoId}`,
    'status: draft',
    '---',
    '## Scene 1 — Lam Sơn',
    '```sf-scene',
    'title: Lam Sơn',
    'setting: núi rừng Thanh Hóa',
    'time_of_day: bình minh',
    'mood: hào hùng',
    'music: { query: "epic, slow, drums" }',
    '```',
    '',
    frame(
      1,
      lines.slice(0, 2),
      beats[0]!,
      'misty mountains of Thanh Hoa at dawn, 15th century Vietnam, painterly',
      false,
    ),
    frame(
      2,
      lines.slice(2),
      beats[1]!,
      'ancient battlefield at Chi Lang pass, banners, dramatic light',
      true,
    ),
  ].join('\n');
}

/** Runtime giả: phiên `producer` viết storyboard; phiên `frame` viết frame. */
function runtime(): AgentRuntime {
  return {
    id: 'fake',
    authStatus: async () => ({ ok: true, method: 'claude-plan' }),
    async openSession(o) {
      return {
        id: o.context.session_id,
        async *send(m: { text: string }): AsyncIterable<AgentEvent> {
          kinds.push(o.kind);
          if (o.kind === 'producer') {
            const script = readFileSync(
              core.gateway.storeFor(o.context.channel_dir).abs(`videos/${videoId}/SCRIPT.md`),
              'utf8',
            );
            const w = await core.gateway.call(o.context, 'artifact.write', {
              path: 'STORYBOARD.md',
              content: storyboard(script),
            });
            if (!w.ok) throw new Error(JSON.stringify(w));
            await core.gateway.call(o.context, 'workflow.step_complete', {
              step_id: 'storyboard',
              outputs: ['STORYBOARD.md'],
            });
          } else {
            const packet = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(m.text)![1]!) as FramePacket;
            const step = /"step_id": "([^"]+)"/.exec(m.text)![1]!;
            expect(packet.assets.length).toBeGreaterThan(0); // ảnh sinh có trong packet
            await core.gateway.call(o.context, 'artifact.write', {
              path: packet.output_path,
              content: sampleFrame(packet),
            });
            await core.gateway.call(o.context, 'workflow.step_complete', {
              step_id: step,
              frame_id: packet.frame.id,
              outputs: [packet.output_path],
            });
          }
          yield { type: 'done', stop_reason: 'end_turn' };
        },
        interrupt: async () => {},
        close: async () => {},
      };
    },
  };
}

const c = copyChannel();
const t = tempDir('app-');
const agentSteps: string[] = [];
const treatments: { mode: string; within_budget: boolean; applied: string[] }[] = [];
const v = () => path.join(c.dir, 'videos', videoId);

beforeAll(() => {
  process.env.SF_GPU = '0';
  writeFileSync(
    path.join(t.dir, 'settings.json'),
    readFileSync(path.join(fixtureAppData, 'settings.json')),
  );
  core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 5000, backoffMs: [10, 20] });
  core.workflows.registerExecutor('script', scriptExecutor({ text: stubText() }));
  core.workflows.registerExecutor('publish-meta', publishMetaExecutor({ text: stubText() }));
  core.workflows.registerExecutor(
    'storyboard',
    storyboardExecutor({
      text: stubText(),
      gateway: core.gateway,
      runtime: () => core.workflows.agentRuntime,
    }),
  );
  core.workflows.setAgentRuntime(runtime());
  // người dùng đồng ý sửa STORYBOARD.md đã duyệt (D5 5.1)
  core.gateway.permissions.on('permission.requested', (r: { request_id: string }) =>
    core.gateway.permissions.decide({ request_id: r.request_id, allow: true }),
  );
  core.workflows.setAgentRunner(async (instruction, ctx) => {
    const step = /bước (\S+) của workflow/.exec(instruction)![1]!;
    agentSteps.push(step);
    const session: SessionContext = {
      session_id: 'ss_agent001',
      kind: 'main',
      channel_dir: ctx.channelDir,
      video_id: ctx.videoId as SessionContext['video_id'],
    };
    if (step === 'music') {
      const r = await core.gateway.call(session, 'music.find', { query: 'epic, slow, drums' });
      expect(r).toMatchObject({ ok: false, error: { code: 'E_MUSIC_NOT_FOUND' } });
    }
    if (step === 'effects') {
      // 027: dry-run rồi áp hạt phim cho frame dùng ảnh nền đầu tiên (FN-common 6)
      const g = JSON.parse(
        readFileSync(ctx.store.abs(`videos/${ctx.videoId}/.sf/graph.json`), 'utf8'),
      ) as { nodes: Record<string, { meta?: { asset_id?: string } }> };
      const asset = Object.entries(g.nodes)
        .filter(([id]) => id.startsWith('asset:'))
        .map(([, n]) => n.meta!.asset_id!)
        .sort()[0]!;
      for (const mode of ['dry_run', 'apply']) {
        const j = (await core.gateway.call(session, 'media.treatment', {
          asset_id: asset,
          effect: 'grain',
          mode,
        })) as { ok: boolean; job_id: string };
        expect(j.ok).toBe(true);
        const w = (await core.gateway.call(session, 'job.wait', {
          job_id: j.job_id,
          timeout_ms: 60_000,
        })) as { data: { status: string; result: (typeof treatments)[number] } };
        expect(w.data.status).toBe('succeeded');
        treatments.push(w.data.result);
      }
    }
    await ctx.stepComplete(step === 'music' || step === 'effects' ? ['STORYBOARD.md'] : []);
  });
  const store = core.gateway.storeFor(c.dir);
  videoId = createVideo(store, { title: 'Khởi nghĩa Lam Sơn' }).video_id;
  const briefRel = `videos/${videoId}/BRIEF.md`;
  const brief = parseBlocksDoc(readFileSync(store.abs(briefRel), 'utf8'));
  brief.body = [
    '# Brief',
    '',
    'Chủ đề: khởi nghĩa Lam Sơn 1418–1428. Khán giả: học sinh. Mốc: 1418, 1427, 1428.',
    '',
  ];
  store.write(briefRel, serializeBlocksDoc(brief), { by: 'test' });
}, 120_000);
afterAll(() => {
  core.close();
  c.cleanup();
  t.cleanup();
});

const state = () => JSON.parse(readFileSync(path.join(v(), 'state.json'), 'utf8')) as VideoState;

describe('story-documentary end to end (023 FR-WF-06)', () => {
  it('runs every step to a release MP4 with generated images and a refined storyboard', async () => {
    const e = core.workflows.engine(c.dir, videoId);
    expect(
      core.workflows.packs().find((p) => p.manifest.id === 'story-documentary')?.compatible,
    ).toBe(true);
    await e.select('story-documentary', 'yt-1080p30');
    const approved: string[] = [];
    for (let i = 0; i < 12; i++) {
      await e.idle();
      const st = state();
      const failed = Object.entries(st.steps).find(([, s]) => s.status === 'failed');
      if (failed) throw new Error(`step ${failed[0]} failed: ${JSON.stringify(failed[1].error)}`);
      if (st.steps.render?.status === 'done') break;
      const pending = st.approvals.find((a) => a.status === 'pending');
      if (!pending) throw new Error(`stuck: ${JSON.stringify(e.summary().steps)}`);
      approved.push(pending.step_id);
      await e.approve(pending.id);
    }
    // effects sửa STORYBOARD.md đã duyệt → duyệt lại storyboard (D6 3.1)
    expect(approved).toEqual(['brief', 'script', 'storyboard', 'storyboard', 'finalize']);
    // assets do engine (nút asset); look/effects/overlays (027) + music giao phiên main
    expect(agentSteps).toEqual(['look', 'effects', 'overlays', 'music']);
    expect(treatments.map((t) => [t.mode, t.within_budget, t.applied.length])).toEqual([
      ['dry_run', true, 0],
      ['apply', true, 1],
    ]);
    expect(kinds.filter((k) => k === 'producer')).toHaveLength(2); // refine min 2 vòng
    const st = state();
    expect(st.steps.storyboard!.refine).toMatchObject({ rounds: 2 });
    expect(st.steps.assets!.status).toBe('done');
    const g = JSON.parse(readFileSync(path.join(v(), '.sf', 'graph.json'), 'utf8')) as {
      nodes: Record<string, { meta?: { asset_id?: string } }>;
    };
    const assetIds = Object.entries(g.nodes)
      .filter(([id]) => id.startsWith('asset:'))
      .map(([, n]) => n.meta!.asset_id!);
    expect(assetIds).toHaveLength(2);
    for (const a of assetIds) expect(existsSync(path.join(v(), 'public', `${a}.png`))).toBe(true);
    // look kênh (warm-archive) + hạt phim → data-color-grading đã chuẩn hóa trên ảnh của frame
    const fr = treatments[1]!.applied[0]!;
    const html = readFileSync(path.join(v(), 'compositions', 'frames', `${fr}.html`), 'utf8');
    // look kênh nướng vào ảnh (027 R2): src → public/looks/…, gốc giữ ở data-sf-src
    const img = /<img[^>]*>/.exec(html)![0];
    const baked = /\ssrc="([^"]+)"/.exec(img)![1]!;
    expect(baked).toMatch(/^public\/looks\/as_[0-9a-z]{8}-[0-9a-f]{12}\.png$/);
    expect(existsSync(path.join(v(), baked))).toBe(true);
    expect(img).toMatch(/data-sf-src="public\/as_[0-9a-z]{8}\.png"/);
    // hạt phim (hiệu ứng) áp lúc render: data-color-grading đã chuẩn hóa
    const grading = JSON.parse(
      /data-color-grading="([^"]+)"/
        .exec(img)![1]!
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&'),
    );
    expect(grading).toMatchObject({ preset: null, details: { grain: 0.25 } });
    const release = st.steps.render!.outputs!.find((o) => o.endsWith('video.mp4'))!;
    expect(existsSync(path.join(v(), release))).toBe(true);
  }, 900_000);
});
