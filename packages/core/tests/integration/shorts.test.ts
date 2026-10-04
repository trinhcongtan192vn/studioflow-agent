// 030 · AC-M4-01 (FR-WF-07) — workflow `shorts`: cắt từ video dài của kênh tới MP4 dọc 9:16 ≤ 60 giây
// (TTS/ASR giả, text giả, agent giả, phiên frame giả; HyperFrames + FFmpeg + Chrome thật): video nguồn
// đọc được, line dùng lại lấy audio từ cache, gate ≤ 60 s và chữ trong vùng an toàn, caption karaoke,
// meta #shorts; chữ ra ngoài vùng an toàn bị bắt.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeStudio } from '../../src/testing/gpu.js';
import {
  createCore,
  createVideo,
  parseBlocksDoc,
  probeDurationMs,
  publishMetaExecutor,
  safeAreaViolations,
  scriptExecutor,
  serializeBlocksDoc,
  type Core,
  type FramePacket,
  type SessionContext,
  type VideoState,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, tempDir } from '../domain-helpers.js';
import { frameRuntime, stubText } from '../workflow-e2e-helpers.js';

const LONG_BODY = [
  '## Mở đầu <!-- sf:beat -->',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Mỗi ngày bạn đưa ra khoảng ba mươi lăm nghìn quyết định.',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Phần lớn trong số đó bạn không hề nhận ra.',
  '',
  '## Lối tắt của não <!-- sf:beat -->',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Não dùng lối tắt để tiết kiệm năng lượng.',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Càng mệt, bạn càng chọn phương án mặc định.',
  '',
].join('\n');
// short: hook mới + hai line giữ nguyên văn từ video dài (dùng lại audio) + kết nghịch lý
const SHORT_BODY = [
  '## Hook <!-- sf:beat -->',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Bạn nghĩ mình tự quyết định?',
  '',
  '## Insight <!-- sf:beat -->',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Não dùng lối tắt để tiết kiệm năng lượng.',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Càng mệt, bạn càng chọn phương án mặc định.',
  '',
  '## Paradox <!-- sf:beat -->',
  '',
  '<!-- sf:line speaker=narrator -->',
  'Nghỉ ngơi mới là quyết định khó nhất.',
  '',
].join('\n');

const c = copyChannel();
const t = tempDir('app-');
let core: Core;
let longId = '';
let shortId = '';
const packets: FramePacket[] = [];
const readSource: string[] = [];
const v = (id: string) => path.join(c.dir, 'videos', id);

function brief(id: string, text: string, front: Record<string, unknown> = {}) {
  const store = core.gateway.storeFor(c.dir);
  const rel = `videos/${id}/BRIEF.md`;
  const b = parseBlocksDoc(readFileSync(store.abs(rel), 'utf8'));
  b.front = { ...b.front, ...front };
  b.body = ['# Brief', '', text, ''];
  store.write(rel, serializeBlocksDoc(b), { by: 'test' });
}

beforeAll(async () => {
  process.env.SF_GPU = '0';
  writeFileSync(
    path.join(t.dir, 'settings.json'),
    readFileSync(path.join(fixtureAppData, 'settings.json')),
  );
  core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 5000, backoffMs: [10, 20] });
  const meta = {
    title: 'Bạn có thật sự tự quyết định?',
    description: 'Não và lối tắt.',
    tags: ['tâm lý'],
  };
  core.workflows.registerExecutor(
    'publish-meta',
    publishMetaExecutor({ text: stubText('', meta) }),
  );
  core.workflows.setAgentRuntime(frameRuntime(() => core, packets));
  core.gateway.permissions.on('permission.requested', (r: { request_id: string }) =>
    core.gateway.permissions.decide({ request_id: r.request_id, allow: true }),
  );
  core.workflows.setAgentRunner(async (instruction, ctx) => {
    const step = /bước (\S+) của workflow/.exec(instruction)![1]!;
    const session: SessionContext = {
      session_id: 'ss_agent001',
      kind: 'main',
      channel_dir: ctx.channelDir,
      video_id: ctx.videoId as SessionContext['video_id'],
    };
    if (step === 'storyboard') {
      // theo skill: đọc video nguồn (video:<vd>/…), dựng lại bố cục dọc
      const src = (await core.gateway.call(session, 'artifact.read', {
        path: `video:${longId}/SCRIPT.md`,
      })) as { ok: boolean; data?: { content: string } };
      if (src.ok) readSource.push(longId);
      const script = readFileSync(ctx.store.abs(`videos/${ctx.videoId}/SCRIPT.md`), 'utf8');
      const lines = [...script.matchAll(/sf:line id=(ln_[0-9a-z]{8})/g)].map((m) => m[1]!);
      const beats = [...script.matchAll(/sf:beat id=(bt_[0-9a-z]{8})/g)].map((m) => m[1]!);
      const beatOf = (i: number) => (i === 0 ? beats[0]! : i < 3 ? beats[1]! : beats[2]!);
      const frames = lines.map((ln, i) =>
        [
          `### Frame ${i + 1}`,
          '```sf-frame',
          `beat_ids: [${beatOf(i)}]`,
          `line_ids: [${ln}]`,
          `intent: "big-text: chữ lớn nửa trên khung"`,
          'layers:',
          '  - { kind: background, notes: "nền tối" }',
          `  - { kind: text, text: "Ý ${i + 1}" }`,
          '```',
          '',
        ].join('\n'),
      );
      const sb = [
        '---',
        'schema_version: 1',
        `video_id: ${ctx.videoId}`,
        'status: draft',
        '---',
        '## Scene 1 — Quyết định',
        '```sf-scene',
        'title: Quyết định',
        'music: none',
        '```',
        '',
        ...frames,
      ].join('\n');
      const w = await core.gateway.call(session, 'artifact.write', {
        path: 'STORYBOARD.md',
        content: sb,
      });
      if (!w.ok) throw new Error(JSON.stringify(w));
      await ctx.stepComplete(['STORYBOARD.md']);
    } else await ctx.stepComplete(step === 'music' ? ['STORYBOARD.md'] : []);
  });
  // video dài của kênh: kịch bản + audio đã sinh (cache TTS)
  const store = core.gateway.storeFor(c.dir);
  longId = createVideo(store, { title: 'Ba mươi lăm nghìn quyết định' }).video_id;
  const w = await core.gateway.call(
    { session_id: 'ss_setup001', kind: 'main', channel_dir: c.dir, video_id: longId as never },
    'artifact.write',
    {
      path: 'SCRIPT.md',
      content: `---\nschema_version: 1\nvideo_id: ${longId}\nlanguage: vi\nstatus: approved\n---\n${LONG_BODY}`,
    },
  );
  if (!w.ok) throw new Error(JSON.stringify(w));
  const r = (await core.gateway.call(
    { session_id: 'ss_setup001', kind: 'main', channel_dir: c.dir, video_id: longId as never },
    'asr.align',
    { line_ids: 'all' },
  )) as { job_id: string };
  await core.gateway.call(
    { session_id: 'ss_setup001', kind: 'main', channel_dir: c.dir, video_id: longId as never },
    'job.wait',
    { job_id: r.job_id, timeout_ms: 60_000 },
  );
  // short cắt từ video dài
  shortId = createVideo(store, { title: 'Bạn có tự quyết định?' }).video_id;
  brief(shortId, 'Cắt từ video dài: beat "Lối tắt của não". Một ý: não chọn mặc định khi mệt.', {
    source_video_id: longId,
    target_duration_ms: 9_000,
  });
  core.workflows.registerExecutor('script', scriptExecutor({ text: stubText(SHORT_BODY, meta) }));
}, 300_000);
afterAll(() => {
  core.close();
  c.cleanup();
  t.cleanup();
});

const state = (id: string) =>
  JSON.parse(readFileSync(path.join(v(id), 'state.json'), 'utf8')) as VideoState;

describeStudio('shorts from a long video (030 AC-M4-01)', () => {
  it('renders a vertical ≤ 60 s short reusing the long video’s audio, inside the safe area', async () => {
    const e = core.workflows.engine(c.dir, shortId);
    expect(core.workflows.packs().find((p) => p.manifest.id === 'shorts')?.compatible).toBe(true);
    await e.select('shorts', 'yt-shorts-1080x1920');
    const approved: string[] = [];
    for (let i = 0; i < 12; i++) {
      await e.idle();
      const st = state(shortId);
      const failed = Object.entries(st.steps).find(([, s]) => s.status === 'failed');
      if (failed) throw new Error(`step ${failed[0]} failed: ${JSON.stringify(failed[1].error)}`);
      if (st.steps.render?.status === 'done') break;
      const pending = st.approvals.find((a) => a.status === 'pending');
      if (!pending) throw new Error(`stuck: ${JSON.stringify(e.summary().steps)}`);
      approved.push(pending.step_id);
      await e.approve(pending.id);
    }
    expect(approved).toEqual(['brief', 'script', 'storyboard', 'finalize']);
    const st = state(shortId);
    expect(st.read_only_videos).toEqual([longId]);
    expect(readSource).toEqual([longId]);
    expect(st.steps.finalize!.status).toBe('done');

    // line giữ nguyên văn → audio lấy từ cache TTS của video dài
    const runs = core.db
      .prepare("SELECT attrs FROM spans WHERE name = 'sf.provider.run' AND video_id = ?")
      .all(shortId) as { attrs: string }[];
    const tts = runs
      .map((r) => JSON.parse(r.attrs) as Record<string, unknown>)
      .filter((a) => String(a['sf.capability']).startsWith('tts'));
    expect(tts.filter((a) => a['sf.from_cache'] === true)).toHaveLength(2);
    expect(tts.filter((a) => a['sf.from_cache'] === false)).toHaveLength(2);

    // khung dọc, caption karaoke giữa màn hình, packet nêu vùng an toàn theo px
    expect(packets[0]!.rules[0]).toMatch(
      /^Canvas 1080×1920; vùng an toàn \(chữ phải nằm trong\): x 65–950px, y 154–1536px\.$/,
    );
    const caps = readFileSync(path.join(v(shortId), 'compositions', 'captions.html'), 'utf8');
    expect(caps).toContain('top: 1114px; transform: translateY(-50%);');
    expect(caps).toMatch(/tl\.set\("#cap-/);

    // meta: tiêu đề ≤ 60 ký tự, #shorts cuối mô tả
    const pub = parseBlocksDoc(readFileSync(path.join(v(shortId), 'publish.md'), 'utf8'));
    expect(String(pub.front.title).length).toBeLessThanOrEqual(60);
    expect(pub.body.join('\n')).toMatch(/#shorts\s*$/);

    // MP4 phát hành 1080×1920, ≤ 60 s
    const mp4 = path.join(
      v(shortId),
      st.steps.render!.outputs!.find((o) => o.endsWith('video.mp4'))!,
    );
    expect(existsSync(mp4)).toBe(true);
    const probe = spawnSync(
      process.env.SF_FFPROBE ?? 'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0',
        mp4,
      ],
      { encoding: 'utf8' },
    );
    expect(probe.stdout.trim()).toBe('1080,1920');
    expect(await probeDurationMs(mp4)).toBeLessThanOrEqual(60_000);

    // chữ ra ngoài lề phải (vùng nút của YouTube) → gate bắt
    const store = core.gateway.storeFor(c.dir);
    const fr = packets[0]!.frame.id;
    const rel = `videos/${shortId}/compositions/frames/${fr}.html`;
    store.write(
      rel,
      readFileSync(store.abs(rel), 'utf8').replace(
        /left:\d+px;top:(\d+)px;font-family:sans-serif;font-size:96px/,
        'left:900px;top:$1px;font-family:sans-serif;font-size:96px',
      ),
      { by: 'test', validate: false },
    );
    const bad = await safeAreaViolations(store, shortId, { profile: 'yt-shorts-1080x1920' });
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]!.sides).toContain('right');
  }, 900_000);
});
