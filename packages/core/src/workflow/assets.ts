import { readChannelAssets } from '../hf/packet.js';
import { SfError } from '../errors.js';
import { BuildGraph, type BuilderRegistry } from '../graph/graph.js';
import { loadVideoModel } from '../graph/model.js';
import type { WriteStore } from '../store/writer.js';
import type { StepRunContext } from './engine.js';
import { registerObjective } from './gates.js';

type LayerNeed = { frame: string; layer: string; why: string };

/**
 * Layer cần asset chưa có (D6 mục 2 gate "mọi layer có asset", 023): `asset_id` không có trong thư viện
 * kênh; `asset_request` generate chưa có nút `asset` fresh; library/user chưa có `asset_id`.
 */
export function unresolvedAssets(
  store: WriteStore,
  videoId: string,
  builders: BuilderRegistry | undefined,
  appDataDir?: string,
): LayerNeed[] {
  const model = loadVideoModel(store.root, videoId, appDataDir);
  const lib = new Set(readChannelAssets(store.root).map((a) => a.id as string));
  const status = builders
    ? new Map(
        new BuildGraph({ store, appDataDir, builders })
          .status(videoId)
          .map((n) => [n.key, n.status]),
      )
    : new Map<string, string>();
  const out: LayerNeed[] = [];
  for (const f of model.frames)
    for (const l of f.layers) {
      if (l.asset_id) {
        if (!lib.has(l.asset_id))
          out.push({
            frame: f.id,
            layer: l.id,
            why: `asset ${l.asset_id} is not in the channel library`,
          });
        continue;
      }
      const req = l.asset_request;
      if (!req || req.source === 'code') continue;
      if (req.source === 'generate') {
        const s = status.get(`asset:${l.id}`);
        if (s !== 'fresh')
          out.push({
            frame: f.id,
            layer: l.id,
            why: `generated image not ready (${s ?? 'no asset node'})`,
          });
      } else out.push({ frame: f.id, layer: l.id, why: `needs a ${req.source} asset (asset_id)` });
    }
  return out;
}

/** Executor bước `assets` (D6 mục 2 "agent + engine", 023): sinh ảnh qua nút `asset`, phần còn lại giao agent. */
export function assetsExecutor(builders: BuilderRegistry) {
  return async (ctx: StepRunContext): Promise<{ outputs: string[]; summary?: string }> => {
    const graph = new BuildGraph({ store: ctx.store, appDataDir: ctx.appDataDir, builders });
    if (builders.active('asset')) {
      const r = await graph.build(ctx.videoId, { targets: ['asset'], signal: ctx.signal });
      const failed = Object.entries(r.nodes).filter(([, n]) => n.status === 'failed');
      if (failed.length)
        throw new SfError(
          'E_PROVIDER_FAILED',
          `image generation failed: ${failed.map(([id, n]) => `${id}: ${n.error?.message}`).join('; ')}`,
        );
    }
    const generated = graph.status(ctx.videoId).filter((n) => n.type === 'asset').length;
    // thư viện/người dùng: agent tìm asset.search, gắn asset_id hoặc đổi sang sinh ảnh/vẽ code (skill)
    const rest = unresolvedAssets(ctx.store, ctx.videoId, builders, ctx.appDataDir).filter(
      (n) => !n.why.startsWith('generated'),
    );
    let outputs: string[] = [];
    if (rest.length) {
      if (!ctx.agent)
        throw new SfError('E_STEP_INCOMPLETE', 'assets needs an agent session for library assets');
      outputs =
        (await ctx.agent(
          `Layer còn thiếu asset: ${rest.map((n) => `${n.frame}/${n.layer} (${n.why})`).join('; ')}.`,
        )) ?? [];
      if (builders.active('asset'))
        await graph.build(ctx.videoId, { targets: ['asset'], signal: ctx.signal });
    }
    return {
      outputs,
      ...(generated ? { summary: `Sinh ${generated} ảnh từ storyboard.` } : {}),
    };
  };
}

registerObjective('assets_resolved', (g) => {
  const need = unresolvedAssets(g.store, g.videoId, g.builders, g.appDataDir);
  return need.length
    ? {
        pass: false,
        detail: need
          .slice(0, 6)
          .map((n) => `${n.frame}/${n.layer}: ${n.why}`)
          .join('; '),
      }
    : { pass: true };
});
