// 029 · FR-WF-07 — workflow `essay-audiobook` chạy hết tới MP4 phát hành (TTS/ASR giả, text giả, agent giả,
// phiên frame giả; HyperFrames + FFmpeg thật): tầng cấu hình workflow (caption tĩnh ≤ 10 từ, khoảng lặng
// 600 ms, nhạc −21 dB), chương khớp mốc beat trên timeline.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeStudio } from '../../src/testing/gpu.js';
import {
  createCore,
  createVideo,
  parseBlocksDoc,
  publishMetaExecutor,
  resolveConfig,
  scriptExecutor,
  serializeBlocksDoc,
  type AudioMeta,
  type CaptionGroups,
  type Core,
  type SessionContext,
  type VideoState,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, tempDir } from '../domain-helpers.js';
import { publishWaiting } from '../workflow-helpers.js';
import { frameRuntime, stubText } from '../workflow-e2e-helpers.js';

const SCRIPT_BODY = [
  '## Vì sao ta sợ im lặng <!-- sf:beat -->',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Có những buổi tối ta mở điện thoại chỉ để khỏi phải nghe chính mình.',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Pascal từng viết rằng mọi bất hạnh của con người đến từ việc không biết ngồi yên trong phòng.',
  '',
  '## Học cách ở cùng mình <!-- sf:beat -->',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Im lặng không phải khoảng trống mà là nơi ý nghĩ được lắng xuống từ từ.',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Hãy thử mỗi ngày mười phút không màn hình và để ý điều gì trở lại với bạn.',
  '',
].join('\n');
const META = {
  title: 'Vì sao ta sợ im lặng',
  description: 'Một tiểu luận ngắn về im lặng và sự chú ý.',
  tags: ['tiểu luận', 'triết học'],
};

const c = copyChannel();
const t = tempDir('app-');
let core: Core;
let videoId = '';
const v = () => path.join(c.dir, 'videos', videoId);
const agentSteps: string[] = [];

beforeAll(() => {
  process.env.SF_GPU = '0';
  writeFileSync(
    path.join(t.dir, 'settings.json'),
    readFileSync(path.join(fixtureAppData, 'settings.json')),
  );
  core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 5000, backoffMs: [10, 20] });
  const text = stubText(SCRIPT_BODY, META);
  core.workflows.registerExecutor('script', scriptExecutor({ text }));
  core.workflows.registerExecutor('publish-meta', publishMetaExecutor({ text }));
  core.workflows.setAgentRuntime(frameRuntime(() => core));
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
    if (step === 'storyboard') {
      const script = readFileSync(ctx.store.abs(`videos/${ctx.videoId}/SCRIPT.md`), 'utf8');
      const lines = [...script.matchAll(/sf:line id=(ln_[0-9a-z]{8})/g)].map((m) => m[1]!);
      const beats = [...script.matchAll(/sf:beat id=(bt_[0-9a-z]{8})/g)].map((m) => m[1]!);
      // theo skill: mỗi chương một frame mở đầu có tên chương; trích dẫn nổi bật
      const frame = (i: number, ids: string[], beat: string, title: string, extra: string[]) =>
        [
          `### Frame ${i}`,
          '```sf-frame',
          `beat_ids: [${beat}]`,
          `line_ids: [${ids.join(', ')}]`,
          `intent: "Tên chương hiện chậm trên nền giấy, sau đó trích dẫn"`,
          'layers:',
          '  - { kind: background, notes: "nền giấy ấm, chuyển động rất chậm" }',
          `  - { kind: text, text: "${title}" }`,
          ...extra,
          ...(i > 1 ? ['transition_in: { type: blur-crossfade, duration_ms: 1000 }'] : []),
          '```',
          '',
        ].join('\n');
      const sb = [
        '---',
        'schema_version: 1',
        `video_id: ${ctx.videoId}`,
        'status: draft',
        '---',
        '## Scene 1 — Im lặng',
        '```sf-scene',
        'title: Im lặng',
        'mood: trầm tư',
        'music: { query: "slow ambient piano" }',
        '```',
        '',
        frame(1, lines.slice(0, 2), beats[0]!, 'Vì sao ta sợ im lặng', [
          '  - { kind: text, text: "— Blaise Pascal, Pensées" }',
        ]),
        frame(2, lines.slice(2), beats[1]!, 'Học cách ở cùng mình', []),
      ].join('\n');
      const w = await core.gateway.call(session, 'artifact.write', {
        path: 'STORYBOARD.md',
        content: sb,
      });
      if (!w.ok) throw new Error(JSON.stringify(w));
      await ctx.stepComplete(['STORYBOARD.md']);
    } else if (step === 'music') {
      const r = await core.gateway.call(session, 'music.find', { query: 'slow ambient piano' });
      expect(r).toMatchObject({ ok: false, error: { code: 'E_MUSIC_NOT_FOUND' } });
      await ctx.stepComplete(['STORYBOARD.md']);
    } else {
      await ctx.stepComplete([]);
    }
  });
  const store = core.gateway.storeFor(c.dir);
  videoId = createVideo(store, { title: 'Vì sao ta sợ im lặng' }).video_id;
  const briefRel = `videos/${videoId}/BRIEF.md`;
  const brief = parseBlocksDoc(readFileSync(store.abs(briefRel), 'utf8'));
  brief.body = [
    '# Brief',
    '',
    'Tiểu luận về im lặng. Trích dẫn: Pascal, Pensées. Khán giả: người trẻ bận rộn.',
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

describeStudio('essay-audiobook end to end (029 FR-WF-07)', () => {
  it('runs to a release MP4 with the workflow config tier, static captions and chapters', async () => {
    const e = core.workflows.engine(c.dir, videoId);
    expect(
      core.workflows.packs().find((p) => p.manifest.id === 'essay-audiobook')?.compatible,
    ).toBe(true);
    await e.select('essay-audiobook', 'yt-1080p30');
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
    expect(approved).toEqual(['brief', 'script', 'storyboard', 'finalize']);
    expect(agentSteps).toEqual(['storyboard', 'finish']); // 085: nhạc tắt mặc định

    // tầng workflow (D3 7.1): ghi đè kênh (kênh mẫu đặt caption.max_words = 6), video vẫn thắng
    const scope = { channelDir: c.dir, videoId };
    expect(resolveConfig('caption.max_words', scope, { appDataDir: t.dir })).toMatchObject({
      value: 10,
      source: 'workflow',
    });
    expect(resolveConfig('music.volume_db', scope, { appDataDir: t.dir }).value).toBe(-10);
    const cg = JSON.parse(
      readFileSync(path.join(v(), 'caption_groups.json'), 'utf8'),
    ) as CaptionGroups;
    const sizes = cg.groups.map((g) => g.word_range[1] - g.word_range[0] + 1);
    expect(Math.max(...sizes)).toBeGreaterThan(6);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(10);
    expect(cg.style).toBe('caption-static');
    // caption tĩnh: không tô màu từng từ
    const caps = readFileSync(path.join(v(), 'compositions', 'captions.html'), 'utf8');
    expect(caps).toContain('data-sf-caption=');
    expect(caps).not.toMatch(/tl\.set\("#cap-/);

    // khoảng lặng 600 ms sau mỗi line (voice.pause_after_ms của workflow) → timeline
    const meta = JSON.parse(readFileSync(path.join(v(), 'audio_meta.json'), 'utf8')) as AudioMeta;
    const g = JSON.parse(readFileSync(path.join(v(), '.sf', 'graph.json'), 'utf8')) as {
      nodes: Record<
        string,
        { meta?: { total_ms?: number; lines?: { id: string; start_ms: number }[] } }
      >;
    };
    const timing = g.nodes['frame_timing']!.meta!;
    expect(timing.total_ms).toBe(meta.lines.reduce((s, l) => s + l.duration_ms + 600, 0));

    // chương theo beat, mốc = line đầu của beat trên timeline
    const pub = parseBlocksDoc(readFileSync(path.join(v(), 'publish.md'), 'utf8'));
    const chapters = pub.front.chapters as { start_ms: number; title: string }[];
    expect(chapters.map((ch) => ch.title)).toEqual([
      'Vì sao ta sợ im lặng',
      'Học cách ở cùng mình',
    ]);
    expect(chapters[1]!.start_ms).toBe(
      timing.lines!.find((l) => l.id === meta.lines[2]!.line_id)!.start_ms,
    );

    const release = state().steps.render!.outputs!.find((o) => o.endsWith('video.mp4'))!;
    expect(existsSync(path.join(v(), release))).toBe(true);
  }, 900_000);
});
