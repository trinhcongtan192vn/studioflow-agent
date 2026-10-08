// 031 · FR-WF-08, FR-VO-05 — workflow `short-film` tới MP4 phát hành (TTS/ASR/ảnh giả, text giả, agent giả,
// phiên frame giả; HyperFrames + FFmpeg thật): truyện → dàn nhân vật (giọng clone, biến thể cảm xúc, lưu
// cấp kênh) → kịch bản thoại → storyboard → animatic (duyệt) → phụ đề theo người nói.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeStudio } from '../../src/testing/gpu.js';
import {
  createCore,
  createVideo,
  encodeWav,
  parseBlocksDoc,
  publishMetaExecutor,
  scriptExecutor,
  serializeBlocksDoc,
  storyboardExecutor,
  type Core,
  type RenderRecord,
  type SessionContext,
  type TextService,
  type VideoState,
  setAdvanced,
  setConfig,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, tempDir } from '../domain-helpers.js';
import { publishWaiting } from '../workflow-helpers.js';
import { frameRuntime } from '../workflow-e2e-helpers.js';

const STORY = [
  '## Chiếc ô bị quên',
  '```sf-story',
  'title: Chiếc ô bị quên',
  'summary: Mai bỏ quên ô ở bến xe, Nam đuổi theo trả lại dưới mưa.',
  'characters: [Mai, Nam]',
  'setting: Bến xe buýt chiều mưa',
  'beats: [Mai lên xe, Nam đuổi theo, Gặp lại]',
  '```',
  '',
].join('\n');
const cast: { mai?: string; nam?: string } = {};
const screenplay = () =>
  [
    '## Bến xe <!-- sf:beat -->',
    '',
    '<!-- sf:line speaker=narrator -->',
    'Chiều hôm ấy trời đổ mưa bất chợt.',
    '',
    `<!-- sf:line speaker=${cast.mai} emotion=happy -->`,
    'Xe tới rồi, may quá!',
    '',
    '## Gặp lại <!-- sf:beat -->',
    '',
    `<!-- sf:line speaker=${cast.nam} -->`,
    'Chị ơi, chị quên ô này!',
    '',
    `<!-- sf:line speaker=${cast.mai} emotion=sad -->`,
    'Ôi, tôi đãng trí quá.',
    '',
  ].join('\n');

function text(): TextService {
  const usage = { input: 10, output: 5 };
  return {
    models: () => ({
      producer: { provider: 'claude', model: 'p' },
      critic: { provider: 'claude', model: 'c' },
      aux: { provider: 'claude', model: 'a' },
    }),
    generate: async (_r, input) => ({
      text: input.messages.some((m) => m.content.includes('JSON'))
        ? JSON.stringify({
            title: 'Chiếc ô bị quên',
            description: 'Phim ngắn.',
            tags: ['phim ngắn'],
          })
        : cast.mai
          ? screenplay()
          : STORY,
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

const c = copyChannel();
const t = tempDir('app-');
let core: Core;
let videoId = '';
const v = () => path.join(c.dir, 'videos', videoId);
const agentSteps: string[] = [];
let mouthAnchor = '';

async function job(session: SessionContext, tool: string, input: unknown) {
  const r = (await core.gateway.call(session, tool, input)) as { ok: boolean; job_id?: string };
  if (!r.ok) throw new Error(JSON.stringify(r));
  const w = (await core.gateway.call(session, 'job.wait', {
    job_id: r.job_id,
    timeout_ms: 60_000,
  })) as {
    data: { status: string; result: Record<string, unknown> };
  };
  if (w.data.status !== 'succeeded') throw new Error(JSON.stringify(w));
  return w.data.result;
}

/** Phiên producer (storyboard có refine): storyboard theo shot. */
async function writeStoryboard(context: SessionContext) {
  const store = core.gateway.storeFor(context.channel_dir);
  const script = readFileSync(store.abs(`videos/${videoId}/SCRIPT.md`), 'utf8');
  const lines = [...script.matchAll(/sf:line id=(ln_[0-9a-z]{8})/g)].map((m) => m[1]!);
  const beats = [...script.matchAll(/sf:beat id=(bt_[0-9a-z]{8})/g)].map((m) => m[1]!);
  const shot = (i: number, ids: string[], beat: string, intent: string, extra: string[] = []) =>
    [
      `### Frame ${i}`,
      '```sf-frame',
      `beat_ids: [${beat}]`,
      `line_ids: [${ids.join(', ')}]`,
      `intent: "${intent}"`,
      'layers:',
      '  - { kind: background, notes: "bến xe chiều mưa, 2D phẳng" }',
      `  - { kind: text, text: "Shot ${i}" }`,
      ...extra,
      '```',
      '',
    ].join('\n');
  const sb = [
    '---',
    'schema_version: 1',
    `video_id: ${videoId}`,
    'status: draft',
    '---',
    '## Scene 1 — Bến xe',
    '```sf-scene',
    'title: Bến xe',
    'music: none',
    '```',
    '',
    shot(1, lines.slice(0, 2), beats[0]!, 'toàn: bến xe, Mai chạy tới'),
    shot(2, lines.slice(2), beats[1]!, 'trung: Nam đưa ô cho Mai', [
      '  - { kind: mouth, notes: "miệng Mai" }',
    ]),
  ].join('\n');
  const w = await core.gateway.call(context, 'artifact.write', {
    path: 'STORYBOARD.md',
    content: sb,
  });
  if (!w.ok) throw new Error(JSON.stringify(w));
  // 032: ID layer miệng do app gán → ghi lần hai gắn lipsync cho shot trung của Mai
  const written = readFileSync(store.abs(`videos/${videoId}/STORYBOARD.md`), 'utf8');
  const mouth = /id: (el_[0-9a-z]{8}), kind: mouth/.exec(written)![1]!;
  const w2 = await core.gateway.call(context, 'artifact.write', {
    path: 'STORYBOARD.md',
    content: written.replace(
      /( {2}- \{ id: el_[0-9a-z]{8}, kind: mouth[^\n]*\n)/,
      `$1lipsync: { cast_id: ${cast.mai}, mouth_anchor: ${mouth} }\n`,
    ),
  });
  if (!w2.ok) throw new Error(JSON.stringify(w2));
  mouthAnchor = mouth;
  await core.gateway.call(context, 'workflow.step_complete', {
    step_id: 'storyboard',
    outputs: ['STORYBOARD.md'],
  });
}

beforeAll(() => {
  process.env.SF_GPU = '0';
  writeFileSync(
    path.join(t.dir, 'settings.json'),
    readFileSync(path.join(fixtureAppData, 'settings.json')),
  );
  core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 5000, backoffMs: [10, 20] });
  core.workflows.registerExecutor('script', scriptExecutor({ text: text() }));
  core.workflows.registerExecutor('publish-meta', publishMetaExecutor({ text: text() }));
  core.workflows.registerExecutor(
    'storyboard',
    storyboardExecutor({
      text: text(),
      gateway: core.gateway,
      runtime: () => core.workflows.agentRuntime,
    }),
  );
  core.workflows.setAgentRuntime(frameRuntime(() => core, [], writeStoryboard));
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
    if (step === 'cast') {
      // giọng clone từ file mẫu người dùng đính kèm (uploads/)
      const voice = async (name: string, file: string) =>
        (await job(session, 'voice.profile_create', { name, ref_audio: file, language: 'vi' }))
          .voice_id as string;
      const narrator = await voice('Người dẫn', 'uploads/narrator.wav');
      const mai = await voice('Mai', 'uploads/mai.wav');
      const nam = await voice('Nam', 'uploads/nam.wav');
      await core.gateway.call(session, 'config.set', {
        key: 'voice.id',
        value: narrator,
        tier: 'video',
      });
      // 032: bật khẩu hình cho video (shot nào lip-sync do storyboard khai)
      await core.gateway.call(session, 'config.set', {
        key: 'lipsync.enabled',
        value: true,
        tier: 'video',
      });
      const doc = [
        '---',
        'schema_version: 1',
        `video_id: ${ctx.videoId}`,
        '---',
        '# Nhân vật',
        '',
        '```sf-cast',
        `- { name: "Mai", role: character, voice_id: ${mai}, reference_images: [], emotions: { sad: "videos/${ctx.videoId}/uploads/mai-sad.wav" }, caption_color: "#ffd54a" }`,
        `- { name: "Nam", role: character, voice_id: ${nam}, reference_images: [], caption_color: "#7fd3ff" }`,
        '```',
        '',
      ].join('\n');
      const w = (await core.gateway.call(session, 'artifact.write', {
        path: 'CAST.md',
        content: doc,
      })) as {
        ok: boolean;
        data: { assigned_ids?: string[] };
      };
      if (!w.ok) throw new Error(JSON.stringify(w));
      [cast.mai, cast.nam] = w.data.assigned_ids!;
      await ctx.stepComplete(['CAST.md']);
    } else {
      await ctx.stepComplete(step === 'music' ? ['STORYBOARD.md'] : []);
    }
  });
  const store = core.gateway.storeFor(c.dir);
  videoId = createVideo(store, { title: 'Chiếc ô bị quên' }).video_id;
  // 085: test đường refine — bật tính năng nâng cao, giữ 2 vòng như trước
  setAdvanced(store, 'advanced.refine', true);
  setConfig(store, 'refine.min_rounds', 2, { tier: 'channel' });
  for (const [f, ms] of [
    ['narrator', 4000],
    ['mai', 4500],
    ['nam', 5000],
    ['mai-sad', 5500],
  ] as const)
    store.write(`videos/${videoId}/uploads/${f}.wav`, encodeWav(ms), { by: 'test' });
  const rel = `videos/${videoId}/BRIEF.md`;
  const b = parseBlocksDoc(readFileSync(store.abs(rel), 'utf8'));
  b.body = ['# Brief', '', 'Phim ngắn hài nhẹ: Mai và Nam, bến xe chiều mưa, có người dẫn.', ''];
  store.write(rel, serializeBlocksDoc(b), { by: 'test' });
}, 120_000);
afterAll(() => {
  core.close();
  c.cleanup();
  t.cleanup();
});

const state = () => JSON.parse(readFileSync(path.join(v(), 'state.json'), 'utf8')) as VideoState;

describeStudio('short-film end to end (031 FR-WF-08)', () => {
  it('story → cast → screenplay → animatic → release with per-speaker voices and captions', async () => {
    const e = core.workflows.engine(c.dir, videoId);
    expect(core.workflows.packs().find((p) => p.manifest.id === 'short-film')?.compatible).toBe(
      true,
    );
    await e.select('short-film', 'yt-1080p30');
    const approved: string[] = [];
    for (let i = 0; i < 14; i++) {
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
    expect(approved).toEqual(['brief', 'story', 'cast', 'script', 'animatic', 'finalize']);
    const st = state();
    // 032: khẩu hình cho line của Mai trong shot trung (shot 2)
    expect(st.steps.lipsync!.status).toBe('done');
    const lsFiles = st.steps.lipsync!.outputs!;
    expect(lsFiles).toHaveLength(1);
    const cues = JSON.parse(readFileSync(path.join(v(), lsFiles[0]!), 'utf8'));
    expect(cues).toMatchObject({ cast_id: cast.mai, fps: 30 });
    expect(cues.cues[0]).toMatchObject({ frame: 0 });
    expect(cues.cues.at(-1)).toMatchObject({ mouth: 'closed' });
    expect(cues.cues.some((c: { mouth: string }) => c.mouth === 'open')).toBe(true);
    const frames = readFileSync(path.join(v(), 'STORYBOARD.md'), 'utf8');
    const fr2 = [...frames.matchAll(/id: (fr_[0-9a-z]{8})/g)].map((m) => m[1]!)[1]!;
    const html = readFileSync(path.join(v(), 'compositions', 'frames', `${fr2}.html`), 'utf8');
    expect(html).toMatch(
      new RegExp(
        `data-sf-id="${mouthAnchor}"[^>]*><!--sf:mouth--><img data-sf-mouth="closed" src="public/mouths/flat/front/closed.svg"`,
      ),
    );
    expect(html).toContain('<script data-sf-lipsync>');
    expect(html).toContain(
      `tl.set("[data-sf-id=\\"${mouthAnchor}\\"] [data-sf-mouth=\\"open\\"]", { opacity: 1 }, `,
    );
    expect(existsSync(path.join(v(), 'public', 'mouths', 'flat', 'front', 'open.svg'))).toBe(true);
    expect(agentSteps).toEqual(['cast', 'finish']); // 085: nhạc tắt mặc định

    // nhân vật lưu cấp kênh, dùng lại giữa video
    const mai = JSON.parse(
      readFileSync(path.join(c.dir, 'characters', cast.mai!, 'cast.json'), 'utf8'),
    );
    expect(mai).toMatchObject({
      id: cast.mai,
      name: 'Mai',
      role: 'character',
      caption_color: '#ffd54a',
    });
    // biến thể cảm xúc: voice prompt riêng cho "sad"
    expect(existsSync(path.join(c.dir, 'characters', cast.mai!, 'emotions', 'sad.pt'))).toBe(true);

    // animatic: render mode animatic có MP4
    const anim = st.steps.animatic!.outputs!.find((o) => o.endsWith('render.json'))!;
    const rec = JSON.parse(readFileSync(path.join(v(), anim), 'utf8')) as RenderRecord;
    expect(rec).toMatchObject({ mode: 'animatic', status: 'done' });
    expect(existsSync(path.join(v(), rec.file!))).toBe(true);

    // phụ đề theo người nói
    const caps = readFileSync(path.join(v(), 'compositions', 'captions.html'), 'utf8');
    expect(caps).toContain(`data-sf-speaker="${cast.mai}"`);
    expect(caps).toContain('style="--c: #ffd54a"');
    expect(caps).toContain('style="--c: #7fd3ff"');

    const release = st.steps.render!.outputs!.find((o) => o.endsWith('video.mp4'))!;
    expect(existsSync(path.join(v(), release))).toBe(true);
  }, 900_000);
});
