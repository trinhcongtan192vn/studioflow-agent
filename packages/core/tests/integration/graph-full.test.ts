// 020 · SC-001..003 — nút asset / frame_html (ghim) / credits / render, kế hoạch có ước tính.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  assetBuilder,
  assetPlanner,
  createFakeImageProvider,
  creditsBuilder,
  frameHtmlBuilder,
  ProviderRegistry,
  type FrameRebuilder,
} from '../../src/index.js';
import { fixtureAppData, fixtureVideoId } from '../domain-helpers.js';
import { graphFixture, V } from '../graph-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const LAYERS: Record<string, string[]> = {
  fr_9x2b7cqe: ['el_t5w8n3ja', 'el_q2k7m4zp'],
  fr_3m8k1w7d: ['el_a1b2c3d4'],
};
const frameHtml = (fr: string, tag = '') =>
  `<template><div data-composition-id="${fr}">${LAYERS[fr]!.map((id) => `<div data-sf-id="${id}">${tag}</div>`).join('')}<script>window.__timelines = window.__timelines || {}; window.__timelines["${fr}"] = gsap.timeline({ paused: true });</script></div></template>`;

function setup() {
  const fx = graphFixture();
  cleanups.push(fx.cleanup);
  const registry = new ProviderRegistry();
  const fake = createFakeImageProvider();
  registry.register(fake);
  // provider thứ hai (giả lập đổi local ↔ API, có phí)
  registry.register({
    ...fake,
    manifest: { ...fake.manifest, id: 'image.fake-b', cost: { kind: 'per_image' } },
  });
  const rebuilt: string[] = [];
  const rebuild: FrameRebuilder = async ({ store, videoId, frameId }) => {
    rebuilt.push(frameId);
    store.write(
      `videos/${videoId}/compositions/frames/${frameId}.html`,
      frameHtml(frameId, 'rebuilt'),
      { by: 'test' },
    );
  };
  fx.graph.registerBuilder(
    'asset',
    assetBuilder({ providers: registry, appDataDir: fixtureAppData }),
  );
  fx.graph.registerPlanner(
    'asset',
    assetPlanner({ providers: registry, appDataDir: fixtureAppData }),
  );
  fx.graph.registerBuilder('frame_html', frameHtmlBuilder({ rebuild: () => rebuild }));
  fx.graph.registerBuilder('credits', creditsBuilder({ appDataDir: fixtureAppData }));
  for (const fr of Object.keys(LAYERS))
    fx.store.write(`${V}/compositions/frames/${fr}.html`, frameHtml(fr), { by: 'test' });
  const setChannel = (k: string, v: unknown) => {
    const f = fx.store.abs('channel.json');
    const ch = JSON.parse(readFileSync(f, 'utf8'));
    ch.config[k] = v;
    writeFileSync(f, JSON.stringify(ch));
  };
  const status = (id: string) => fx.graph.status(fixtureVideoId).find((n) => n.key === id);
  return { ...fx, rebuilt, setChannel, status };
}

describe('build graph — full node set (020)', () => {
  it('asset nodes generate images per scene seed; existing valid frames are adopted, not rebuilt', async () => {
    const { graph, store, rebuilt, status } = setup();
    const r = await graph.build(fixtureVideoId);
    expect(r.status, JSON.stringify(r.nodes)).toBe('succeeded');
    const asset = status('asset:el_t5w8n3ja')!;
    expect(asset.status).toBe('fresh');
    const meta = JSON.parse(readFileSync(store.abs(`${V}/.sf/graph.json`), 'utf8')).nodes[
      'asset:el_t5w8n3ja'
    ].meta as {
      asset_id: string;
      width: number;
      height: number;
    };
    expect(meta).toMatchObject({ width: 1664, height: 928 });
    expect(readFileSync(store.abs(`${V}/public/${meta.asset_id}.png`)).length).toBeGreaterThan(0);
    expect(rebuilt).toEqual([]);
    expect(status('frame_html:fr_9x2b7cqe')!.status).toBe('fresh');
    expect(status('credits')!.status).toBe('fresh');
    // render chỉ khi được chọn
    expect(graph.plan(fixtureVideoId).jobs.map((j) => j.kind)).not.toContain('render');
  });

  it('AC-M2-02: editing one line replans only its audio, timing, its own frame and assembly', async () => {
    const { graph, store, rebuilt } = setup();
    await graph.build(fixtureVideoId);
    const f = store.abs(`${V}/SCRIPT.md`);
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace(
        'kéo dài hơn ba trăm năm.',
        'kéo dài hơn ba trăm năm, với nhiều biến cố lớn.',
      ),
    );
    const plan = graph.plan(fixtureVideoId).jobs.map((j) => j.targets[0]);
    expect(plan.sort()).toEqual(
      [
        'audio.line:ln_5h8q2m3x',
        'asr.line:ln_5h8q2m3x',
        'audio_meta',
        'captions',
        'frame_timing',
        'frame_html:fr_3m8k1w7d',
        'index',
        'credits',
      ].sort(),
    );
    const r = await graph.build(fixtureVideoId);
    expect(r.status).toBe('succeeded');
    expect(rebuilt).toEqual(['fr_3m8k1w7d']);
  });

  it('AC-M2-03: switching the image provider makes asset nodes stale and regenerates them', async () => {
    const { graph, store, setChannel, status } = setup();
    await graph.build(fixtureVideoId);
    const g = () =>
      JSON.parse(readFileSync(store.abs(`${V}/.sf/graph.json`), 'utf8')).nodes['asset:el_t5w8n3ja']
        .meta.asset_id as string;
    const before = g();
    setChannel('provider.image.generate', 'image.fake-b');
    expect(status('asset:el_t5w8n3ja')!.status).toBe('stale');
    // kế hoạch: chi phí cho provider có phí (mặc định policy.paid_api.per_call_usd)
    const plan = graph.plan(fixtureVideoId);
    const job = plan.jobs.find((j) => j.targets[0] === 'asset:el_t5w8n3ja')!;
    expect(job.est_cost_usd).toBeGreaterThan(0);
    expect(plan.estimate.total_cost_usd).toBe(job.est_cost_usd);
    await graph.build(fixtureVideoId);
    expect(g()).not.toBe(before);
  });

  it('037: an image with references stays fresh when other assets join the library; changes when a reference changes', async () => {
    const { graph, store, status } = setup();
    const sb = store.abs(`${V}/STORYBOARD.md`);
    writeFileSync(
      sb,
      readFileSync(sb, 'utf8').replace(
        'aspect: "16:9" }',
        'aspect: "16:9", reference_asset_ids: [as_h6k2q9vt] }',
      ),
    );
    // file của ảnh tham chiếu (kênh mẫu chỉ có bản ghi manifest)
    mkdirSync(store.abs('assets/files'), { recursive: true });
    writeFileSync(store.abs('assets/files/palace.png'), 'ref');
    await graph.build(fixtureVideoId);
    expect(status('asset:el_t5w8n3ja')!.status).toBe('fresh');
    const mf = store.abs('assets/manifest.json');
    const m = JSON.parse(readFileSync(mf, 'utf8'));
    // ảnh khác được thêm vào thư viện kênh (ví dụ ảnh vừa sinh cho layer khác) → không ảnh hưởng
    m.assets.push({
      ...m.assets[0],
      id: 'as_n3wa55et',
      file: 'assets/files/new.png',
      hash: '22'.padEnd(64, '0'),
    });
    writeFileSync(store.abs('assets/files/new.png'), 'x');
    writeFileSync(mf, JSON.stringify(m));
    expect(status('asset:el_t5w8n3ja')!.status).toBe('fresh');
    // ảnh được tham chiếu đổi → lỗi thời
    m.assets[0].hash = '33'.padEnd(64, '0');
    writeFileSync(mf, JSON.stringify(m));
    expect(status('asset:el_t5w8n3ja')!.status).toBe('stale');
  });
  it('plan reports from_cache when the output can come from the cache', async () => {
    const { graph, store } = setup();
    await graph.build(fixtureVideoId);
    const meta = JSON.parse(readFileSync(store.abs(`${V}/.sf/graph.json`), 'utf8')).nodes[
      'asset:el_t5w8n3ja'
    ].meta;
    rmSync(store.abs(`${V}/public/${meta.asset_id}.png`));
    const plan = graph.plan(fixtureVideoId);
    expect(plan.jobs.find((j) => j.targets[0] === 'asset:el_t5w8n3ja')).toMatchObject({
      from_cache: true,
    });
    expect(plan.estimate.cached_count).toBeGreaterThanOrEqual(1);
  });

  it('pinned frames: pinned, then pinned_stale (decision required, no job) after an input change; accept → pinned', async () => {
    const { graph, store, rebuilt, status } = setup();
    await graph.build(fixtureVideoId);
    const sf = store.abs(`${V}/state.json`);
    const st = JSON.parse(readFileSync(sf, 'utf8'));
    st.pinned_frames = {
      fr_9x2b7cqe: {
        pinned_at: '2026-10-04T10:00:00+07:00',
        base_hash: '0'.repeat(64),
        changes: [{ element_id: 'el_q2k7m4zp', attr: 'style', before: null, after: 'color:red' }],
      },
    };
    writeFileSync(sf, JSON.stringify(st));
    expect(status('frame_html:fr_9x2b7cqe')!.status).toBe('pinned');
    const f = store.abs(`${V}/SCRIPT.md`);
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace('Năm 1428', 'Vào năm 1428, sau nhiều năm kháng chiến'),
    );
    expect(status('frame_html:fr_9x2b7cqe')).toMatchObject({
      status: 'pinned_stale',
      decision_required: true,
    });
    expect(graph.plan(fixtureVideoId).jobs.map((j) => j.targets[0])).not.toContain(
      'frame_html:fr_9x2b7cqe',
    );
    await graph.build(fixtureVideoId);
    expect(rebuilt).not.toContain('fr_9x2b7cqe');
    graph.acceptPinned(fixtureVideoId, 'fr_9x2b7cqe');
    expect(status('frame_html:fr_9x2b7cqe')!.status).toBe('pinned');
  });
});
