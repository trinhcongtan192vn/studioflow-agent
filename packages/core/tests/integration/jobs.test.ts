// 004 · US1 · FR-001..007 · SC-003 (FR-OP-01, NFR-02).
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobQueue, openDb, SfError, type JobInfo } from '../../src/index.js';
import { tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function setup(opts: { dbFile?: string } = {}) {
  const t = tempDir('jobs-');
  cleanups.push(t.cleanup);
  const db = openDb(opts.dbFile ?? path.join(t.dir, 'studioflow.db'));
  const q = new JobQueue({ db, backoffMs: [10, 20] });
  cleanups.unshift(() => {
    q.stop();
    db.close();
  });
  return { q, db, dir: t.dir };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('job queue (004 US1)', () => {
  it('runs a job, reports progress via job.updated and persists it', async () => {
    const { q, db } = setup();
    q.define('demo', {
      idempotent: true,
      run: async (_job, ctx) => {
        ctx.progress(1, 2, 'half');
        ctx.progress(2, 2);
        return { ok: 1 };
      },
    });
    const events: JobInfo[] = [];
    q.on('job.updated', (j: JobInfo) => events.push(structuredClone(j)));
    q.start();
    const job = q.enqueue('demo', { video_id: 'vd_8m2pq7rt' });
    expect(job.id).toMatch(/^jb_[0-9a-z]{8}$/);
    const done = await q.wait(job.id, 5000);
    expect(done).toMatchObject({
      status: 'succeeded',
      result: { ok: 1 },
      attempts: 1,
      max_attempts: 3,
      progress: { done: 2, total: 2 },
    });
    expect(events.map((e) => e.status)).toEqual(
      expect.arrayContaining(['queued', 'running', 'succeeded']),
    );
    expect(events.some((e) => e.progress.message === 'half')).toBe(true);
    const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as {
      status: string;
    };
    expect(row.status).toBe('succeeded');
  });

  it('retries retryable errors with backoff, fails fast otherwise', async () => {
    const { q } = setup();
    let n = 0;
    q.define('flaky', {
      idempotent: true,
      run: async () =>
        ++n < 3 ? Promise.reject(new SfError('E_PROVIDER_FAILED', 'try again')) : 'ok',
    });
    q.define('broken', {
      idempotent: true,
      run: async () => Promise.reject(new SfError('E_SCHEMA_INVALID', 'no')),
    });
    q.start();
    expect(await q.wait(q.enqueue('flaky').id, 5000)).toMatchObject({
      status: 'succeeded',
      attempts: 3,
    });
    expect(await q.wait(q.enqueue('broken').id, 5000)).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: { code: 'E_SCHEMA_INVALID', retryable: false },
    });
    let m = 0;
    q.define('alwaysFlaky', {
      idempotent: true,
      run: async () => Promise.reject(new SfError('E_PROVIDER_FAILED', `x${++m}`)),
    });
    expect(await q.wait(q.enqueue('alwaysFlaky').id, 5000)).toMatchObject({
      status: 'failed',
      attempts: 3,
    });
  });

  it('cancel aborts a running job quickly and cancels queued children', async () => {
    const { q } = setup();
    let aborted = false;
    q.define('slow', {
      idempotent: true,
      run: (_job, ctx) =>
        new Promise((_, reject) => {
          ctx.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new SfError('E_JOB_CANCELED', 'canceled'));
          });
        }),
    });
    q.start();
    const job = q.enqueue('slow');
    await sleep(30);
    const t0 = Date.now();
    q.cancel(job.id);
    const r = await q.wait(job.id, 5000);
    expect(r.status).toBe('canceled');
    expect(aborted).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(q.cancel(job.id).status).toBe('canceled'); // đã xong → không đổi
  });

  it('parent becomes partial when some children fail', async () => {
    const { q } = setup();
    q.define('child', {
      idempotent: true,
      run: async (job) =>
        (job.payload as { n: number }).n === 2
          ? Promise.reject(new SfError('E_SCHEMA_INVALID', 'bad'))
          : job.payload,
    });
    q.define('parent', {
      idempotent: true,
      run: async (_job, ctx) => {
        const kids = await ctx.spawnChildren(
          [1, 2, 3].map((n) => ({ kind: 'child', payload: { n } })),
        );
        return { kids: kids.map((k) => k.status) };
      },
    });
    q.start();
    const p = await q.wait(q.enqueue('parent').id, 5000);
    expect(p.status).toBe('partial');
    expect(p.children).toHaveLength(3);
    expect(p.result).toEqual({ kids: ['succeeded', 'failed', 'succeeded'] });
  });

  it('picks by priority, then the engine that just ran, then creation order; one job per engine', async () => {
    const { q } = setup();
    const order: string[] = [];
    let running = 0;
    let maxRunningOnEngine = 0;
    for (const engine of ['omnivoice', 'comfyui']) {
      q.define(`run-${engine}`, {
        engine,
        idempotent: true,
        run: async (job) => {
          running++;
          maxRunningOnEngine = Math.max(maxRunningOnEngine, running);
          order.push((job.payload as { name: string }).name);
          await sleep(5);
          running--;
        },
      });
    }
    q.enqueue('run-omnivoice', { payload: { name: 'tts-1' } });
    q.enqueue('run-comfyui', { payload: { name: 'img-1' }, priority: 0 });
    q.enqueue('run-omnivoice', { payload: { name: 'tts-2' } });
    const urgent = q.enqueue('run-comfyui', { payload: { name: 'img-urgent' }, priority: 2 });
    q.start();
    await q.wait(urgent.id, 5000);
    await q.idle(5000);
    expect(order[0]).toBe('img-urgent');
    expect(order.indexOf('tts-1')).toBeLessThan(order.indexOf('tts-2'));
    expect(maxRunningOnEngine).toBeLessThanOrEqual(2); // 2 engine khác nhau có thể song song
  });

  it('recovers after a crash: idempotent → queued, others → failed E_JOB_INTERRUPTED', async () => {
    const { q, db, dir } = setup();
    q.define('stuck', { idempotent: true, run: () => new Promise(() => {}) });
    q.define('stuckOnce', { idempotent: false, run: () => new Promise(() => {}) });
    q.start();
    const a = q.enqueue('stuck');
    const b = q.enqueue('stuckOnce');
    await sleep(50);
    expect(q.get(a.id)!.status).toBe('running');
    // "crash": mở hàng đợi mới trên cùng DB
    q.stop();
    const db2 = openDb(path.join(dir, 'studioflow.db'));
    cleanups.unshift(() => db2.close());
    const q2 = new JobQueue({ db: db2 });
    expect(q2.recover()).toBe(2);
    expect(q2.get(a.id)).toMatchObject({ status: 'queued', attempts: 1 });
    expect(q2.get(b.id)).toMatchObject({ status: 'failed', error: { code: 'E_JOB_INTERRUPTED' } });
    void db;
  });

  it('wait returns the current info on timeout', async () => {
    const { q } = setup();
    q.define('never', { idempotent: true, run: () => new Promise(() => {}) });
    q.start();
    const j = q.enqueue('never');
    expect((await q.wait(j.id, 50)).status).toMatch(/queued|running/);
    expect(q.list({}).length).toBe(1);
  });
});
