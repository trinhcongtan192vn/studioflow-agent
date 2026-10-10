import { readFileSync } from 'node:fs';
import { isMap, isSeq } from 'yaml';
import { resolveConfig } from '../config/resolve.js';
import { parseStoryboard, serializeStoryboard } from '../domain/markdown/storyboard.js';
import { BuildGraph, type BuilderRegistry } from '../graph/graph.js';
import { loadVideoModel } from '../graph/model.js';
import type { StepExecutor, StepRunContext } from './engine.js';

/**
 * Bước `media` (luồng v2): sinh ảnh cho mọi layer `asset_request: generate` (nút `asset` của graph, cache theo
 * nội dung + seed scene → cảnh dùng chung prompt chỉ sinh một lần) rồi chọn nhạc theo `music.query`. Ảnh sinh
 * lỗi hoặc máy không có bộ sinh ảnh → bỏ yêu cầu ảnh của layer đó (layout tự đổi sang bản chữ), không chặn bước.
 */
export function mediaExecutor(d: { builders: BuilderRegistry; music?: StepExecutor }) {
  return async (ctx: StepRunContext): Promise<{ outputs: string[]; summary: string }> => {
    const rel = `videos/${ctx.videoId}/STORYBOARD.md`;
    const notes: string[] = [];
    const graph = new BuildGraph({
      store: ctx.store,
      appDataDir: ctx.appDataDir,
      builders: d.builders,
    });
    // layer xin sinh ảnh (đọc từ storyboard — graph chỉ có nút `asset` khi máy có bộ sinh ảnh)
    const requested = () =>
      loadVideoModel(ctx.store.root, ctx.videoId, ctx.appDataDir).frames.flatMap((f) =>
        f.layers
          .filter((l) => !l.asset_id && l.asset_request?.source === 'generate')
          .map((l) => l.id as string),
      );
    let failed: string[] = [];
    let generated = 0;
    if (d.builders.active('asset')) {
      ctx.progress?.(0, 2, 'Sinh ảnh minh họa');
      const r = await graph.build(ctx.videoId, {
        targets: ['asset'],
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        ...(ctx.progress ? { progress: ctx.progress } : {}),
      });
      failed = Object.entries(r.nodes)
        .filter(([id, n]) => id.startsWith('asset:') && n.status === 'failed')
        .map(([id]) => id.slice('asset:'.length));
      generated = requested().length - failed.length;
      if (failed.length) notes.push(`${failed.length} ảnh sinh lỗi → cảnh đó dựng không ảnh`);
    } else {
      failed = requested();
      if (failed.length) notes.push('máy chưa có bộ sinh ảnh → dựng không ảnh');
    }
    if (failed.length) dropRequests(ctx, rel, new Set(failed));
    const outputs = ['STORYBOARD.md'];
    let musicNote = '';
    const musicOn =
      resolveConfig(
        'advanced.music',
        { channelDir: ctx.channelDir, videoId: ctx.videoId },
        { appDataDir: ctx.appDataDir },
      ).value !== false;
    if (musicOn && d.music) {
      ctx.progress?.(1, 2, 'Chọn nhạc nền');
      const m = await d.music(ctx);
      musicNote = (m as { summary?: string } | undefined)?.summary ?? '';
    }
    return {
      outputs,
      summary: [
        generated ? `Sinh ${generated} ảnh.` : 'Không sinh ảnh mới.',
        ...notes.map((n) => `${n[0]!.toUpperCase()}${n.slice(1)}.`),
        musicNote,
      ]
        .filter(Boolean)
        .join(' '),
    };
  };
}

/** Bỏ `asset_request` của các layer ảnh lỗi (giữ layer, giữ ID) — frame dựng lại bằng layout không ảnh. */
function dropRequests(ctx: StepRunContext, rel: string, layers: Set<string>): void {
  const p = parseStoryboard(readFileSync(ctx.store.abs(rel), 'utf8'));
  let changed = false;
  for (const b of p.blocks) {
    if (b.tag !== 'sf-frame') continue;
    const root = b.doc.contents;
    if (!isMap(root)) continue;
    const ls = root.get('layers', true);
    if (!isSeq(ls)) continue;
    for (const item of ls.items) {
      if (!isMap(item) || !layers.has(String(item.get('id')))) continue;
      item.delete('asset_request');
      changed = true;
      b.docDirty = true;
    }
    if (b.docDirty) b.data = b.doc.toJS();
  }
  if (changed)
    ctx.store.write(rel, serializeStoryboard(p), { by: `step.${ctx.step.id}`, validate: false });
}
