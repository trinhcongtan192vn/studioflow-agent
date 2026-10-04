// 019 · FR-001/002 — lịch GPU (D4 mục 6): một heavy một lúc, light theo ngân sách, re-entrant, đẩy VRAM.
import { describe, expect, it } from 'vitest';
import { GpuScheduler } from '../../src/index.js';

const RES: Record<string, 'gpu-heavy' | 'gpu-light'> = {
  comfyui: 'gpu-heavy',
  omnivoice: 'gpu-light',
  asr: 'gpu-light',
  render: 'gpu-light',
};
const BUDGET: Record<string, number> = { comfyui: 14, omnivoice: 6, asr: 3, render: 2 };

function sched(total = 14, opts: { failRelease?: boolean } = {}) {
  const released: string[] = [];
  const s = new GpuScheduler({
    resourceOf: (e) => RES[e],
    budgetOf: (e) => BUDGET[e] ?? 0,
    total: () => total,
    release: async (e) => {
      released.push(e);
      if (opts.failRelease) throw new Error('boom');
    },
    // omnivoice/comfyui giữ VRAM sau khi chạy; asr/render là tiến trình theo lần gọi
    holdsVram: (e) => e === 'omnivoice' || e === 'comfyui',
  });
  return { s, released };
}
const pending = async (p: Promise<unknown>) =>
  (await Promise.race([
    p.then(() => 'done'),
    new Promise((r) => setTimeout(() => r('pending'), 30)),
  ])) as string;

describe('GpuScheduler (019)', () => {
  it('light engines run together within the VRAM budget', async () => {
    const { s } = sched();
    const a = await s.acquire('omnivoice');
    const b = await s.acquire('asr');
    expect(s.active().sort()).toEqual(['asr', 'omnivoice']);
    a.release();
    b.release();
  });

  it('a heavy engine waits for light ones, then the resident light engine is offloaded first', async () => {
    const { s, released } = sched();
    const omni = await s.acquire('omnivoice');
    const heavy = s.acquire('comfyui');
    expect(await pending(heavy)).toBe('pending');
    omni.release();
    const h = await heavy;
    expect(released).toEqual(['omnivoice']);
    expect(s.active()).toEqual(['comfyui']);
    // light chờ heavy; khi chạy được thì comfyui đang giữ VRAM bị đẩy
    const light = s.acquire('asr');
    expect(await pending(light)).toBe('pending');
    h.release();
    (await light).release();
    expect(released).toEqual(['omnivoice', 'comfyui']);
  });

  it('same engine is re-entrant (a comfyui job calling a comfyui provider)', async () => {
    const { s } = sched();
    const outer = await s.acquire('comfyui');
    const inner = s.tryAcquire('comfyui');
    expect(inner).toBeDefined();
    await inner!.ready;
    inner!.release();
    expect(s.active()).toEqual(['comfyui']);
    outer.release();
    expect(s.active()).toEqual([]);
  });

  it('light engines over the total budget wait; a single engine over budget still runs alone', async () => {
    const { s } = sched(8);
    const omni = await s.acquire('omnivoice');
    expect(s.tryAcquire('asr')).toBeUndefined();
    omni.release();
    const { s: tiny } = sched(4);
    (await tiny.acquire('comfyui')).release();
  });

  it('cancel while waiting rejects at once and does not block others; non-GPU engines are free', async () => {
    const { s } = sched();
    const h = await s.acquire('comfyui');
    const ctrl = new AbortController();
    const waiting = s.acquire('omnivoice', ctrl.signal);
    ctrl.abort();
    await expect(waiting).rejects.toMatchObject({ code: 'E_JOB_CANCELED' });
    const cpu = s.tryAcquire('audio-analysis');
    expect(cpu).toBeDefined();
    cpu!.release();
    h.release();
    (await s.acquire('omnivoice')).release();
  });

  it('a failing release hook does not block the next engine', async () => {
    const { s, released } = sched(14, { failRelease: true });
    (await s.acquire('omnivoice')).release();
    (await s.acquire('comfyui')).release();
    expect(released).toEqual(['omnivoice']);
  });
});
