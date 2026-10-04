// 024 · SC-001..003 (FR-OP-06) — dung lượng: xem, dọn (cache, render nháp), hạn mức cache LRU giữ video
// có render phát hành, chặn job khi đĩa thấp, CLI.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanChannel,
  createCore,
  diskUsage,
  enforceCacheBudget,
  type SessionContext,
} from '../../src/index.js';
import { runSf } from '../helpers.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((c) => c()),
);

function setup(opts: { diskMinBytes?: number } = {}) {
  const c = copyChannel();
  const t = tempDir('app-');
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const core = createCore({ appDataDir: t.dir, backoffMs: [10, 20], ...opts });
  cleanups.push(c.cleanup, t.cleanup, () => core.close());
  const store = core.gateway.storeFor(c.dir);
  const video: SessionContext = {
    session_id: 'ss_test0001',
    kind: 'main',
    channel_dir: c.dir,
    video_id: fixtureVideoId,
  };
  const channelOnly: SessionContext = {
    session_id: 'ss_test0002',
    kind: 'main',
    channel_dir: c.dir,
  };
  const gen = async (s: SessionContext, prompt: string) => {
    const j = (await core.gateway.call(s, 'image.generate', {
      prompt,
      width: 512,
      height: 512,
      seed: 1,
    })) as { job_id: string };
    const d = (await core.gateway.call(s, 'job.wait', {
      job_id: j.job_id,
      timeout_ms: 20_000,
    })) as {
      data: {
        status: string;
        result: { asset_id: string; from_cache: boolean };
        error?: { code: string };
      };
    };
    return d.data;
  };
  /** Render giả: `renders/<rd>/render.json` + `video.mp4`. */
  const render = (rd: string, mode: 'draft' | 'release', finished: string, bytes = 1000) => {
    const dir = store.abs(`videos/${fixtureVideoId}/renders/${rd}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'video.mp4'), Buffer.alloc(bytes));
    writeFileSync(
      path.join(dir, 'render.json'),
      JSON.stringify({
        schema_version: 1,
        id: rd,
        mode,
        output_profile: 'yt-1080p30',
        started_at: finished,
        finished_at: finished,
        status: 'done',
        file: `renders/${rd}/video.mp4`,
        gate_results: [],
        index_hash: '0'.repeat(64),
      }),
    );
  };
  return { core, dir: c.dir, app: t.dir, store, video, channelOnly, gen, render };
}

describe('disk management (024)', () => {
  it('usage splits cache, draft/release renders and backups; cleaning drafts keeps 5 and every release', async () => {
    const { core, dir, app, gen, render } = setup();
    await gen(
      { session_id: 'ss_test0001', kind: 'main', channel_dir: dir, video_id: fixtureVideoId },
      'bản đồ cổ',
    );
    for (let i = 0; i < 7; i++) render(`rd_d000000${i}`, 'draft', `2026-11-0${i + 1}T00:00:00Z`);
    render('rd_r0000000', 'release', '2026-09-01T00:00:00Z', 5000);
    const u = diskUsage({ appDataDir: app, channelDir: dir });
    expect(u.disk.free_bytes).toBeGreaterThan(0);
    expect(['ok', 'warn', 'low']).toContain(u.disk.level);
    expect(u.channel!.cache_bytes).toBeGreaterThan(0);
    expect(u.channel!.renders.release_bytes).toBeGreaterThanOrEqual(5000);
    expect(u.channel!.reclaimable.drafts).toBeGreaterThanOrEqual(2000); // 2 bản ngoài 5 mới nhất
    const r = cleanChannel({ db: core.db, store: core.gateway.storeFor(dir) }, ['drafts']);
    // kênh mẫu có sẵn một render nháp cũ (rd_4k2m9q1z) → 3 bản ngoài 5 mới nhất
    expect(r.removed).toEqual(
      expect.arrayContaining([
        `videos/${fixtureVideoId}/renders/rd_d0000000`,
        `videos/${fixtureVideoId}/renders/rd_d0000001`,
      ]),
    );
    expect(r.removed.some((x) => x.endsWith('rd_d0000002'))).toBe(false);
    for (const rd of ['rd_d0000006', 'rd_d0000002', 'rd_r0000000'])
      expect(existsSync(path.join(dir, 'videos', fixtureVideoId, 'renders', rd))).toBe(true);
  });

  it('cleaning the cache frees it and the next run is a cache miss', async () => {
    const { core, dir, gen, video } = setup();
    expect((await gen(video, 'trống đồng')).result.from_cache).toBe(false);
    expect((await gen(video, 'trống đồng')).result.from_cache).toBe(true);
    const r = cleanChannel({ db: core.db, store: core.gateway.storeFor(dir) }, ['cache']);
    expect(r.freed_bytes).toBeGreaterThan(0);
    expect(existsSync(path.join(dir, 'cache', 'objects'))).toBe(false);
    expect(
      core.db
        .prepare('SELECT COUNT(*) AS n FROM cache_entries WHERE channel = ?')
        .get(core.gateway.storeFor(dir).root),
    ).toMatchObject({ n: 0 });
    expect((await gen(video, 'trống đồng')).result.from_cache).toBe(false);
  });

  it('cache budget evicts least recently used down to 90 %, keeping entries of recently released videos', async () => {
    const { core, dir, gen, video, channelOnly, render, store } = setup();
    const a = await gen(video, 'A: kinh thành Thăng Long'); // dùng ở video có render phát hành
    await gen(channelOnly, 'B: thuyền chiến');
    await gen(channelOnly, 'C: ngựa chiến');
    render('rd_r0000001', 'release', new Date().toISOString());
    const rows = core.db
      .prepare('SELECT key, size FROM cache_entries WHERE channel = ? ORDER BY last_used')
      .all(store.root) as { key: string; size: number }[];
    expect(rows).toHaveLength(3);
    // A cũ nhất, B giữa, C mới nhất
    rows.forEach((r, i) =>
      core.db
        .prepare('UPDATE cache_entries SET last_used = ? WHERE key = ?')
        .run(`2026-10-0${i + 1}T00:00:00Z`, r.key),
    );
    const [ka, kb, kc] = rows.map((r) => r);
    const budgetBytes = ((ka!.size + kc!.size) / 0.9) * 1.001;
    const ch = JSON.parse(readFileSync(path.join(dir, 'channel.json'), 'utf8'));
    ch.config['budget.cache_gb'] = budgetBytes / 1e9;
    writeFileSync(path.join(dir, 'channel.json'), JSON.stringify(ch));
    const r = enforceCacheBudget({ db: core.db, store });
    expect(r.evicted).toEqual([kb!.key]);
    const left = (
      core.db.prepare('SELECT key FROM cache_entries WHERE channel = ?').all(store.root) as {
        key: string;
      }[]
    )
      .map((x) => x.key)
      .sort();
    expect(left).toEqual([ka!.key, kc!.key].sort());
    expect(a.result.asset_id).toMatch(/^as_/);
  });

  it('low disk blocks generation/render jobs with E_DISK_LOW; other jobs still run', async () => {
    const { core, gen, video } = setup({ diskMinBytes: Number.MAX_SAFE_INTEGER });
    const d = await gen(video, 'x');
    expect(d.status).toBe('failed');
    expect(d.error?.code).toBe('E_DISK_LOW');
    core.queue.define('noop', { idempotent: true, run: async () => 'ok' });
    const j = core.queue.enqueue('noop');
    expect((await core.queue.wait(j.id, 5000)).status).toBe('succeeded');
  });

  it('sf disk usage reports the channel', () => {
    const { dir, app } = setup();
    const r = runSf(['disk', 'usage', '--channel', dir], { env: { SF_APP_DATA: app } });
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout).channel).toMatchObject({ cache_bytes: expect.any(Number) });
  });
});
