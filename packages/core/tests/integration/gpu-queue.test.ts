// 019 · SC-001/SC-002 — hàng đợi + lời gọi provider dùng chung lịch GPU; gom thay đổi lẻ.
import { copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createCore,
  GpuScheduler,
  JobQueue,
  openDb,
  runCapability,
  setGpuScheduler,
  WriteStore,
  type ProviderAdapter,
  type ProviderManifest,
  type SessionContext,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((c) => c());
  setGpuScheduler(undefined);
});

const RES: Record<string, 'gpu-heavy' | 'gpu-light'> = {
  comfyui: 'gpu-heavy',
  omnivoice: 'gpu-light',
  asr: 'gpu-light',
};
const BUDGET: Record<string, number> = { comfyui: 14, omnivoice: 6, asr: 3 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const events: string[] = [];
  const gpu = new GpuScheduler({
    resourceOf: (e) => RES[e],
    budgetOf: (e) => BUDGET[e] ?? 0,
    total: () => 14,
    holdsVram: (e) => e !== 'asr',
    release: async (e) => void events.push(`release:${e}`),
  });
  const db = openDb(':memory:');
  const queue = new JobQueue({ db, gpu });
  cleanups.push(() => {
    queue.stop();
    db.close();
  });
  const kind = (engine: string, ms: number) => ({
    engine,
    idempotent: true,
    run: async () => {
      events.push(`start:${engine}`);
      await sleep(ms);
      events.push(`end:${engine}`);
    },
  });
  queue.define('tts', kind('omnivoice', 150));
  queue.define('asr', kind('asr', 150));
  queue.define('img', kind('comfyui', 50));
  return { gpu, queue, events };
}

describe('GPU scheduling of the job queue (019 SC-001)', () => {
  it('light engines overlap; the heavy job waits and the resident light engine is offloaded first', async () => {
    const { queue, events } = setup();
    queue.start();
    const a = queue.enqueue('tts');
    const b = queue.enqueue('asr');
    const c = queue.enqueue('img');
    for (const j of [a, b, c]) expect((await queue.wait(j.id, 5000)).status).toBe('succeeded');
    const i = (e: string) => events.indexOf(e);
    // omnivoice và asr chạy song song
    expect(i('start:asr')).toBeLessThan(i('end:omnivoice'));
    // comfyui chỉ chạy khi cả hai đã xong; omnivoice (giữ VRAM) bị đẩy trước
    expect(i('start:comfyui')).toBeGreaterThan(Math.max(i('end:omnivoice'), i('end:asr')));
    expect(i('release:omnivoice')).toBeGreaterThan(-1);
    expect(i('release:omnivoice')).toBeLessThan(i('start:comfyui'));
  });

  it('a provider call inside a non-GPU job (graph.build) holds the GPU too', async () => {
    const { gpu, queue, events } = setup();
    setGpuScheduler(gpu);
    const t = tempDir('ch-');
    cleanups.push(t.cleanup);
    writeFileSync(path.join(t.dir, 'channel.json'), '{}');
    const manifest = {
      id: 'tts.test',
      version: '1.0.0',
      capabilities: ['tts.synthesize'],
      contract_versions: { 'tts.synthesize': '1' },
      runtime: 'node',
      engine: 'omnivoice',
      resource: 'gpu-light',
      install_profile: 'minimal',
      cost: { kind: 'free' },
      health: { method: 'x', timeout_ms: 1 },
      app_api: '>=0.1',
    } as ProviderManifest;
    const adapter: ProviderAdapter<{ n: number }, { file: string }> = {
      manifest,
      health: async () => ({ ok: true }),
      cacheKeyParts: (i) => i,
      run: async (_i, ctx) => {
        events.push('start:provider');
        await sleep(150);
        writeFileSync(path.join(ctx.workdir, 'o.txt'), 'x');
        events.push('end:provider');
        return { file: 'o.txt' };
      },
    };
    queue.define('graph', {
      idempotent: true,
      run: () =>
        runCapability({
          store: new WriteStore(t.dir),
          adapter,
          capability: 'tts.synthesize',
          input: { n: 1 },
          outputs: { file: 'cache-test/o.txt' },
        }),
    });
    queue.start();
    const g = queue.enqueue('graph');
    await sleep(20);
    const img = queue.enqueue('img');
    for (const j of [g, img]) expect((await queue.wait(j.id, 5000)).status).toBe('succeeded');
    expect(events.indexOf('start:comfyui')).toBeGreaterThan(events.indexOf('end:provider'));
  });
});

describe('batching small changes (019 SC-002)', () => {
  it('tts.synthesize calls within the window share one graph.build job with merged targets', async () => {
    const c = copyChannel();
    const t = tempDir('app-');
    copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
    const core = createCore({ appDataDir: t.dir, backoffMs: [10, 20], batchWindowMs: 400 });
    cleanups.push(() => core.close(), c.cleanup, t.cleanup);
    const session: SessionContext = {
      session_id: 'ss_test0001',
      kind: 'main',
      channel_dir: c.dir,
      video_id: fixtureVideoId,
    };
    const call = async (ids: string[]) =>
      (
        (await core.gateway.call(session, 'tts.synthesize', { line_ids: ids })) as {
          job_id: string;
        }
      ).job_id;
    const j1 = await call(['ln_2r7c4kxm']);
    const j2 = await call(['ln_5h8q2m3x']);
    const j3 = await call(['ln_2r7c4kxm']);
    expect(new Set([j1, j2, j3]).size).toBe(1);
    const job = core.queue.get(j1)!;
    expect((job.payload as { targets: string[] }).targets.sort()).toEqual(
      ['audio.line:ln_2r7c4kxm', 'audio.line:ln_5h8q2m3x', 'audio_meta'].sort(),
    );
    const done = await core.queue.wait(j1, 20_000);
    expect(['succeeded', 'partial']).toContain(done.status);
    // job sau cửa sổ (đã chạy) → job mới
    expect(await call(['ln_2r7c4kxm'])).not.toBe(j1);
  });
});
