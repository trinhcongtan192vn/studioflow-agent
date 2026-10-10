import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ProviderRegistry } from '../capability/registry.js';
import { cacheDir, cacheKey, cacheKeyParts } from '../capability/run.js';
import type { AnyAdapter } from '../capability/registry.js';
import type { SettingsConfig } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';
import type { Builder, NodeDef, Planner } from '../graph/graph.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';
import { lookPrompt, generateImage, assetRef } from './service.js';
import { alphaNegative, alphaPrompt } from './alpha-prompt.js';
import type { ImageAdapterInput } from './types.js';
import { readFileSync } from 'node:fs';

export interface AssetBuilderDeps {
  providers: ProviderRegistry;
  db?: Db;
  appDataDir?: string;
}

/** Builder nút `asset` (D4 mục 8.1, 020 US1): `image.generate` cho layer chưa có asset. */
export function assetBuilder(deps: AssetBuilderDeps): Builder {
  return async (ctx) => {
    const def = ctx.def!;
    const parts = def.parts as {
      prompt: string;
      refs: string[];
      transparent: boolean;
      size: [number, number];
      look: string | null;
      seed: number;
    };
    if (!parts.prompt.trim())
      throw new SfError(
        'E_SCHEMA_INVALID',
        `layer ${def.key} asks to generate an image but has no prompt`,
      );
    const r = await generateImage(
      { providers: deps.providers, db: deps.db },
      ctx.store,
      {
        prompt: parts.prompt,
        width: parts.size[0],
        height: parts.size[1],
        ...(parts.transparent ? { transparent: true } : {}),
        ...(parts.refs.length ? { reference_asset_ids: parts.refs } : {}),
        ...(parts.look ? { look: parts.look } : {}),
        seed: parts.seed,
        tags: ['generated', `layer:${def.key}`],
      },
      { videoId: ctx.videoId, appDataDir: deps.appDataDir, signal: ctx.signal },
    );
    return {
      outputs: [r.public!],
      meta: {
        asset_id: r.asset_id,
        width: r.width,
        height: r.height,
        alpha: r.alpha,
        provider: r.provider,
      },
    };
  };
}

/** Giá một ảnh: `settings.pricing` (đơn vị `image`) → `policy.paid_api.per_call_usd` (020 R5). */
export function imagePrice(
  adapter: AnyAdapter,
  store: WriteStore,
  videoId: string,
  appDataDir?: string,
): number {
  if (adapter.manifest.cost.kind === 'free') return 0;
  const f = appDataDir ? path.join(appDataDir, 'settings.json') : undefined;
  const pricing =
    f && existsSync(f)
      ? ((JSON.parse(readFileSync(f, 'utf8')) as SettingsConfig).pricing ?? [])
      : [];
  const p = pricing.find((x) => x.provider === adapter.manifest.id && x.unit === 'image');
  if (p) return p.usd;
  return Number(
    resolveConfig(
      'policy.paid_api.per_call_usd',
      { channelDir: store.root, videoId },
      { appDataDir },
    ).value,
  );
}

/** Đầu vào adapter tương đương lúc build (để tính khóa cache khi lập kế hoạch). */
function plannedInput(store: WriteStore, def: NodeDef): ImageAdapterInput | undefined {
  const p = def.parts as {
    prompt: string;
    refs: string[];
    transparent: boolean;
    size: [number, number];
    look: string | null;
    seed: number;
  };
  try {
    const style = lookPrompt(p.look);
    const full = style ? `${p.prompt.trim()} ${style}` : p.prompt.trim();
    return {
      kind: 'generate',
      prompt: p.transparent ? alphaPrompt(full) : full,
      ...(p.transparent ? { negative_prompt: alphaNegative() } : {}),
      width: p.size[0],
      height: p.size[1],
      ...(p.transparent ? { transparent: true } : {}),
      seed: p.seed,
      refs: p.refs.map((id) => {
        const { path: rel, hash } = assetRef(store, id);
        return { path: rel, hash };
      }),
    };
  } catch {
    return undefined;
  }
}

/** Planner `asset`: engine, chi phí, trúng cache (D4 mục 3.1). */
export function assetPlanner(deps: AssetBuilderDeps): Planner {
  return ({ store, model, def }) => {
    const id = model.config<string | null>('provider.image.generate');
    let adapter = id ? deps.providers.get(id) : undefined;
    if (!adapter && process.env.SF_GPU === '0')
      adapter = deps.providers
        .forCapability('image.generate')
        .find((a) => a.manifest.id.endsWith('.fake'));
    if (!adapter) return {};
    const input = plannedInput(store, def);
    const key = input
      ? cacheKey(cacheKeyParts(adapter, 'image.generate', input, input.seed))
      : undefined;
    return {
      ...(adapter.manifest.engine ? { engine: adapter.manifest.engine } : {}),
      from_cache: Boolean(key && existsSync(store.abs(`${cacheDir(key)}/meta.json`))),
      cost_usd: imagePrice(adapter, store, model.videoId, deps.appDataDir),
    };
  };
}
