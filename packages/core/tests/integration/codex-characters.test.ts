// Ảnh nhân vật qua gói ChatGPT (Codex, 2026-10-10 — Tan chọn: chỉ nhân vật): ảnh nhân vật thử Codex trước, lỗi
// hoặc hết hạn mức → provider mặc định; ảnh nền/minh họa không bao giờ qua Codex.
import { afterEach, expect, it } from 'vitest';
import {
  createFakeImageProvider,
  generateImage,
  ProviderRegistry,
  setConfig,
  WriteStore,
} from '../../src/index.js';
import { codexImagePrompt } from '../../src/image/codex-plan.js';
import { SfError } from '../../src/errors.js';
import { loadProviderManifest } from '../../src/providers/manifest.js';
import { copyChannel } from '../domain-helpers.js';

let c: ReturnType<typeof copyChannel> | undefined;
afterEach(() => c?.cleanup());

function setup(codex: 'ok' | 'limit') {
  c = copyChannel();
  const store = new WriteStore(c.dir);
  setConfig(store, 'provider.image.generate', 'image.fake', { tier: 'channel' });
  const providers = new ProviderRegistry();
  const fake = createFakeImageProvider();
  providers.register(fake);
  const calls: string[] = [];
  providers.register({
    ...fake,
    manifest: loadProviderManifest('image.codex-plan'),
    async run(input, ctx) {
      calls.push(input.prompt);
      if (codex === 'limit')
        throw new SfError('E_RUNTIME_RATE_LIMIT', 'You have hit your usage limit');
      return fake.run({ ...input, prompt: `codex ${input.prompt}` }, ctx);
    },
  });
  return { store, providers, calls };
}

it('character images go through the ChatGPT plan; backgrounds never do', async () => {
  const { store, providers, calls } = setup('ok');
  const ch = await generateImage({ providers }, store, {
    prompt: 'stick figure waving',
    width: 768,
    height: 1344,
    transparent: true,
    character: true,
  });
  expect(ch.provider).toBe('image.codex-plan');
  const bg = await generateImage({ providers }, store, {
    prompt: 'a grassy park',
    width: 1664,
    height: 928,
  });
  expect(bg.provider).toBe('image.fake');
  expect(calls).toHaveLength(1);
});

it('a plan limit falls back to the default image provider', async () => {
  const { store, providers, calls } = setup('limit');
  const r = await generateImage({ providers }, store, {
    prompt: 'stick figure waving',
    width: 768,
    height: 1344,
    transparent: true,
    character: true,
  });
  expect(calls).toHaveLength(1);
  expect(r.provider).toBe('image.fake');
});

it('the Codex request asks for one transparent image and keeps the reference identity', () => {
  const p = codexImagePrompt(
    { kind: 'generate', prompt: 'waving', seed: 1, width: 768, height: 1344, transparent: true },
    1,
  );
  expect(p).toMatch(/exactly ONE image/);
  expect(p).toMatch(/same character identity/);
  expect(p).toMatch(/fully transparent/);
  expect(p).toMatch(/portrait/);
});
