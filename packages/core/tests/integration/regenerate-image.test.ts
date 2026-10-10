// Tạo lại ảnh kèm ghi chú lỗi (tab Xem trước, 2026-10-10): mọi cảnh dùng chung ảnh đổi theo prompt mới và chỉ
// sinh một lần; lớp ảnh thư viện không tạo lại được.
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, it } from 'vitest';
import {
  assetBuilder,
  createFakeImageProvider,
  ProviderRegistry,
  type BuilderRegistry,
} from '../../src/index.js';
import { regenerateLayerImage } from '../../src/review/regenerate.js';
import { fixtureAppData, fixtureVideoId } from '../domain-helpers.js';
import { graphFixture, V } from '../graph-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
// graph của fixture giữ registry builder bên trong
const registryOf = (g: unknown) => (g as { builders: BuilderRegistry }).builders;
afterEach(() => cleanups.splice(0).forEach((c) => c()));

it('regenerating a shared image updates every scene using it and generates it once', async () => {
  const fx = graphFixture();
  cleanups.push(fx.cleanup);
  const providers = new ProviderRegistry();
  const fake = createFakeImageProvider();
  let runs = 0;
  providers.register({
    ...fake,
    run: async (i, ctx) => {
      runs++;
      return fake.run(i, ctx);
    },
  });
  fx.graph.registerBuilder('asset', assetBuilder({ providers, appDataDir: fixtureAppData }));
  // cảnh thứ hai dùng chung ảnh nền của cảnh đầu (cùng prompt)
  const sbFile = fx.store.abs(`${V}/STORYBOARD.md`);
  writeFileSync(
    sbFile,
    readFileSync(sbFile, 'utf8').replace(
      '{ id: el_a1b2c3d4, kind: image, asset_id: as_h6k2q9vt }',
      '{ id: el_a1b2c3d4, kind: background, asset_request: { source: generate, prompt: "bản đồ cổ Đại Việt, giấy dó", aspect: "16:9" } }',
    ),
  );
  const r = await regenerateLayerImage(
    { store: fx.store, builders: registryOf(fx.graph), appDataDir: fixtureAppData },
    fixtureVideoId,
    'el_t5w8n3ja',
    'bản đồ bị mờ, chữ lem',
  );
  expect(r).toMatchObject({ status: 'built', layers: 2 });
  const sb = readFileSync(sbFile, 'utf8');
  expect(sb.match(/bản đồ cổ Đại Việt, giấy dó, bản đồ bị mờ, chữ lem/g)).toHaveLength(2);
  expect(sb.match(/notes: "?img: regen-/g)).toHaveLength(2);
  expect(runs).toBe(1); // cảnh thứ hai lấy từ cache
  const g = JSON.parse(readFileSync(fx.store.abs(`${V}/.sf/graph.json`), 'utf8')).nodes;
  expect(g['asset:el_a1b2c3d4'].meta.asset_id).toBe(g['asset:el_t5w8n3ja'].meta.asset_id);
  await expect(
    regenerateLayerImage(
      { store: fx.store, builders: registryOf(fx.graph), appDataDir: fixtureAppData },
      fixtureVideoId,
      'el_q2k7m4zp',
      'x',
    ),
  ).rejects.toThrow(/no generated image/);
});
