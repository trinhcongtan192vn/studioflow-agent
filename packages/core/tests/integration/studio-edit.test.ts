// 025 · SC-001 (AC-M3-01), SC-002 (AC-M3-02), FR-ST-06 — Studio chế độ chỉnh thật (hyperframes preview)
// sau proxy: chỉnh qua API Studio → commit → frame ghim; 094: frame nhận mọi thay đổi (ghim nguyên frame),
// index.html vẫn theo danh sách cho phép.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { describeStudio } from '../../src/testing/gpu.js';
import {
  BuildGraph,
  buildFramePacket,
  createCore,
  designSystemExecutor,
  loadVideoModel,
  type Core,
  type SessionContext,
  type VideoState,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';
import { sampleFrame } from '../frame-helpers.js';

const c = copyChannel();
const t = tempDir('app-');
let core: Core;
let session: SessionContext;
const v = path.join(c.dir, 'videos', fixtureVideoId);
const F1 = 'fr_9x2b7cqe';
const F2 = 'fr_3m8k1w7d';
const state = () => JSON.parse(readFileSync(path.join(v, 'state.json'), 'utf8')) as VideoState;
const call = async (tool: string, input: unknown) =>
  (await core.gateway.call(session, tool, input)) as {
    ok: boolean;
    data: never;
    error?: { code: string; message: string; details?: unknown };
  };

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
  await g.build(fixtureVideoId, { targets: ['frame_timing', 'captions', 'asset'] });
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

describeStudio('Studio edit mode (025)', () => {
  it('AC-M3-01: edit position + timing through Studio, commit → pinned frame that survives rebuilds', async () => {
    const open = await call('studio.open', { mode: 'edit' });
    expect(open.ok, JSON.stringify(open.error)).toBe(true);
    const { url, project_id } = open.data as { url: string; project_id: string };
    expect(state().owner).toBe('studio');
    // agent không ghi file cảnh khi Studio đang mở (FR-ST-06)
    const w = await call('artifact.write', {
      path: `compositions/frames/${F2}.html`,
      content: '<template></template>',
    });
    expect(w).toMatchObject({ ok: false, error: { code: 'E_OWNER_CONFLICT' } });
    const base = new URL(url).origin;
    // ghi file ngoài cảnh bị proxy chặn (FR-ST-03; 094 cho lưu mã thô file cảnh)
    const raw = await fetch(`${base}/api/projects/${project_id}/files/hyperframes.json`, {
      method: 'PUT',
      body: 'x',
    });
    expect(raw.status).toBe(403);
    // chỉnh như người dùng kéo phần tử + đổi thời lượng (API Studio thật qua proxy)
    const el = 'el_q2k7m4zp';
    const r = await fetch(
      `${base}/api/projects/${project_id}/file-mutations/patch-element/compositions/frames/${F1}.html`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: { selector: `[data-sf-id="${el}"]` },
          operations: [
            { type: 'inline-style', property: 'left', value: '640px' },
            { type: 'attribute', property: 'duration', value: '3.5' },
          ],
        }),
      },
    );
    expect(r.ok, await r.clone().text()).toBe(true);
    const done = await call('studio.commit', {});
    expect(done.ok, JSON.stringify(done.error)).toBe(true);
    expect(done.data).toMatchObject({ pinned_frames: [F1] });
    const html = readFileSync(path.join(v, 'compositions', 'frames', `${F1}.html`), 'utf8');
    expect(html).toContain('left: 640px');
    expect(html).toContain('data-duration="3.5"');
    const pin = (
      state().pinned_frames as Record<string, { changes: { element_id: string; attr: string }[] }>
    )[F1]!;
    expect(pin.changes.map((x) => `${x.element_id}:${x.attr}`).sort()).toEqual([
      `${el}:data-duration`,
      `${el}:style.left`,
    ]);
    const st = new BuildGraph({
      store: core.gateway.storeFor(c.dir),
      appDataDir: t.dir,
      builders: core.graph,
    }).status(fixtureVideoId);
    expect(st.find((n) => n.key === `frame_html:${F1}`)!.status).toBe('pinned');
    {
      const cl = await call('studio.close', {});
      expect(cl.ok, JSON.stringify(cl.error)).toBe(true);
    }
    expect(state().owner).toBe('agent');
    // mở lại vẫn còn
    const again = await call('studio.open', { mode: 'edit' });
    const s2 = (again.data as { session_id: string }).session_id;
    expect(
      readFileSync(
        path.join(v, '.sf', 'studio-work', s2, 'compositions', 'frames', `${F1}.html`),
        'utf8',
      ),
    ).toContain('left: 640px');
    {
      const cl = await call('studio.close', {});
      expect(cl.ok, JSON.stringify(cl.error)).toBe(true);
    }
    // agent ghi đè frame ghim → phải hỏi (người dùng từ chối)
    core.gateway.permissions.once(
      'permission.requested',
      (q: { request_id: string; kind: string }) => {
        expect(q.kind).toBe('pinned_frame');
        core.gateway.permissions.decide({ request_id: q.request_id, allow: false });
      },
    );
    const over = await call('artifact.write', {
      path: `compositions/frames/${F1}.html`,
      content: html.replace('640px', '1px'),
    });
    expect(over).toMatchObject({ ok: false, error: { code: 'E_PERMISSION_DECLINED' } });
  }, 300_000);

  it('AC-M3-02 / 094: free frame edits are saved as a whole-frame pin; index.html still refuses; close needs discard', async () => {
    const open = await call('studio.open', { mode: 'edit' });
    const { session_id, url, project_id } = open.data as {
      session_id: string;
      url: string;
      project_id: string;
    };
    const work = path.join(v, '.sf', 'studio-work', session_id);
    const fr2 = path.join(work, 'compositions', 'frames', `${F2}.html`);
    // lưu mã thô một frame qua proxy được phép (094); file ngoài cảnh / xóa file vẫn bị chặn
    const base = new URL(url).origin;
    const api = `${base}/api/projects/${project_id}/files`;
    const edited = readFileSync(fr2, 'utf8')
      .replace('tl.fromTo(', 'tl.to("#x", { rotation: 360 }, 0); tl.fromTo(')
      .replace(`id="${F2}-bg"`, `id="${F2}-bg" data-x="1"`);
    const put = await fetch(`${api}/compositions/frames/${F2}.html`, {
      method: 'PUT',
      body: edited,
    });
    expect(put.status).not.toBe(403);
    expect((await fetch(`${api}/public/x.txt`, { method: 'PUT', body: 'x' })).status).toBe(403);
    expect(
      (await fetch(`${api}/compositions/frames/${F2}.html`, { method: 'DELETE' })).status,
    ).toBe(403);
    writeFileSync(fr2, edited);
    const ok = await call('studio.commit', {});
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
    expect(ok.data).toMatchObject({ pinned_frames: [F2], whole_frames: [F2] });
    expect(readFileSync(path.join(v, 'compositions', 'frames', `${F2}.html`), 'utf8')).toContain(
      'rotation: 360',
    );
    const pin = (state().pinned_frames as Record<string, { changes: { element_id: string }[] }>)[
      F2
    ]!;
    expect(pin.changes.some((c) => c.element_id === '*')).toBe(true);
    // index.html: thay đổi ngoài danh sách vẫn bị từ chối (builder dựng lại file này)
    const idx = path.join(work, 'index.html');
    writeFileSync(idx, readFileSync(idx, 'utf8').replace('<body', '<body data-x="1"'));
    const r = await call('studio.commit', {});
    expect(r).toMatchObject({ ok: false, error: { code: 'E_STUDIO_DISALLOWED_CHANGE' } });
    expect(r.error!.message).toMatch(/index\.html/);
    expect(readFileSync(path.join(v, 'index.html'), 'utf8')).not.toContain('data-x="1"');
    expect(await call('studio.close', {})).toMatchObject({
      ok: false,
      error: { code: 'E_STUDIO_UNCOMMITTED' },
    });
    {
      const cl = await call('studio.close', { discard: true });
      expect(cl.ok, JSON.stringify(cl.error)).toBe(true);
    }
    expect(existsSync(work)).toBe(false);
  }, 300_000);
});
