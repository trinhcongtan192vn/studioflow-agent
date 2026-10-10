import { existsSync, readFileSync } from 'node:fs';
import { imageStyleSuffix, readChannelDesign } from '../design/channel-design.js';
import { readHost } from '../cast/host.js';
import { SfError } from '../errors.js';
import { isMap, isSeq } from 'yaml';
import { resolveConfig } from '../config/resolve.js';
import { parseStoryboard, serializeStoryboard } from '../domain/markdown/storyboard.js';
import { BuildGraph, PAUSED, type BuilderRegistry } from '../graph/graph.js';
import { loadVideoModel } from '../graph/model.js';
import type { StepExecutor, StepRunContext } from './engine.js';

/**
 * Bước `media` (luồng v2): sinh ảnh cho mọi layer `asset_request: generate` (nút `asset` của graph, cache theo
 * nội dung + seed scene → cảnh dùng chung prompt chỉ sinh một lần) rồi chọn nhạc theo `music.query`. Ảnh sinh
 * lỗi hoặc máy không có bộ sinh ảnh → bỏ yêu cầu ảnh của layer đó (layout tự đổi sang bản chữ), không chặn bước.
 */
export function mediaExecutor(d: {
  builders: BuilderRegistry;
  music?: StepExecutor;
  /** Sinh ảnh chuẩn (tách nền) của một nhân vật/đối tượng → asset kênh. */
  castBase?: (
    ctx: StepRunContext,
    req: {
      prompt: string;
      width: number;
      height: number;
      seed: number;
      key: string;
      /** Ảnh tham chiếu phong cách (nhân vật dẫn chuyện của kênh). */
      refs?: string[];
    },
  ) => Promise<string>;
}) {
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
    // nhân vật/đối tượng của video: ảnh chuẩn trước, làm tham chiếu cho mọi tư thế (cùng một nhân vật)
    if (d.builders.active('asset') && d.castBase) {
      const n = await castBases(ctx, rel, d.castBase);
      if (n.made) notes.push(`${n.made} ảnh chuẩn nhân vật/đối tượng`);
      if (n.failed) notes.push(`${n.failed} ảnh chuẩn nhân vật lỗi → tư thế sinh không tham chiếu`);
    }
    if (d.builders.active('asset')) {
      ctx.progress?.(0, 2, 'Sinh ảnh minh họa');
      const r = await graph.build(ctx.videoId, {
        targets: ['asset'],
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        ...(ctx.stop ? { stop: ctx.stop } : {}),
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
    // tạm dừng ngay sau ảnh cuối cùng đang sinh → chưa bỏ ảnh lỗi, chưa chọn nhạc (chạy lại thì làm tiếp)
    if (ctx.stop?.aborted) throw new SfError('E_JOB_CANCELED', PAUSED);
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

interface CastFile {
  schema_version: 1;
  cast: { key: string; name?: string; kind?: string; look: string; asset_id?: string }[];
}

/** Hạt giống ổn định theo nhân vật (cùng nhân vật → cùng ảnh chuẩn khi sinh lại). */
const seedOf = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h % 2147483647;
};

/**
 * Ảnh chuẩn của từng nhân vật/đối tượng trong `visual-cast.json` (sinh một lần, ghi `asset_id`), rồi gắn làm
 * `reference_asset_ids` cho mọi lớp tư thế (`notes: "actor: cast=<key>…"`) chưa có tham chiếu.
 */
async function castBases(
  ctx: StepRunContext,
  rel: string,
  make: NonNullable<Parameters<typeof mediaExecutor>[0]['castBase']>,
): Promise<{ made: number; failed: number }> {
  const castRel = `videos/${ctx.videoId}/visual-cast.json`;
  if (!existsSync(ctx.store.abs(castRel))) return { made: 0, failed: 0 };
  const file = JSON.parse(readFileSync(ctx.store.abs(castRel), 'utf8')) as CastFile;
  if (!file.cast?.length) return { made: 0, failed: 0 };
  const design = readChannelDesign(ctx.store.root);
  const style = design ? `, ${imageStyleSuffix(design)}` : '';
  // nhân vật dẫn chuyện của kênh: mọi nhân vật mới vẽ theo đúng phong cách tạo hình của nó
  const host = readHost(ctx.store.root);
  let made = 0;
  let failed = 0;
  for (const c of file.cast) {
    if (c.asset_id && existsSync(ctx.store.abs(`assets/files/${c.asset_id}.png`))) continue;
    if (ctx.stop?.aborted) throw new SfError('E_JOB_CANCELED', PAUSED);
    const object = c.kind === 'object';
    ctx.progress?.(0, 2, `Ảnh chuẩn: ${c.name ?? c.key}`);
    try {
      const styled = host && host.id !== c.key;
      c.asset_id = await make(ctx, {
        key: c.key,
        ...(styled ? { refs: [host.asset_id] } : {}),
        prompt: `${styled ? 'drawn in exactly the same art style as the reference image (same line work, shading, colors and proportions) but a different character: ' : ''}${c.look}, ${object ? 'whole object, centered, front view' : 'full body head to feet, standing in a neutral pose, facing the camera'}, character reference, isolated${style}`,
        width: object ? 1024 : 768,
        height: object ? 1024 : 1344,
        seed: seedOf(`${c.key}|${c.look}`),
      });
      made++;
    } catch {
      failed++;
    }
  }
  ctx.store.write(castRel, `${JSON.stringify(file, null, 2)}\n`, {
    by: `step.${ctx.step.id}`,
    validate: false,
  });
  const ref = new Map(file.cast.filter((c) => c.asset_id).map((c) => [c.key, c.asset_id!]));
  if (!ref.size) return { made, failed };
  const p = parseStoryboard(readFileSync(ctx.store.abs(rel), 'utf8'));
  let changed = false;
  for (const b of p.blocks) {
    if (b.tag !== 'sf-frame') continue;
    const root = b.doc.contents;
    if (!isMap(root)) continue;
    const ls = root.get('layers', true);
    if (!isSeq(ls)) continue;
    for (const item of ls.items) {
      if (!isMap(item)) continue;
      const key = /actor:\s*cast=([^;\s]+)/.exec(String(item.get('notes') ?? ''))?.[1];
      const id = key ? ref.get(key) : undefined;
      const req = item.get('asset_request', true);
      if (!id || !isMap(req) || req.get('reference_asset_ids')) continue;
      req.set('reference_asset_ids', [id]);
      changed = true;
      b.docDirty = true;
    }
    if (b.docDirty) b.data = b.doc.toJS();
  }
  if (changed)
    ctx.store.write(rel, serializeStoryboard(p), { by: `step.${ctx.step.id}`, validate: false });
  return { made, failed };
}
