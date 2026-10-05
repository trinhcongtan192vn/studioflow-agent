import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { applyLipsync, frameLipsync, mouthDir } from '../lipsync/mouths.js';
import type { FrameTiming } from '../graph/timing.js';
import { SfError } from '../errors.js';
import { bakeKey, bakeLooks, type BakeItem } from '../finish/bake.js';
import {
  applyFinish,
  effectCatalog,
  frameFinish,
  frameImageSources,
  normalizeGrading,
  type MediaEffect,
} from '../finish/grading.js';
import { contentInputHash, type Builder, type BuilderContext } from '../graph/graph.js';
import type { WriteStore } from '../store/writer.js';
import { checkFrameFile } from './frame-file.js';

/** Dựng lại một frame bằng phiên agent `frame` (WorkflowService, 020 R1). */
export type FrameRebuilder = (i: {
  store: WriteStore;
  videoId: string;
  frameId: string;
  signal: AbortSignal;
}) => Promise<void>;

/**
 * Hoàn thiện frame (027, FR-CP-04/05): look kênh/scene nướng vào ảnh (`public/looks/`, một lần render cho
 * mọi ảnh của video còn thiếu — research R2); hiệu ứng media → `data-color-grading` áp lúc render.
 */
async function finishFrame(ctx: BuilderContext, rel: string, appDataDir?: string): Promise<void> {
  const frame = ctx.model.frames.find((f) => f.id === ctx.key)!;
  const anyFx = ctx.model.frames.some((f) => f.effects?.length);
  const cat: Map<string, MediaEffect> = anyFx ? await effectCatalog() : new Map();
  const fin = frameFinish(ctx.model, frame, cat, appDataDir);
  if (fin.unknown_effects.length)
    throw new SfError(
      'E_SCHEMA_INVALID',
      `frame ${ctx.key}: unknown media effect(s) ${fin.unknown_effects.join(', ')}`,
    );
  const abs = ctx.store.abs(`${ctx.videoRel}/${rel}`);
  const html = readFileSync(abs, 'utf8');
  let baked: Map<string, string> | null = null;
  if (fin.lookPatch) {
    // gom mọi cặp (ảnh, look) của các frame đã có để nướng chung một lần render
    const items: BakeItem[] = [];
    for (const f of ctx.model.frames) {
      const fa = ctx.store.abs(`${ctx.videoRel}/compositions/frames/${f.id}.html`);
      if (!existsSync(fa)) continue;
      const ff = frameFinish(ctx.model, f, cat, appDataDir);
      if (!ff.lookPatch) continue;
      const g = await normalizeGrading(ff.lookPatch);
      for (const src of frameImageSources(readFileSync(fa, 'utf8')))
        items.push({ src, grading: g });
    }
    const all = await bakeLooks(ctx.store, ctx.videoId, items, {
      appDataDir,
      signal: ctx.signal,
    });
    const g = await normalizeGrading(fin.lookPatch);
    baked = new Map(
      frameImageSources(html).flatMap((src) => {
        const r = all.get(bakeKey({ src, grading: g }));
        return r ? [[src, r] as [string, string]] : [];
      }),
    );
  }
  const fx = fin.fxPatch ? await normalizeGrading(fin.fxPatch) : null;
  let next = applyFinish(html, { baked, fx });
  // 032: khẩu hình — ảnh miệng của bộ phong cách vào public/, timeline đổi theo cue
  const ls = frameLipsync(
    ctx.store,
    ctx.model,
    frame,
    ctx.records['frame_timing']?.meta as FrameTiming | undefined,
  );
  let mouthSrc: ((s: string) => string) | undefined;
  if (ls) {
    const dir = mouthDir(ls.set, ls.view, appDataDir);
    if (!dir)
      throw new SfError(
        'E_FILE_NOT_FOUND',
        `mouth set ${ls.set}/${ls.view} is not in any style pack (mouths/<set>/<view>/{closed,half,open}.svg)`,
      );
    const pub = `public/mouths/${ls.set}/${ls.view}`;
    for (const st of ['closed', 'half', 'open']) {
      const rel = `${ctx.videoRel}/${pub}/${st}.svg`;
      const src = readFileSync(path.join(dir, `${st}.svg`));
      if (!existsSync(ctx.store.abs(rel)) || !readFileSync(ctx.store.abs(rel)).equals(src))
        ctx.store.write(rel, src, { by: 'graph.build', validate: false });
    }
    mouthSrc = (st) => `${pub}/${st}.svg`;
  }
  next = applyLipsync(next, frame.id, ls && mouthSrc ? { ...ls, src: mouthSrc } : null);
  if (next !== html) ctx.store.write(`${ctx.videoRel}/${rel}`, next, { by: 'graph.build' });
}

/**
 * Builder nút `frame_html` (D4 mục 8.1): file frame hợp lệ chưa có bản ghi → nhận vào graph; chỉ phần
 * hoàn thiện đổi → áp lại look/hiệu ứng, không gọi agent (027); thiếu hoặc nội dung lỗi thời → phiên
 * `frame` dựng lại đúng frame đó. Không có bộ dựng lại → `E_STEP_INCOMPLETE`.
 */
export function frameHtmlBuilder(deps: {
  rebuild: () => FrameRebuilder | undefined;
  appDataDir?: string;
}): Builder {
  return async (ctx) => {
    const rel = `compositions/frames/${ctx.key}.html`;
    const abs = ctx.store.abs(`${ctx.videoRel}/${rel}`);
    const frame = ctx.model.frames.find((f) => f.id === ctx.key)!;
    const layerIds = frame.layers.map((l) => l.id);
    const valid = () =>
      existsSync(abs) && checkFrameFile(readFileSync(abs, 'utf8'), ctx.key, layerIds).length === 0;
    const content = ctx.def ? contentInputHash(ctx.def, ctx.records) : undefined;
    const rec = ctx.records[ctx.nodeId];
    const prevContent =
      (rec?.meta as { content_hash?: string } | undefined)?.content_hash ?? rec?.input_hash;
    const done = async () => {
      await finishFrame(ctx, rel, deps.appDataDir);
      return { outputs: [rel], ...(content ? { meta: { content_hash: content } } : {}) };
    };
    if (!rec && valid()) return done();
    if (rec && content && prevContent === content && valid()) return done();
    const rebuild = deps.rebuild();
    if (!rebuild)
      throw new SfError(
        'E_STEP_INCOMPLETE',
        `frame ${ctx.key} needs to be rebuilt by a frame agent; run the frame-build step`,
      );
    await rebuild({ store: ctx.store, videoId: ctx.videoId, frameId: ctx.key, signal: ctx.signal });
    if (!valid()) {
      const problems = existsSync(abs)
        ? checkFrameFile(readFileSync(abs, 'utf8'), ctx.key, layerIds).map((p) => p.message)
        : [`${rel} was not written`];
      throw new SfError('E_PROVIDER_FAILED', `frame ${ctx.key}: ${problems.join('; ')}`);
    }
    return done();
  };
}
