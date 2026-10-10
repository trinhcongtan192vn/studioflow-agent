// Ảnh nhân vật (Codex, mạng) và ảnh nền (Qwen, GPU) dựng song song (2026-10-10): hai làn trong cùng một lần build.
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { fixtureVideoId } from '../domain-helpers.js';
import { graphFixture, V } from '../graph-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

it('a transparent character image and a background image are built at the same time', async () => {
  const fx = graphFixture();
  cleanups.push(fx.cleanup);
  const sbFile = fx.store.abs(`${V}/STORYBOARD.md`);
  writeFileSync(
    sbFile,
    readFileSync(sbFile, 'utf8').replace(
      '{ id: el_a1b2c3d4, kind: image, asset_id: as_h6k2q9vt }',
      '{ id: el_a1b2c3d4, kind: object, notes: "actor: cast=c1", asset_request: { source: generate, prompt: "a girl waving", transparent: true, aspect: "9:16" } }',
    ),
  );
  const spans: Record<string, [number, number]> = {};
  fx.graph.registerBuilder('asset', async (ctx) => {
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 150));
    spans[ctx.key] = [t0, Date.now()];
    return { outputs: [], meta: { asset_id: `as_${ctx.key.slice(3)}` } };
  });
  const r = await fx.graph.build(fixtureVideoId, {
    targets: ['asset:el_t5w8n3ja', 'asset:el_a1b2c3d4'],
  });
  expect(r.nodes['asset:el_t5w8n3ja']?.status).toBe('built');
  expect(r.nodes['asset:el_a1b2c3d4']?.status).toBe('built');
  const [a, b] = [spans['el_t5w8n3ja']!, spans['el_a1b2c3d4']!];
  // chồng thời gian: mỗi ảnh bắt đầu trước khi ảnh kia xong
  expect(a[0]).toBeLessThan(b[1]);
  expect(b[0]).toBeLessThan(a[1]);
});
