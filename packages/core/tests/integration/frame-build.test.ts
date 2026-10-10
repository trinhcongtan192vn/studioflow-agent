// 011 · US1, US2, US4 · FR-002..006, FR-008 — frame-build với runtime giả ghi frame qua Gateway;
// index.html + hyperframes lint thật (SF_GPU=0 cho TTS/ASR giả).
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createCore,
  checkFrameFile,
  designSystemExecutor,
  hfLint,
  setAdvanced,
  sfIdsOf,
  type AgentEvent,
  type AgentRuntime,
  type Core,
  type FramePacket,
  type SessionOptions,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';
import { sampleFrame } from '../frame-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

/** Runtime giả: đọc packet trong chỉ dẫn, ghi frame bằng artifact.write, báo step_complete. */
function fakeRuntime(
  core: Core,
  opts: { badFirst?: string; silent?: string; limit?: boolean; overlap?: string } = {},
) {
  const calls: string[] = [];
  /** 093: chỉ dẫn gửi cho từng phiên (`<frame>` → văn bản). */
  const texts: [string, string][] = [];
  /** 060: model của từng phiên frame (`<frame>:<model>`). */
  const models: string[] = [];
  const rt: AgentRuntime = {
    id: 'fake',
    authStatus: async () => ({ ok: true, method: 'none' }),
    async openSession(o: SessionOptions) {
      return {
        id: o.context.session_id,
        async *send(m): AsyncIterable<AgentEvent> {
          const packet = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(m.text)![1]!) as FramePacket;
          const step = /"step_id": "([^"]+)"/.exec(m.text)![1]!;
          const fid = packet.frame.id;
          calls.push(fid);
          texts.push([fid, m.text]);
          models.push(`${fid}:${o.model}`);
          if (opts.limit) {
            // 086: hết lượt Claude
            yield {
              type: 'error',
              code: 'E_RUNTIME_RATE_LIMIT',
              message: "You've hit your session limit · resets 5pm (Asia/Bangkok)",
            } as AgentEvent;
            return;
          }
          const drop =
            opts.badFirst === fid && calls.filter((c) => c === fid).length === 1
              ? packet.frame.layers[0]!.id
              : undefined;
          const w = await core.gateway.call(o.context, 'artifact.write', {
            path: packet.output_path,
            content: sampleFrame(packet, drop, opts.overlap === fid),
          });
          if (!(w as { ok: boolean }).ok) throw new Error(JSON.stringify(w));
          // phạm vi ghi: phiên frame không ghi được file khác
          const other = await core.gateway.call(o.context, 'artifact.write', {
            path: 'index.html',
            content: 'x',
          });
          expect(other).toMatchObject({ ok: false, error: { code: 'E_SCOPE_DENIED' } });
          if (opts.silent !== fid) {
            await core.gateway.call(o.context, 'workflow.step_complete', {
              step_id: step,
              frame_id: fid,
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
  return { rt, calls, models, texts };
}

/**
 * `custom` = frame dựng bằng phiên agent (086: tính năng nâng cao); tắt = dựng từ mẫu. Luồng v2: chỉ frame
 * `hero` qua phiên agent → đánh dấu mọi frame của video mẫu là hero.
 */
function setup(custom = true) {
  const c = copyChannel();
  const t = tempDir('app-');
  writeFileSync(
    path.join(t.dir, 'settings.json'),
    readFileSync(path.join(fixtureAppData, 'settings.json')),
  );
  const core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 1000, backoffMs: [10, 20] });
  cleanups.push(() => core.close(), c.cleanup, t.cleanup);
  const store = core.gateway.storeFor(c.dir);
  if (custom) {
    setAdvanced(store, 'advanced.custom_frames', true);
    const sb = `videos/${fixtureVideoId}/STORYBOARD.md`;
    store.write(
      sb,
      readFileSync(store.abs(sb), 'utf8').replace(/^(intent: .*)$/gm, '$1\nhero: true'),
      { by: 'test' },
    );
  }
  const engine = core.workflows.engine(c.dir, fixtureVideoId);
  const v = path.join(c.dir, 'videos', fixtureVideoId);
  const base = {
    store,
    channelDir: c.dir,
    videoId: fixtureVideoId,
    signal: new AbortController().signal,
    appDataDir: t.dir,
  };
  const run = (only?: string[]) => {
    const step = { id: 'frames', uses: 'frame-build', title: 'Dựng frame' };
    return core.workflows.executor('frame-build')!({
      ...base,
      step,
      manifest: { id: 't', steps: [step] },
      waitFrame: (f: string) => engine.waitFrame('frames', f),
      ...(only ? { only } : {}),
    } as never) as Promise<{ built: string[]; skipped: string[]; outputs: string[] }>;
  };
  return { core, store, base, v, run, dir: c.dir };
}

describe('design-system (011 US4)', () => {
  it('writes frame.md from the app template with config values', async () => {
    const { base, v } = setup();
    const step = { id: 'ds', uses: 'design-system', title: 'DS' };
    await designSystemExecutor()({ ...base, step, manifest: { id: 't', steps: [step] } } as never);
    const md = readFileSync(path.join(v, 'frame.md'), 'utf8');
    expect(md).toMatch(/^---\nschema_version: 1\ngenerated_from: [0-9a-f]{64}\n---\n/);
    expect(md).toMatch(/Kênh: Sử Việt · look: \S+/); // look.id theo tầng (video ghi đè)
    expect(md).toContain('canvas: #101418');
  });
});

describe('frame-build (011 US1, US2)', () => {
  it('builds every frame through frame sessions, assembles index.html, passes hyperframes lint', async () => {
    const { core, base, v, run } = setup();
    const step = { id: 'ds', uses: 'design-system', title: 'DS' };
    await designSystemExecutor()({ ...base, step, manifest: { id: 't', steps: [step] } } as never);
    const { rt, calls, models } = fakeRuntime(core, { badFirst: 'fr_3m8k1w7d' });
    core.workflows.setAgentRuntime(rt);
    const r = await run();
    expect(r.built.sort()).toEqual(['fr_3m8k1w7d', 'fr_9x2b7cqe']);
    expect(calls.filter((c) => c === 'fr_3m8k1w7d')).toHaveLength(2); // thiếu data-sf-id → gửi lại
    // 060: frame đơn giản dựng bằng model rẻ; lần thử lại leo lên model chính
    expect(models.filter((m) => m.startsWith('fr_3m8k1w7d'))).toEqual([
      'fr_3m8k1w7d:claude-haiku-4-5-20251001',
      'fr_3m8k1w7d:claude-sonnet-5-5',
    ]);
    const index = readFileSync(path.join(v, 'index.html'), 'utf8');
    expect(index).toContain('data-composition-src="compositions/frames/fr_9x2b7cqe.html"');
    // fixture: transition_in chỉ ở frame đầu (không áp) → cắt thẳng
    expect(index).toMatch(/id="el-fr_3m8k1w7d"[^>]*data-track-index="1"/);
    expect(existsSync(path.join(v, 'compositions', 'captions.html'))).toBe(true);
    expect(existsSync(path.join(v, 'hyperframes.json'))).toBe(true);
    expect([
      ...sfIdsOf(readFileSync(path.join(v, 'compositions/frames/fr_9x2b7cqe.html'), 'utf8')),
    ]).toEqual(['el_t5w8n3ja', 'el_q2k7m4zp']);
    const before = readFileSync(path.join(v, 'compositions/frames/fr_9x2b7cqe.html'));
    expect((await hfLint(v)).ok).toBe(true);
    expect(readFileSync(path.join(v, 'compositions/frames/fr_9x2b7cqe.html')).equals(before)).toBe(
      true,
    ); // S3 (e)

    // packet không đổi → không dựng lại
    const again = await run();
    expect(again.built).toEqual([]);
    expect(again.skipped.sort()).toEqual(['fr_3m8k1w7d', 'fr_9x2b7cqe']);
  }, 120_000);

  it('a frame that never reports completion is retried, then accepted when its file is valid', async () => {
    const { core, base, run } = setup();
    const step = { id: 'ds', uses: 'design-system', title: 'DS' };
    await designSystemExecutor()({ ...base, step, manifest: { id: 't', steps: [step] } } as never);
    core.workflows.setAgentRuntime(fakeRuntime(core, { silent: 'fr_9x2b7cqe' }).rt);
    // file đã ghi nhưng không báo xong: lần 2 vẫn không báo → chấp nhận file hợp lệ
    const r = await run(['fr_9x2b7cqe']);
    expect(r.built).toEqual(['fr_9x2b7cqe']);
  }, 120_000);

  it('093: an AI frame still failing lint/check after the fix round falls back to a template frame', async () => {
    const { core, base, v, run } = setup();
    const step = { id: 'ds', uses: 'design-system', title: 'DS' };
    await designSystemExecutor()({ ...base, step, manifest: { id: 't', steps: [step] } } as never);
    const { rt, calls, texts } = fakeRuntime(core, { overlap: 'fr_9x2b7cqe' });
    core.workflows.setAgentRuntime(rt);
    const r = (await run()) as Awaited<ReturnType<typeof run>> & { summary: string };
    // một vòng sửa với phát hiện của check, vẫn đè → frame mẫu cho riêng frame đó
    expect(calls.filter((c) => c === 'fr_9x2b7cqe')).toHaveLength(2);
    // vòng sửa là sửa tại chỗ: kèm file hiện tại + lỗi, yêu cầu artifact.edit, không gửi lại đề dựng từ đầu
    const second = texts.filter(([f]) => f === 'fr_9x2b7cqe')[1]![1];
    expect(second).toMatch(/^# Nhiệm vụ: sửa đúng chỗ sai trong frame `fr_9x2b7cqe`/);
    expect(second).toContain('mcp__sf__artifact_edit');
    expect(second).toContain('Chữ đè lên chữ khác');
    expect(second).toMatch(/# Lỗi cần sửa\n[^#]*(contrast_aa_failure|content_overlap)/);
    const html = readFileSync(path.join(v, 'compositions/frames/fr_9x2b7cqe.html'), 'utf8');
    expect(html).toContain('fr_9x2b7cqe-t');
    expect(html).not.toContain('Chữ đè lên chữ khác');
    expect(r.summary).toMatch(/1 frame AI vẫn lỗi .*dựng bằng layout: fr_9x2b7cqe/);
    // frame AI còn lại giữ nguyên
    expect(
      readFileSync(path.join(v, 'compositions/frames/fr_3m8k1w7d.html'), 'utf8'),
    ).not.toContain('fr_3m8k1w7d-t');
  }, 180_000);

  it('without frame.md or runtime the step fails clearly', async () => {
    const { core, run, v } = setup();
    rmSync(path.join(v, 'frame.md'), { force: true });
    await expect(run()).rejects.toMatchObject({ code: 'E_STEP_INCOMPLETE' });
    core.workflows.setAgentRuntime(fakeRuntime(core).rt);
    await expect(run()).rejects.toMatchObject({ code: 'E_FILE_NOT_FOUND' });
  });
});

describe('template frames (086)', () => {
  it('builds every frame from templates without an agent; index + lint + check pass', async () => {
    const { base, v, run } = setup(false);
    const step = { id: 'ds', uses: 'design-system', title: 'DS' };
    await designSystemExecutor()({ ...base, step, manifest: { id: 't', steps: [step] } } as never);
    // không gắn runtime: không cần phiên agent
    const r = await run();
    expect(r.built.sort()).toEqual(['fr_3m8k1w7d', 'fr_9x2b7cqe']);
    for (const id of r.built) {
      const html = readFileSync(path.join(v, `compositions/frames/${id}.html`), 'utf8');
      expect(
        checkFrameFile(
          html,
          id,
          [...sfIdsOf(html)].filter((x) => !x.startsWith('el_x')),
        ),
      ).toEqual([]);
    }
    expect(existsSync(path.join(v, 'index.html'))).toBe(true);
    expect((await hfLint(v)).ok).toBe(true);
  }, 180_000);

  it('a rate limit stops new frame sessions at once and fails with E_RUNTIME_RATE_LIMIT', async () => {
    const { core, base, run } = setup(true);
    const step = { id: 'ds', uses: 'design-system', title: 'DS' };
    await designSystemExecutor()({ ...base, step, manifest: { id: 't', steps: [step] } } as never);
    const { rt, calls } = fakeRuntime(core, { limit: true });
    core.workflows.setAgentRuntime(rt);
    await expect(run()).rejects.toMatchObject({
      code: 'E_RUNTIME_RATE_LIMIT',
      message: expect.stringContaining('resets 5pm'),
    });
    // song song 2: mỗi frame tối đa một phiên, không thử lại bằng model khác
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(new Set(calls).size).toBe(calls.length);
  }, 120_000);
});
