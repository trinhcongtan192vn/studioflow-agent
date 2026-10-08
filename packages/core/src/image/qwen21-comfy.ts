import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EXTENSIONS_DIR } from '../agent/options.js';
import { imageInfo } from '../assets/image-info.js';
import type { ProviderAdapter } from '../capability/types.js';
import { ComfyServer } from '../comfy/server.js';
import {
  attachImages,
  fillWorkflow,
  keepAlpha,
  loadWorkflow,
  type ComfyWorkflow,
} from '../comfy/workflow.js';
import { SfError } from '../errors.js';
import { loadCatalog } from '../models/install.js';
import { loadProviderManifest } from '../providers/manifest.js';
import { writeOutsideProject } from '../store/scratch.js';
import { imageCacheParts, type ImageAdapterInput, type ImageAdapterOutput } from './types.js';

export type QwenMode = 't2i' | 't2i_rgba' | 'edit_ref' | 'edit_mask';

/** Chế độ workflow theo yêu cầu (D4 mục 9.2). */
export function qwenMode(r: {
  kind: 'generate' | 'edit';
  transparent?: boolean;
  mask?: boolean;
}): QwenMode {
  if (r.kind === 'edit') return r.mask ? 'edit_mask' : 'edit_ref';
  return r.transparent ? 't2i_rgba' : 't2i';
}

/** Làm tròn bội 32 (Qwen-Image-2.1); ngoài giới hạn provider → `E_SCHEMA_INVALID`. */
export function snapSide(n: number, lim: { min: number; max: number }): number {
  if (!Number.isFinite(n) || n < lim.min || n > lim.max)
    throw new SfError(
      'E_SCHEMA_INVALID',
      `image side ${n} must be between ${lim.min} and ${lim.max}`,
    );
  return Math.max(32, Math.round(n / 32) * 32);
}

export interface QwenWorkflowRequest {
  mode: QwenMode;
  prompt: string;
  negative?: string;
  width?: number;
  height?: number;
  seed: number;
  steps?: number;
  image_in?: string;
  mask_in?: string;
  refs: string[];
  keepAlpha?: boolean;
  /** Ngân sách pixel ảnh tham chiếu của node mã hóa (0 = giữ kích thước gốc, bội 32). */
  resolution?: number;
}

/** Workflow đầy đủ: nạp chế độ → ảnh tham chiếu → (giữ alpha) → thay chỗ trống bằng defaults + yêu cầu. */
export function buildQwenWorkflow(
  packDir: string,
  defaults: Record<string, unknown>,
  r: QwenWorkflowRequest,
): ComfyWorkflow {
  let wf = attachImages(loadWorkflow(packDir, r.mode), r.refs);
  if (r.keepAlpha) wf = keepAlpha(wf);
  const vars: Record<string, string | number> = {
    ...(defaults as Record<string, string | number>),
    prompt: r.prompt,
    negative: r.negative ?? '',
    seed: r.seed,
    resolution: r.resolution ?? 1024,
    ...(r.steps ? { steps: r.steps } : {}),
    ...(r.width ? { width: r.width } : {}),
    ...(r.height ? { height: r.height } : {}),
    ...(r.image_in ? { image_in: r.image_in } : {}),
    ...(r.mask_in ? { mask_in: r.mask_in } : {}),
  };
  return fillWorkflow(wf, vars);
}

export const QWEN21_PACK = path.join(EXTENSIONS_DIR, 'providers', 'image.qwen21-comfy');

/**
 * `image.qwen21-comfy` (D4 mục 4.3, 9.2): `image.generate` + `image.edit` qua ComfyUI do app quản
 * lý (engine `comfyui`, gpu-heavy). Ảnh nguồn/tham chiếu tải lên `/upload/image` với tên theo hash.
 */
export function createQwen21ComfyProvider(opts: { server: ComfyServer }) {
  const manifest = loadProviderManifest('image.qwen21-comfy');
  const defaults = manifest.defaults ?? {};
  // khóa cache theo file model ghim (sha256 trong models.yaml, D4 mục 7) — không băm lại 6 GB
  const unet = String(defaults.unet ?? '');
  const modelFileHash =
    loadCatalog()
      .flatMap((e) => e.files ?? [])
      .find((f) => f.name === unet)?.sha256 ?? null;
  const adapter: ProviderAdapter<ImageAdapterInput, ImageAdapterOutput> = {
    manifest,
    modelFileHash,
    health: () => opts.server.health(),
    async prepare() {
      await opts.server.ensure();
    },
    async release() {
      await opts.server.release();
    },
    cacheKeyParts: imageCacheParts,
    async run(input, ctx) {
      const c = await opts.server.ensure();
      const up = async (f: { path: string; hash: string }) =>
        c.upload(
          readFileSync(ctx.resolveInput(f.path)),
          `sf_${f.hash.slice(0, 16)}${path.extname(f.path) || '.png'}`,
        );
      const limit = manifest.limits?.max_refs ?? 10;
      if ((input.refs?.length ?? 0) > limit)
        throw new SfError('E_SCHEMA_INVALID', `at most ${limit} reference images`);
      const refs = await Promise.all((input.refs ?? []).map(up));
      const mode = qwenMode({
        kind: input.kind,
        transparent: input.transparent,
        mask: Boolean(input.mask),
      });
      // edit giữ kích thước nguồn (latent theo ảnh 1); nguồn quá lớn → thu về ~2048² pixel
      let resolution = 1024;
      if (input.source) {
        const info = imageInfo(readFileSync(ctx.resolveInput(input.source.path)));
        const max = manifest.limits?.max_side ?? 2048;
        resolution = info && info.width * info.height <= max * max ? 0 : max;
      }
      const wf = buildQwenWorkflow(QWEN21_PACK, defaults, {
        mode,
        prompt: input.prompt,
        negative: input.negative_prompt,
        width: input.width,
        height: input.height,
        seed: input.seed,
        steps: input.steps,
        ...(input.source ? { image_in: await up(input.source) } : {}),
        ...(input.mask ? { mask_in: await up(input.mask) } : {}),
        refs,
        keepAlpha: input.keep_alpha,
        resolution,
      });
      const id = await c.submit(wf);
      const out = await c
        .wait(id, { signal: ctx.signal, onProgress: ctx.progress })
        .catch(async (e: unknown) => {
          // 077: quá hạn → ComfyUI có thể đang kẹt: dừng để lần sau khởi động lại sạch
          if (/did not return an image within/.test(String((e as Error)?.message)))
            await opts.server.stop().catch(() => {});
          throw e;
        });
      const buf = await c.view(out.images[0]!);
      const info = imageInfo(buf);
      if (!info)
        throw new SfError('E_PROVIDER_FAILED', 'ComfyUI returned a file that is not an image');
      writeOutsideProject(path.join(ctx.workdir, 'out.png'), buf);
      return {
        file: 'out.png',
        width: info.width,
        height: info.height,
        alpha: info.alpha,
        seed: input.seed,
      };
    },
  };
  return { adapter, server: opts.server };
}
