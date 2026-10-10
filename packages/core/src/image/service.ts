import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { EXTENSIONS_DIR } from '../agent/options.js';
import { readManifest } from '../assets/library.js';
import type { ProviderRegistry } from '../capability/registry.js';
import { cacheKey, cacheKeyParts, runCapability } from '../capability/run.js';
import type { AssetManifest } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { sha256 } from '../domain/hash.js';
import { seededId } from '../domain/ids.js';
import { isSfError, SfError } from '../errors.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';
import { snapSide } from './qwen21-comfy.js';
import type { ImageAdapterInput, ImageFileRef } from './types.js';

type Asset = AssetManifest['assets'][number];
import { alphaNegative, alphaPrompt } from './alpha-prompt.js';

const MANIFEST = 'assets/manifest.json';

export interface ImageServices {
  providers: ProviderRegistry;
  db?: Db;
}

export interface ImageRunOpts {
  videoId?: string;
  appDataDir?: string;
  signal?: AbortSignal;
  progress?: (done: number, total: number, message?: string) => void;
  jobId?: string;
}

export interface ImageResult {
  asset_id: string;
  file: string;
  public?: string;
  width: number;
  height: number;
  alpha: boolean;
  seed?: number;
  provider: string;
  from_cache: boolean;
}

/** Asset kênh → đường dẫn + hash (đầu vào adapter); không có → `E_ID_UNKNOWN`. */
export function assetRef(store: WriteStore, id: string): ImageFileRef & { asset: Asset } {
  const a = readManifest(store).assets.find((x) => x.id === id);
  if (!a || !existsSync(store.abs(a.file)))
    throw new SfError('E_ID_UNKNOWN', `asset ${id} is not in assets/manifest.json`);
  if (a.kind !== 'image') throw new SfError('E_SCHEMA_INVALID', `asset ${id} is not an image`);
  return { path: a.file, hash: a.hash, asset: a };
}

/** Seed ngẫu nhiên được chọn và ghi lại khi người gọi không đưa (tái lập được). */
export const pickSeed = (seed?: number): number => seed ?? randomInt(0, 2 ** 31 - 1);

/** `image_prompt` của style pack theo look (D13 mục 6, 018 research R6); không có → undefined. */
export function lookPrompt(look: string | undefined | null): string | undefined {
  if (!look) return undefined;
  const f = path.join(EXTENSIONS_DIR, 'styles', look, 'style.yaml');
  if (!existsSync(f)) return undefined;
  const y = parse(readFileSync(f, 'utf8')) as { image_prompt?: string };
  return y.image_prompt?.trim() || undefined;
}

/**
 * Chạy capability ảnh và đăng ký kết quả vào thư viện kênh (`assets/files/<as>.png`, `source.kind =
 * generated`) + chép `public/` của video. ID asset suy từ khóa cache → cùng đầu vào + seed cho cùng asset.
 */
async function runToAsset(
  s: ImageServices,
  store: WriteStore,
  capability: 'image.generate' | 'image.edit' | 'image.remove_bg',
  input: ImageAdapterInput | { source: ImageFileRef; subject: string },
  meta: { seed?: number; description: string; tags: string[] },
  o: ImageRunOpts,
): Promise<ImageResult> {
  const adapter = await s.providers.resolve(capability, {
    channelDir: store.root,
    videoId: o.videoId,
    appDataDir: o.appDataDir,
  });
  const key = cacheKey(cacheKeyParts(adapter, capability, input, meta.seed));
  const id = seededId('as', key);
  const file = `assets/files/${id}.png`;
  const r = await runCapability({
    store,
    db: s.db,
    adapter,
    capability,
    input,
    ...(meta.seed === undefined ? {} : { seed: meta.seed }),
    videoId: o.videoId,
    outputs: { file },
    signal: o.signal,
    progress: o.progress,
    jobId: o.jobId,
  });
  const out = r.output as unknown as { width: number; height: number; alpha: boolean };
  const m = readManifest(store);
  if (!m.assets.some((a) => a.id === id)) {
    m.assets.push({
      id: id as Asset['id'],
      file,
      kind: 'image',
      width: out.width,
      height: out.height,
      alpha: out.alpha,
      tags: meta.tags,
      description: meta.description.slice(0, 300),
      source: { kind: 'generated' },
      hash: sha256(readFileSync(store.abs(file))),
      created_at: new Date().toISOString(),
    });
    store.write(MANIFEST, `${JSON.stringify(m, null, 2)}\n`, { by: capability });
  }
  let pub: string | undefined;
  if (o.videoId) {
    pub = `public/${id}.png`;
    const dest = `videos/${o.videoId}/${pub}`;
    if (!existsSync(store.abs(dest))) store.copyWithin(file, dest, { by: capability });
  }
  return {
    asset_id: id,
    file,
    ...(pub ? { public: pub } : {}),
    width: out.width,
    height: out.height,
    alpha: out.alpha,
    ...(meta.seed === undefined ? {} : { seed: meta.seed }),
    provider: adapter.manifest.id,
    from_cache: r.from_cache,
  };
}

export interface GenerateInput {
  prompt: string;
  negative_prompt?: string;
  width: number;
  height: number;
  transparent?: boolean;
  reference_asset_ids?: string[];
  look?: string;
  seed?: number;
  steps?: number;
  tags?: string[];
}

/** `image.generate` (D4 mục 2.4, FR-IM-02): prompt + look kênh → asset. */
export async function generateImage(
  s: ImageServices,
  store: WriteStore,
  input: GenerateInput,
  o: ImageRunOpts = {},
): Promise<ImageResult> {
  const adapter = await s.providers.resolve('image.generate', {
    channelDir: store.root,
    videoId: o.videoId,
    appDataDir: o.appDataDir,
  });
  const lim = {
    min: adapter.manifest.limits?.min_side ?? 256,
    max: adapter.manifest.limits?.max_side ?? 2048,
  };
  const look =
    input.look ??
    resolveConfig<string | null>(
      'look.id',
      { channelDir: store.root, videoId: o.videoId },
      { appDataDir: o.appDataDir },
    ).value;
  const style = lookPrompt(look);
  const seed = pickSeed(input.seed);
  const full = style ? `${input.prompt.trim()} ${style}` : input.prompt.trim();
  const req: ImageAdapterInput = {
    kind: 'generate',
    // trong suốt: Qwen RGBA sinh thẳng — bỏ cụm tả nền khỏi prompt, chặn nền bằng prompt phủ định
    prompt: input.transparent ? alphaPrompt(full) : full,
    ...(input.transparent
      ? { negative_prompt: alphaNegative(input.negative_prompt) }
      : input.negative_prompt
        ? { negative_prompt: input.negative_prompt }
        : {}),
    width: snapSide(input.width, lim),
    height: snapSide(input.height, lim),
    ...(input.transparent ? { transparent: true } : {}),
    ...(input.steps ? { steps: input.steps } : {}),
    seed,
    refs: (input.reference_asset_ids ?? []).map((id) => {
      const { path: p, hash } = assetRef(store, id);
      return { path: p, hash };
    }),
  };
  return runToAsset(
    s,
    store,
    'image.generate',
    req,
    { seed, description: input.prompt, tags: input.tags ?? [] },
    o,
  );
}

export interface EditInput {
  source_asset_id: string;
  instruction: string;
  mask_asset_id?: string;
  reference_asset_ids?: string[];
  seed?: number;
  tags?: string[];
}

/** `image.edit` (FR-IM-03): asset mới, ảnh nguồn giữ nguyên; nguồn có alpha → giữ alpha. */
export async function editImage(
  s: ImageServices,
  store: WriteStore,
  input: EditInput,
  o: ImageRunOpts = {},
): Promise<ImageResult> {
  const src = assetRef(store, input.source_asset_id);
  const ref = (id: string) => {
    const { path: p, hash } = assetRef(store, id);
    return { path: p, hash };
  };
  const seed = pickSeed(input.seed);
  const req: ImageAdapterInput = {
    kind: 'edit',
    prompt: input.instruction.trim(),
    seed,
    source: { path: src.path, hash: src.hash },
    ...(input.mask_asset_id ? { mask: ref(input.mask_asset_id) } : {}),
    refs: (input.reference_asset_ids ?? []).map(ref),
    ...(src.asset.alpha ? { keep_alpha: true } : {}),
  };
  const edited = await runToAsset(
    s,
    store,
    'image.edit',
    req,
    {
      seed,
      description: `${input.instruction} (edit of ${input.source_asset_id})`,
      tags: input.tags ?? src.asset.tags,
    },
    o,
  );
  if (!src.asset.alpha) return edited;
  // 038: nguồn trong suốt — model sửa ảnh làm việc trên phần RGB ẩn của nền (màu tím của chế độ
  // RGBA) và trả ảnh đặc → nhân vật nằm trong ô tím. Tách nền lại cho kết quả.
  try {
    return await removeBackground(
      s,
      store,
      { source_asset_id: edited.asset_id, subject: 'object' },
      o,
    );
  } catch (e) {
    if (isSfError(e) && e.code === 'E_PROVIDER_UNAVAILABLE') return edited;
    throw e;
  }
}

/** `image.remove_bg` (FR-IM-03) → asset PNG trong suốt. */
export async function removeBackground(
  s: ImageServices,
  store: WriteStore,
  input: { source_asset_id: string; subject: 'person' | 'object' },
  o: ImageRunOpts = {},
): Promise<ImageResult> {
  const src = assetRef(store, input.source_asset_id);
  return runToAsset(
    s,
    store,
    'image.remove_bg',
    { source: { path: src.path, hash: src.hash }, subject: input.subject },
    {
      description: `${src.asset.description ?? input.source_asset_id} (no background)`,
      tags: src.asset.tags,
    },
    o,
  );
}
