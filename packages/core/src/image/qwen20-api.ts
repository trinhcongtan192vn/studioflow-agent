import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { imageInfo } from '../assets/image-info.js';
import type { ProviderAdapter } from '../capability/types.js';
import { SfError } from '../errors.js';
import { loadProviderManifest } from '../providers/manifest.js';
import { writeOutsideProject } from '../store/scratch.js';
import { getSecretDefault } from '../secrets/credman.js';
import { imageCacheParts, type ImageAdapterInput, type ImageAdapterOutput } from './types.js';

const SECRET = 'dashscope_api_key';

function providerSettings(appDataDir: string | undefined): { endpoint?: string; model?: string } {
  const f = appDataDir ? path.join(appDataDir, 'settings.json') : undefined;
  if (!f || !existsSync(f)) return {};
  const s = JSON.parse(readFileSync(f, 'utf8')) as {
    provider_settings?: Record<string, { endpoint?: string; model?: string }>;
  };
  return s.provider_settings?.['image.qwen20-api'] ?? {};
}

const dataUri = (buf: Buffer, file: string) =>
  `data:image/${path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg') || 'png'};base64,${buf.toString('base64')}`;

/**
 * `image.qwen20-api` (FR-IM-04, 018 research R6): Qwen-Image-2.0 qua Alibaba Cloud Model Studio —
 * gọi đồng bộ, tải ảnh ngay (URL hết hạn 24 h). Có phí → tool hỏi trước (D5 5.1). Không hỗ trợ RGBA.
 */
export function createQwen20ApiProvider(opts: {
  appDataDir?: string;
  getSecret?: (name: string) => string | undefined;
}): ProviderAdapter<ImageAdapterInput, ImageAdapterOutput> {
  const manifest = loadProviderManifest('image.qwen20-api');
  const getSecret = opts.getSecret ?? getSecretDefault;
  return {
    manifest,
    async health() {
      if (!providerSettings(opts.appDataDir).endpoint)
        return {
          ok: false,
          detail: 'set provider_settings."image.qwen20-api".endpoint in settings.json',
        };
      if (!getSecret(SECRET)) return { ok: false, detail: `secret ${SECRET} is not set` };
      return { ok: true };
    },
    cacheKeyParts: (i) => ({
      ...imageCacheParts(i),
      model: providerSettings(opts.appDataDir).model ?? manifest.defaults?.model,
    }),
    async run(input, ctx) {
      if (input.transparent || input.keep_alpha)
        throw new SfError(
          'E_PROVIDER_UNSUPPORTED',
          'image.qwen20-api cannot produce transparent images; use image.qwen21-comfy or image.remove_bg',
        );
      if (input.mask)
        throw new SfError(
          'E_PROVIDER_UNSUPPORTED',
          'image.qwen20-api has no mask editing; describe the region in the instruction',
        );
      const st = providerSettings(opts.appDataDir);
      const key = await ctx.secrets(SECRET);
      const images = [input.source, ...(input.refs ?? [])].filter((x): x is NonNullable<typeof x> =>
        Boolean(x),
      );
      const max = manifest.limits?.max_refs ?? 3;
      if (images.length > max)
        throw new SfError('E_SCHEMA_INVALID', `at most ${max} input images for image.qwen20-api`);
      const content = [
        ...images.map((f) => ({ image: dataUri(readFileSync(ctx.resolveInput(f.path)), f.path) })),
        { text: input.prompt },
      ];
      const r = await fetch(st.endpoint!, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        signal: ctx.signal,
        body: JSON.stringify({
          model: st.model ?? manifest.defaults?.model ?? 'qwen-image-2.0',
          input: { messages: [{ role: 'user', content }] },
          parameters: {
            n: 1,
            ...(input.width && input.height ? { size: `${input.width}*${input.height}` } : {}),
            ...(input.negative_prompt
              ? { negative_prompt: input.negative_prompt.slice(0, 500) }
              : {}),
            seed: input.seed,
            prompt_extend: false,
            watermark: false,
          },
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        code?: string;
        message?: string;
        output?: { choices?: { message?: { content?: { image?: string }[] } }[] };
      };
      if (!r.ok) {
        const code =
          r.status === 401 || r.status === 403
            ? 'E_AUTH_REQUIRED'
            : r.status === 429
              ? 'E_RUNTIME_RATE_LIMIT'
              : 'E_PROVIDER_FAILED';
        throw new SfError(
          code,
          `Qwen-Image API ${r.status}: ${j.code ?? ''} ${j.message ?? ''}`.trim(),
        );
      }
      const url = j.output?.choices?.[0]?.message?.content?.find((c) => c.image)?.image;
      if (!url) throw new SfError('E_PROVIDER_FAILED', 'Qwen-Image API returned no image');
      const img = await fetch(url, { signal: ctx.signal });
      if (!img.ok)
        throw new SfError('E_PROVIDER_FAILED', `image download failed: HTTP ${img.status}`);
      const buf = Buffer.from(await img.arrayBuffer());
      const info = imageInfo(buf);
      if (!info)
        throw new SfError(
          'E_PROVIDER_FAILED',
          'Qwen-Image API returned a file that is not an image',
        );
      writeOutsideProject(path.join(ctx.workdir, 'out.png'), buf);
      ctx.progress(1, 1);
      return {
        file: 'out.png',
        width: info.width,
        height: info.height,
        alpha: info.alpha,
        seed: input.seed,
      };
    },
  };
}
