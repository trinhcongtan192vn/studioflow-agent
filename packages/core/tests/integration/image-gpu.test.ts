// 018 · SC-001 (nhãn gpu) — ComfyUI thật + Qwen-Image-2.1: t2i 1664×928 ≤ 60 s khi nóng, RGBA có alpha,
// edit giữ kích thước nguồn, /free trả VRAM.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import {
  ComfyServer,
  createQwen21ComfyProvider,
  defaultAppDataDir,
  enginePython,
  imageInfo,
  Logger,
  sha256,
} from '../../src/index.js';
import type { ImageAdapterInput } from '../../src/image/types.js';
import { describeGpu } from '../../src/testing/gpu.js';
import { tempDir } from '../domain-helpers.js';

const work = tempDir('image-gpu-');
const app = defaultAppDataDir();
const server = new ComfyServer({ appDataDir: app });
afterAll(async () => {
  await server.stop();
  work.cleanup();
});

const ready =
  existsSync(enginePython('comfyui', app)) &&
  existsSync(path.join(app, 'providers', 'comfyui', 'ComfyUI', 'main.py')) &&
  existsSync(path.join(app, 'models', 'diffusion_models', 'Qwen-Image-2.1-Q4.gguf'));

let n = 0;
const ctx = () => {
  const dir = path.join(work.dir, `run-${++n}`);
  mkdirSync(dir, { recursive: true });
  return {
    signal: new AbortController().signal,
    workdir: dir,
    progress: () => {},
    logger: new Logger(),
    span: {},
    resolveInput: (p: string) => path.join(work.dir, p),
    secrets: async () => '',
  };
};

const vramGb = async () => {
  const c = await server.ensure();
  const d = (await c.stats()).devices![0]!;
  return (d.vram_total - d.vram_free) / 1e9;
};

describeGpu('image.qwen21-comfy on the reference GPU (018 SC-001)', () => {
  it.skipIf(!ready)(
    't2i ≤ 60 s warm, RGBA alpha, edit keeps size, /free releases VRAM',
    async () => {
      const { adapter } = createQwen21ComfyProvider({ server });
      expect(await adapter.health()).toMatchObject({ ok: true });
      const base = await vramGb();
      const gen = (i: Partial<ImageAdapterInput>) =>
        adapter.run(
          {
            kind: 'generate',
            prompt: 'a misty mountain village at dawn, documentary photo',
            width: 1664,
            height: 928,
            seed: 1,
            ...i,
          } as ImageAdapterInput,
          ctx(),
        );
      await gen({ width: 512, height: 512 }); // nạp model
      const t0 = Date.now();
      const r = await gen({ seed: 2 });
      const warmMs = Date.now() - t0;
      expect(warmMs).toBeLessThan(60_000);
      expect(r).toMatchObject({ width: 1664, height: 928, alpha: false });
      const lantern = await gen({
        prompt: 'a red paper lantern, isolated object',
        width: 1024,
        height: 1024,
        transparent: true,
        seed: 4,
      });
      expect(lantern.alpha).toBe(true);
      // ảnh nguồn cho edit: lấy kết quả t2i (đường dẫn tương đối work.dir)
      const srcRel = path
        .relative(work.dir, path.join(work.dir, `run-2`, r.file))
        .replaceAll('\\', '/');
      const buf = readFileSync(path.join(work.dir, srcRel));
      const edit = await adapter.run(
        {
          kind: 'edit',
          prompt: 'make it night time with a full moon',
          seed: 5,
          source: { path: srcRel, hash: sha256(buf) },
        },
        ctx(),
      );
      expect(imageInfo(readFileSync(path.join(work.dir, `run-${n}`, edit.file)))).toMatchObject({
        width: 1664,
        height: 928,
      });
      await server.release();
      await new Promise((res) => setTimeout(res, 3000));
      expect(await vramGb()).toBeLessThan(base + 0.5);
      console.log(`018 SC-001: warm 1664×928 ${(warmMs / 1000).toFixed(1)} s`);
    },
    600_000,
  );
});
