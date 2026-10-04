// 022 · SC-002 (FR-IM-05) — asset sinh ở video A dùng được ở video B (thư viện kênh).
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createCore, createVideo, stageFrameAssets, type SessionContext } from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

describe('asset library reuse across videos (022)', () => {
  it('an image generated in video A is found and staged in video B', async () => {
    const c = copyChannel();
    const t = tempDir('app-');
    copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
    const core = createCore({ appDataDir: t.dir, backoffMs: [10, 20] });
    cleanups.push(() => core.close(), c.cleanup, t.cleanup);
    const store = core.gateway.storeFor(c.dir);
    const sessionA: SessionContext = {
      session_id: 'ss_test0001',
      kind: 'main',
      channel_dir: c.dir,
      video_id: fixtureVideoId,
    };
    const job = (await core.gateway.call(sessionA, 'image.generate', {
      prompt: 'bản đồ cổ Đại Việt trên giấy dó',
      width: 512,
      height: 512,
      seed: 3,
      tags: ['bản đồ'],
    })) as { job_id: string };
    const done = (await core.gateway.call(sessionA, 'job.wait', {
      job_id: job.job_id,
      timeout_ms: 20_000,
    })) as {
      data: { result: { asset_id: string } };
    };
    const assetId = done.data.result.asset_id;
    const videoB = createVideo(store, { title: 'Video B' }).video_id;
    const sessionB: SessionContext = {
      ...sessionA,
      video_id: videoB as SessionContext['video_id'],
    };
    const found = (await core.gateway.call(sessionB, 'asset.search', { query: 'bản đồ' })) as {
      data: { assets: { id: string }[] };
    };
    expect(found.data.assets.map((a) => a.id)).toContain(assetId);
    const staged = stageFrameAssets(store, videoB, [
      { id: 'el_b1b2b3b4', kind: 'background', asset_id: assetId } as never,
    ]);
    expect(staged[0]).toMatchObject({ asset_id: assetId, file: `public/${assetId}.png` });
    expect(existsSync(store.abs(`videos/${videoB}/public/${assetId}.png`))).toBe(true);
  });
});
