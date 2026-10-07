// 016 · FR-WF-05, AC-M1-01 (dạng hồi quy), AC-M1-03 — workflow `narrated-explainer` chạy hết tới MP4
// phát hành: TTS/ASR giả (SF_GPU=0), text giả cho script/meta, agent giả cho storyboard/assets/music,
// phiên frame giả; HyperFrames (lint/check/snapshot/render) và FFmpeg thật.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { jpegSize } from '../../src/thumbnail/thumbnail.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeStudio } from '../../src/testing/gpu.js';
import {
  createCore,
  createVideo,
  parseBlocksDoc,
  publishMetaExecutor,
  scriptExecutor,
  serializeBlocksDoc,
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
  '## Mở đầu <!-- sf:beat -->',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Bạn có bao giờ tự hỏi vì sao bầu trời có màu xanh?',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Câu trả lời nằm trong ánh sáng mặt trời.',
  '',
  '## Tán xạ <!-- sf:beat -->',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Ánh sáng xanh bị không khí tán xạ mạnh hơn ánh sáng đỏ.',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Vì vậy khắp bầu trời đều ánh lên màu xanh.',
  '',
].join('\n');

function stubText(): TextService {
  const usage = { input: 10, output: 5 };
  return {
    models: () => ({
      producer: { provider: 'claude', model: 'p' },
      critic: { provider: 'claude', model: 'c' },
      aux: { provider: 'claude', model: 'a' },
    }),
    generate: async (_r, input) => ({
      text: input.messages.some((m) => m.content.includes('JSON'))
        ? '{"title": "Vì sao trời xanh?", "description": "Giải thích tán xạ Rayleigh trong 30 giây.", "tags": ["khoa học"]}'
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

/** Phiên frame giả: viết frame hợp lệ cho packet và báo xong. */
function frameRuntime(core: () => Core): AgentRuntime {
  return {
    id: 'fake',
    authStatus: async () => ({ ok: true, method: 'claude-plan' }),
    async openSession(o) {
      return {
        id: o.context.session_id,
        async *send(m: { text: string }): AsyncIterable<AgentEvent> {
          const packet = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(m.text)![1]!) as FramePacket;
          const step = /"step_id": "([^"]+)"/.exec(m.text)![1]!;
          await core().gateway.call(o.context, 'artifact.write', {
            path: packet.output_path,
            content: sampleFrame(packet),
          });
          await core().gateway.call(o.context, 'workflow.step_complete', {
            step_id: step,
            frame_id: packet.frame.id,
            outputs: [packet.output_path],
          });
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
let core: Core;
let videoId = '';
const v = () => path.join(c.dir, 'videos', videoId);
const agentSteps: string[] = [];
const asked: string[] = [];

beforeAll(() => {
  process.env.SF_GPU = '0';
  writeFileSync(
    path.join(t.dir, 'settings.json'),
    readFileSync(path.join(fixtureAppData, 'settings.json')),
  );
  core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 5000, backoffMs: [10, 20] });
  core.workflows.registerExecutor('script', scriptExecutor({ text: stubText() }));
  core.workflows.registerExecutor('publish-meta', publishMetaExecutor({ text: stubText() }));
  core.workflows.setAgentRuntime(frameRuntime(() => core));
  // người dùng đồng ý ghi đè STORYBOARD.md đã duyệt ở bước overlays (D5 5.1)
  core.gateway.permissions.on('permission.requested', (r: { request_id: string; kind: string }) => {
    asked.push(r.kind);
    core.gateway.permissions.decide({ request_id: r.request_id, allow: true });
  });
  // phiên main giả: bước agent storyboard/assets/music theo skill của gói
  core.workflows.setAgentRunner(async (instruction, ctx) => {
    const step = /bước (\S+) của workflow/.exec(instruction)![1]!;
    agentSteps.push(step);
    const session: SessionContext = {
      session_id: 'ss_agent001',
      kind: 'main',
      channel_dir: ctx.channelDir,
      video_id: ctx.videoId as SessionContext['video_id'],
    };
    if (step === 'storyboard') {
      const script = readFileSync(ctx.store.abs(`videos/${ctx.videoId}/SCRIPT.md`), 'utf8');
      const lines = [...script.matchAll(/sf:line id=(ln_[0-9a-z]{8})/g)].map((m) => m[1]!);
      const beats = [...script.matchAll(/sf:beat id=(bt_[0-9a-z]{8})/g)].map((m) => m[1]!);
      const frame = (i: number, ids: string[], beat: string, tr: boolean) =>
        [
          `### Frame ${i}`,
          '```sf-frame',
          `beat_ids: [${beat}]`,
          `line_ids: [${ids.join(', ')}]`,
          `intent: "Hình minh họa ${i}"`,
          'layers:',
          '  - { kind: background, notes: "nền tối" }',
          `  - { kind: text, text: "Ý ${i}" }`,
          ...(tr ? ['transition_in: { type: crossfade, duration_ms: 500 }'] : []),
          '```',
          '',
        ].join('\n');
      const sb = [
        '---',
        'schema_version: 1',
        `video_id: ${ctx.videoId}`,
        'status: draft',
        '---',
        '## Scene 1 — Bầu trời',
        '```sf-scene',
        'title: Bầu trời',
        'mood: tò mò',
        'music: { query: "nhẹ nhàng" }',
        '```',
        '',
        frame(1, lines.slice(0, 2), beats[0]!, false),
        frame(2, lines.slice(2), beats[1]!, true),
      ].join('\n');
      const w = await core.gateway.call(session, 'artifact.write', {
        path: 'STORYBOARD.md',
        content: sb,
      });
      if (!w.ok) throw new Error(JSON.stringify(w));
      await ctx.stepComplete(['STORYBOARD.md']);
    } else if (step === 'finish') {
      // 062: look + hiệu ứng + overlay trong một bước
      // 027: lower third ở frame đầu (khối của app, biến bắt buộc `title`)
      const rel = `videos/${ctx.videoId}/STORYBOARD.md`;
      const sb = readFileSync(ctx.store.abs(rel), 'utf8').replace(
        'intent: "Hình minh họa 1"',
        'intent: "Hình minh họa 1"\noverlays: [{ block: lower-third, vars: { title: "Tán xạ Rayleigh", subtitle: "Vật lý khí quyển" } }]',
      );
      const w = await core.gateway.call(session, 'artifact.write', {
        path: 'STORYBOARD.md',
        content: sb,
      });
      if (!w.ok) throw new Error(JSON.stringify(w));
      await ctx.stepComplete(['STORYBOARD.md']);
    } else if (step === 'music') {
      // kho nhạc trống → music.find báo không có → scene giữ query, không có track
      const r = await core.gateway.call(session, 'music.find', { query: 'nhẹ nhàng' });
      expect(r).toMatchObject({ ok: false, error: { code: 'E_MUSIC_NOT_FOUND' } });
      await ctx.stepComplete(['STORYBOARD.md']);
    } else {
      await ctx.stepComplete([]);
    }
  });
  const store = core.gateway.storeFor(c.dir);
  videoId = createVideo(store, { title: 'Vì sao trời xanh' }).video_id;
  const briefRel = `videos/${videoId}/BRIEF.md`;
  const brief = parseBlocksDoc(readFileSync(store.abs(briefRel), 'utf8'));
  brief.body = [
    '# Brief',
    '',
    'Chủ đề: vì sao bầu trời màu xanh. Khán giả: học sinh. Thông điệp: tán xạ ánh sáng.',
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

describeStudio('narrated-explainer end to end (016 FR-WF-05)', () => {
  it('runs every step to a release MP4 through the approval points', async () => {
    const e = core.workflows.engine(c.dir, videoId);
    expect(
      core.workflows.packs().find((p) => p.manifest.id === 'narrated-explainer')?.compatible,
    ).toBe(true);
    await e.select('narrated-explainer', 'yt-1080p30');
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
    // overlays sửa STORYBOARD.md đã duyệt → hỏi ghi đè (D5 5.1) + duyệt lại storyboard (D6 3.1)
    expect(approved).toEqual(['brief', 'script', 'storyboard', 'storyboard', 'finalize']);
    expect(asked).toContain('overwrite_approved');
    // assets do engine (nút asset, 023): không có layer cần ảnh thư viện → không giao agent
    expect(agentSteps).toEqual(['storyboard', 'finish', 'music']);
    const st = state();
    expect(Object.fromEntries(Object.entries(st.steps).map(([k, s]) => [k, s.status]))).toEqual({
      design: 'done',
      script: 'done',
      storyboard: 'done',
      voice: 'done',
      assets: 'done',
      frames: 'done',
      finish: 'done',
      captions: 'done',
      music: 'done',
      finalize: 'done',
      meta: 'done',
      thumbnail: 'done',
      render: 'done',
    });
    // 063: thumbnail JPEG 1280×720 (tiêu đề rút gọn + ảnh frame khi không có LLM/ảnh sinh)
    const thumb = readFileSync(path.join(v(), 'thumbnail.jpg'));
    expect(jpegSize(thumb)).toEqual({ width: 1280, height: 720 });
    // 027: overlay ở tầng riêng (trên frame, dưới caption), biến đã điền
    const index = readFileSync(path.join(v(), 'index.html'), 'utf8');
    expect(index).toMatch(/data-sf-overlay="lower-third"[^>]*data-track-index="2"/);
    expect(index).toMatch(/id="el-captions"[^>]*data-track-index="3"/);
    const ov = /data-composition-src="(compositions\/overlays\/[^"]+)"/.exec(index)![1]!;
    expect(readFileSync(path.join(v(), ov), 'utf8')).toContain('Tán xạ Rayleigh');
    const finalizeNote = st.approvals.find((a) => a.step_id === 'finalize')!.note!;
    expect(finalizeNote).toMatch(/Bản nháp: renders\/rd_[0-9a-z]{8}\/video\.mp4/);
    expect(existsSync(path.join(v(), '.sf', 'snapshots'))).toBe(true);
    const release = st.steps.render!.outputs!.find((o) => o.endsWith('video.mp4'))!;
    expect(existsSync(path.join(v(), release))).toBe(true);
    expect(
      JSON.parse(readFileSync(path.join(v(), path.dirname(release), 'render.json'), 'utf8')),
    ).toMatchObject({ mode: 'release', status: 'done' });
    expect(
      readFileSync(path.join(v(), path.dirname(release), 'description.txt'), 'utf8'),
    ).toContain('tán xạ');
  }, 900_000);

  it('AC-M1-03: editing one sentence regenerates only that line audio and its captions', async () => {
    const script = path.join(v(), 'SCRIPT.md');
    writeFileSync(
      script,
      readFileSync(script, 'utf8').replace(
        'Câu trả lời nằm trong ánh sáng mặt trời.',
        'Câu trả lời nằm ngay trong ánh sáng mặt trời.',
      ),
    );
    const session: SessionContext = {
      session_id: 'ss_agent001',
      kind: 'main',
      channel_dir: c.dir,
      video_id: videoId as SessionContext['video_id'],
    };
    const r = (await core.gateway.call(session, 'asr.align', { line_ids: 'all' })) as {
      job_id: string;
    };
    const done = (await core.gateway.call(session, 'job.wait', {
      job_id: r.job_id,
      timeout_ms: 60_000,
    })) as { data: { result: { nodes: Record<string, { status: string }> } } };
    const built = Object.entries(done.data.result.nodes)
      .filter(([, n]) => n.status === 'built')
      .map(([id]) => id.replace(/:ln_[0-9a-z]{8}$/, ':ln'))
      .sort();
    expect(built).toEqual(['asr.line:ln', 'audio.line:ln', 'audio_meta', 'captions']);
  }, 120_000);
});
