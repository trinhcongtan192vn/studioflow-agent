// 011 · US1, US2, US4 · FR-002..006, FR-008 — frame-build với runtime giả ghi frame qua Gateway;
// index.html + hyperframes lint thật (SF_GPU=0 cho TTS/ASR giả).
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createCore,
  designSystemExecutor,
  hfLint,
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
function fakeRuntime(core: Core, opts: { badFirst?: string; silent?: string } = {}) {
  const calls: string[] = [];
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
          const drop =
            opts.badFirst === fid && calls.filter((c) => c === fid).length === 1
              ? packet.frame.layers[0]!.id
              : undefined;
          const w = await core.gateway.call(o.context, 'artifact.write', {
            path: packet.output_path,
            content: sampleFrame(packet, drop),
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
  return { rt, calls };
}

function setup() {
  const c = copyChannel();
  const t = tempDir('app-');
  writeFileSync(
    path.join(t.dir, 'settings.json'),
    readFileSync(path.join(fixtureAppData, 'settings.json')),
  );
  const core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 1000, backoffMs: [10, 20] });
  cleanups.push(() => core.close(), c.cleanup, t.cleanup);
  const store = core.gateway.storeFor(c.dir);
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
    const { rt, calls } = fakeRuntime(core, { badFirst: 'fr_3m8k1w7d' });
    core.workflows.setAgentRuntime(rt);
    const r = await run();
    expect(r.built.sort()).toEqual(['fr_3m8k1w7d', 'fr_9x2b7cqe']);
    expect(calls.filter((c) => c === 'fr_3m8k1w7d')).toHaveLength(2); // thiếu data-sf-id → gửi lại
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

  it('without frame.md or runtime the step fails clearly', async () => {
    const { core, run, v } = setup();
    rmSync(path.join(v, 'frame.md'), { force: true });
    await expect(run()).rejects.toMatchObject({ code: 'E_STEP_INCOMPLETE' });
    core.workflows.setAgentRuntime(fakeRuntime(core).rt);
    await expect(run()).rejects.toMatchObject({ code: 'E_FILE_NOT_FOUND' });
  });
});
