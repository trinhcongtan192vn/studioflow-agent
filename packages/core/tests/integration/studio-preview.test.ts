// 017 · FR-ST-01 — Studio xem trước: `hyperframes preview` thật trên bản chụp chỉ đọc, đồng bộ khi
// file cảnh đổi, đóng không để tiến trình (SF_GPU=0).
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeStudio } from '../../src/testing/gpu.js';
import {
  BuildGraph,
  buildFramePacket,
  createCore,
  designSystemExecutor,
  loadVideoModel,
  snapshotRel,
  type Core,
  type SessionContext,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';
import { sampleFrame } from '../frame-helpers.js';

const c = copyChannel();
const t = tempDir('app-');
let core: Core;
let session: SessionContext;
const v = path.join(c.dir, 'videos', fixtureVideoId);

beforeAll(async () => {
  process.env.SF_GPU = '0';
  writeFileSync(
    path.join(t.dir, 'settings.json'),
    readFileSync(path.join(fixtureAppData, 'settings.json')),
  );
  core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 1000 });
  session = {
    session_id: 'ss_test0001',
    kind: 'main',
    channel_dir: c.dir,
    video_id: fixtureVideoId,
  };
  const store = core.gateway.storeFor(c.dir);
  const step = { id: 'ds', uses: 'design-system', title: 'DS' };
  await designSystemExecutor()({
    store,
    channelDir: c.dir,
    videoId: fixtureVideoId,
    step,
    manifest: { id: 't', steps: [step] },
    signal: new AbortController().signal,
    appDataDir: t.dir,
  } as never);
  const g = new BuildGraph({ store, appDataDir: t.dir, builders: core.graph });
  await g.build(fixtureVideoId, { targets: ['frame_timing', 'captions'] });
  const timing = JSON.parse(readFileSync(path.join(v, '.sf', 'graph.json'), 'utf8')).nodes
    .frame_timing.meta;
  const model = loadVideoModel(c.dir, fixtureVideoId);
  for (const f of model.frames)
    store.write(
      `videos/${fixtureVideoId}/compositions/frames/${f.id}.html`,
      sampleFrame(buildFramePacket({ model, timing, frameId: f.id, assets: [] })),
      { by: 'test', validate: false },
    );
  await g.build(fixtureVideoId, { targets: ['index'] });
}, 300_000);
afterAll(() => {
  core.close();
  c.cleanup();
  t.cleanup();
});

describeStudio('Studio preview (017 FR-ST-01)', () => {
  it('serves the pinned Studio on a read-only snapshot and resyncs on change', async () => {
    const before = readFileSync(path.join(v, 'index.html'), 'utf8');
    const r = (await core.gateway.call(session, 'studio.open', { mode: 'preview' })) as {
      ok: boolean;
      data: { url: string; port: number };
    };
    expect(r.ok).toBe(true);
    // 028: qua proxy + trang cầu nối cùng origin (WebMCP)
    expect(r.data.url).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/__sf\/bridge\.html#project\/vd_8m2pq7rt$/,
    );
    const res = await fetch(`http://127.0.0.1:${r.data.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<!doctype html>');
    const bridge = await fetch(`http://127.0.0.1:${r.data.port}/__sf/bridge.html`);
    expect(await bridge.text()).toContain("s.src = '/' + location.hash");
    // xem trước chỉ đọc: API ghi bị chặn ở proxy
    const put = await fetch(
      `http://127.0.0.1:${r.data.port}/api/projects/vd_8m2pq7rt/files/index.html`,
      {
        method: 'PUT',
        body: 'x',
      },
    );
    expect(put.status).toBe(403);
    const snap = path.join(c.dir, ...snapshotRel(fixtureVideoId).split('/'));
    // Studio tự ghi lại index.html của dự án nó mở (S6: chuẩn hóa HTML) → chỉ bản chụp đổi
    expect(readFileSync(path.join(snap, 'index.html'), 'utf8')).toContain(
      'data-sf-frame="fr_9x2b7cqe"',
    );
    expect(readFileSync(path.join(v, 'index.html'), 'utf8')).toBe(before);
    expect(lstatSync(path.join(snap, 'public')).isSymbolicLink()).toBe(true);
    // đổi frame gốc → bản chụp đồng bộ
    const frame = path.join(v, 'compositions', 'frames', 'fr_9x2b7cqe.html');
    writeFileSync(frame, readFileSync(frame, 'utf8').replace('1428', '1429'));
    const t0 = Date.now();
    while (
      !readFileSync(path.join(snap, 'compositions', 'frames', 'fr_9x2b7cqe.html'), 'utf8').includes(
        '1429',
      )
    ) {
      if (Date.now() - t0 > 10_000) throw new Error('snapshot not resynced');
      await new Promise((res2) => setTimeout(res2, 200));
    }
    // mở lần hai dùng lại máy chủ đang chạy
    const again = (await core.gateway.call(session, 'studio.open', { mode: 'preview' })) as {
      data: { url: string };
    };
    expect(again.data.url).toBe(r.data.url);
    expect(await core.gateway.call(session, 'studio.close', {})).toMatchObject({
      ok: true,
      data: { closed: true },
    });
    await new Promise((res2) => setTimeout(res2, 1500));
    await expect(fetch(`http://127.0.0.1:${r.data.port}/`)).rejects.toThrow();
    // file gốc không bị Studio đụng tới
    expect(readFileSync(path.join(v, 'index.html'), 'utf8')).toBe(before);
  }, 180_000);
});
