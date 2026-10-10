// 023 · SC-002 (FR-WF-06) — workflow `story-documentary` (luồng v2) chạy hết tới MP4 phát hành: TTS/ASR/ảnh
// giả (SF_GPU=0), text giả cho script/critic/meta + đạo diễn giả; ảnh sinh ở bước `media` (nút `asset`), frame
// có ảnh từ bộ layout, look kênh nướng vào ảnh; HyperFrames + FFmpeg thật.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeStudio } from '../../src/testing/gpu.js';
import {
  createCore,
  createVideo,
  parseBlocksDoc,
  publishMetaExecutor,
  scriptExecutor,
  serializeBlocksDoc,
  directExecutor,
  type Core,
  type TextService,
  type VideoState,
  setAdvanced,
  setConfig,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, tempDir } from '../domain-helpers.js';
import { publishWaiting } from '../workflow-helpers.js';
import { withDirector } from '../workflow-e2e-helpers.js';

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

const c = copyChannel();
const t = tempDir('app-');
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
  core.workflows.registerExecutor('direct', directExecutor({ text: withDirector(stubText()) }));
  core.workflows.setAgentRunner(async (instruction) => {
    throw new Error(`unexpected agent step: ${instruction.slice(0, 60)}`);
  });
  const store = core.gateway.storeFor(c.dir);
  videoId = createVideo(store, { title: 'Khởi nghĩa Lam Sơn' }).video_id;
  // 085: test đường refine kịch bản — bật tính năng nâng cao, giữ 2 vòng như trước
  setAdvanced(store, 'advanced.refine', true);
  setConfig(store, 'refine.min_rounds', 2, { tier: 'channel' });
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

describeStudio('story-documentary end to end (023 FR-WF-06)', () => {
  it('runs every step to a release MP4 with generated images in image layouts', async () => {
    const e = core.workflows.engine(c.dir, videoId);
    expect(
      core.workflows.packs().find((p) => p.manifest.id === 'story-documentary')?.compatible,
    ).toBe(true);
    await e.select('story-documentary', 'yt-1080p30');
    const approved: string[] = [];
    for (let i = 0; i < 12; i++) {
      await e.idle();
      const st = state();
      const failed = Object.entries(st.steps).find(
        ([, s]) => s.status === 'failed' && !publishWaiting(s),
      );
      if (failed) throw new Error(`step ${failed[0]} failed: ${JSON.stringify(failed[1].error)}`);
      if (st.steps.render?.status === 'done') {
        // 091: sau Render phát hành, bước Đăng chờ người dùng chọn nền tảng
        expect(publishWaiting(st.steps.publish)).toBe(true);
        break;
      }
      const pending = st.approvals.find((a) => a.status === 'pending');
      if (!pending) throw new Error(`stuck: ${JSON.stringify(e.summary().steps)}`);
      approved.push(pending.step_id);
      await e.approve(pending.id);
    }
    expect(approved).toEqual(['brief', 'script', 'compose']);
    const st = state();
    expect(st.steps.script!.refine).toMatchObject({ rounds: 2 });
    expect(st.steps.media!.status).toBe('done');
    // ảnh sinh ở bước media: một prompt dùng chung cho các cảnh có ảnh (cùng scene) → cache, một asset
    const g = JSON.parse(readFileSync(path.join(v(), '.sf', 'graph.json'), 'utf8')) as {
      nodes: Record<string, { meta?: { asset_id?: string } }>;
    };
    const assetIds = [
      ...new Set(
        Object.entries(g.nodes)
          .filter(([id]) => id.startsWith('asset:'))
          .map(([, n]) => n.meta!.asset_id!),
      ),
    ];
    expect(assetIds.length).toBeGreaterThan(0);
    for (const a of assetIds) expect(existsSync(path.join(v(), 'public', `${a}.png`))).toBe(true);
    const release = st.steps.render!.outputs!.find((o) => o.endsWith('video.mp4'))!;
    expect(existsSync(path.join(v(), release))).toBe(true);
  }, 900_000);
});
