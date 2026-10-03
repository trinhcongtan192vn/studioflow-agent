// 006 · US4 · FR-002 — client JSON-RPC ↔ worker Python thật (engine fake).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PythonWorker } from '../../src/index.js';
import { tempDir } from '../domain-helpers.js';
import { devPython, workerSrc } from '../worker-helpers.js';

const workers: PythonWorker[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const w of workers.splice(0)) await w.stop();
  cleanups.splice(0).forEach((c) => c());
});
function worker() {
  const w = new PythonWorker({ engine: 'fake', python: devPython, srcDir: workerSrc });
  workers.push(w);
  return w;
}
function work() {
  const t = tempDir('wk-');
  cleanups.push(t.cleanup);
  return t.dir;
}

describe('PythonWorker (006 FR-002)', () => {
  it('starts lazily, answers health and runs a task with progress', async () => {
    const w = worker();
    expect(w.running).toBe(false);
    expect(await w.call('health')).toMatchObject({ ok: true, engine: 'fake' });
    const progress: [number, number][] = [];
    const dir = work();
    const r = await w.run('tts.synthesize', { text: 'Xin chào' }, dir, {
      jobId: 'jb_1',
      onProgress: (d, t) => progress.push([d, t]),
    });
    expect(r).toEqual({ file: 'out.wav', duration_ms: 480, sample_rate: 48000 });
    expect(existsSync(path.join(dir, 'out.wav'))).toBe(true);
    expect(progress).toEqual([[1, 1]]);
  });

  it('maps worker errors to SfError codes', async () => {
    const w = worker();
    await expect(
      w.run('tts.synthesize', { text: '' }, work(), { jobId: 'x' }),
    ).rejects.toMatchObject({ code: 'E_SCHEMA_INVALID' });
  });

  it('abort sends cancel and rejects with E_JOB_CANCELED', async () => {
    const w = worker();
    const ctrl = new AbortController();
    const p = w.run('sleep', { ms: 5000 }, work(), { jobId: 'jb_c', signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 300);
    await expect(p).rejects.toMatchObject({ code: 'E_JOB_CANCELED' });
  });

  it('a crashed worker fails pending calls with retryable E_PROVIDER_FAILED and restarts next time', async () => {
    const w = worker();
    await expect(w.run('crash', {}, work(), { jobId: 'boom' })).rejects.toMatchObject({
      code: 'E_PROVIDER_FAILED',
    });
    expect(w.running).toBe(false);
    expect(await w.call('health')).toMatchObject({ ok: true });
  });

  it('stop() ends the process', async () => {
    const w = worker();
    await w.call('health');
    const pid = w.pid!;
    await w.stop();
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('a missing python is reported as E_PROVIDER_UNAVAILABLE', async () => {
    const w = new PythonWorker({ engine: 'fake', python: 'Z:/nope/python.exe', srcDir: workerSrc });
    workers.push(w);
    await expect(w.call('health')).rejects.toMatchObject({ code: 'E_PROVIDER_UNAVAILABLE' });
  });
});
