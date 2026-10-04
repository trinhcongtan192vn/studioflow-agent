// 018 · FR-001/002, SC-002 — vòng đời ComfyUI + client (ComfyUI giả lập HTTP/WS).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ComfyServer } from '../../src/index.js';
import { tempDir } from '../domain-helpers.js';

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'fake-comfy.mjs',
);
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  delete process.env.FAKE_COMFY_JOB_MS;
  delete process.env.FAKE_COMFY_HEALTH_FAIL_AFTER;
});

function server(opts: { healthIntervalMs?: number; env?: Record<string, string> } = {}) {
  const t = tempDir('comfy-');
  const logFile = path.join(t.dir, 'log.jsonl');
  const s = new ComfyServer({
    runDir: t.dir,
    command: { exe: process.execPath, args: [FAKE] },
    env: { FAKE_COMFY_LOG: logFile, ...opts.env },
    healthIntervalMs: opts.healthIntervalMs ?? 10_000,
    startTimeoutMs: 15_000,
  });
  cleanups.push(t.cleanup, () => s.stop());
  const requests = () =>
    existsSync(logFile)
      ? readFileSync(logFile, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as { path: string; prompt_id?: string; delete?: string[] })
      : [];
  return { s, requests };
}

const WF = {
  6: { class_type: 'KSampler', inputs: { seed: 3 } },
  8: { class_type: 'SaveImage', inputs: {} },
};

describe('ComfyServer (018)', () => {
  it('starts lazily on a free 127.0.0.1 port, runs a prompt with progress, frees VRAM', async () => {
    const { s, requests } = server();
    expect(s.running).toBe(false);
    const c = await s.ensure();
    expect(c.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const progress: number[] = [];
    const id = await c.submit(WF);
    const out = await c.wait(id, { onProgress: (d) => progress.push(d) });
    expect(out.images[0]!.filename).toMatch(/\.png$/);
    const buf = await c.view(out.images[0]!);
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(progress.length).toBeGreaterThan(0);
    await s.release();
    expect(requests().some((r) => r.path === '/free')).toBe(true);
    // ensure lần 2 dùng lại tiến trình
    expect((await s.ensure()).baseUrl).toBe(c.baseUrl);
  });

  it('cancel interrupts and removes the prompt within 5 s', async () => {
    const { s, requests } = server({ env: { FAKE_COMFY_JOB_MS: '60000' } });
    const c = await s.ensure();
    const id = await c.submit(WF);
    const ctrl = new AbortController();
    const t0 = Date.now();
    const p = c.wait(id, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 300);
    await expect(p).rejects.toMatchObject({ code: 'E_JOB_CANCELED' });
    expect(Date.now() - t0).toBeLessThan(5000);
    const r = requests();
    expect(r.some((x) => x.path === '/interrupt' && x.prompt_id === id)).toBe(true);
    expect(r.some((x) => x.path === '/queue' && x.delete?.includes(id))).toBe(true);
  });

  it('restarts after 3 consecutive failed health checks', async () => {
    const { s } = server({ healthIntervalMs: 150, env: { FAKE_COMFY_HEALTH_FAIL_AFTER: '2' } });
    const first = (await s.ensure()).baseUrl;
    await new Promise<void>((resolve) => s.once('restart', () => resolve()));
    expect(s.restarts).toBeGreaterThanOrEqual(1);
    expect((await s.ensure()).baseUrl).not.toBe(first);
  });

  it('node errors surface as E_PROVIDER_FAILED; not installed → health not ok', async () => {
    const { s } = server();
    const c = await s.ensure();
    await expect(c.submit({ 1: { class_type: 'Broken', inputs: {} } })).rejects.toMatchObject({
      code: 'E_PROVIDER_FAILED',
      message: expect.stringContaining('bad node'),
    });
    const t = tempDir('comfy-none-');
    cleanups.push(t.cleanup);
    const missing = new ComfyServer({ runDir: t.dir, installDir: path.join(t.dir, 'nope') });
    expect((await missing.health()).ok).toBe(false);
  });
});
