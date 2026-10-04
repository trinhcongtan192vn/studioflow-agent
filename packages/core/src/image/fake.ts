import { readFileSync } from 'node:fs';
import path from 'node:path';
import { imageInfo } from '../assets/image-info.js';
import type { ProviderAdapter } from '../capability/types.js';
import { sha256 } from '../domain/hash.js';
import { loadProviderManifest } from '../providers/manifest.js';
import { writeOutsideProject } from '../store/scratch.js';
import { solidPng } from './png.js';
import { imageCacheParts, type ImageAdapterInput, type ImageAdapterOutput } from './types.js';

/** `image.fake` (D4 mục 4.3, D12): PNG một màu theo prompt + seed — xác định, không GPU. */
export function createFakeImageProvider(): ProviderAdapter<ImageAdapterInput, ImageAdapterOutput> {
  return {
    manifest: loadProviderManifest('image.fake'),
    health: async () => ({ ok: true }),
    cacheKeyParts: imageCacheParts,
    async run(input, ctx) {
      let { width, height } = input;
      if (input.kind === 'edit' && input.source) {
        const info = imageInfo(readFileSync(ctx.resolveInput(input.source.path)));
        width = info?.width;
        height = info?.height;
      }
      const h = sha256(`${input.prompt}|${input.seed}|${input.source?.hash ?? ''}`);
      const rgb: [number, number, number] = [0, 2, 4].map((i) =>
        parseInt(h.slice(i, i + 2), 16),
      ) as [number, number, number];
      const alpha = Boolean(input.transparent || input.keep_alpha);
      writeOutsideProject(
        path.join(ctx.workdir, 'out.png'),
        solidPng(width ?? 64, height ?? 64, rgb, alpha),
      );
      ctx.progress(1, 1);
      return { file: 'out.png', width: width ?? 64, height: height ?? 64, alpha, seed: input.seed };
    },
  };
}
