import type { Frame } from '../contracts/types.js';
import { sha256 } from '../domain/hash.js';
import type { VideoModel } from '../graph/model.js';
import { frameLook } from './grading.js';
import { overlayBlocks, stylePack, type OverlayBlock } from './styles.js';

export interface OverlayInstance {
  /** id composition (duy nhất trong video): `ov-<fr>-<n>`. */
  id: string;
  frame_id: string;
  block: string;
  /** Tương đối đầu frame. */
  offset_ms: number;
  duration_ms: number;
  /** Tương đối video: `compositions/overlays/<id>.html`. */
  file: string;
  html: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Lỗi khai báo overlay của frame (khối không có, thiếu biến bắt buộc). */
export function overlayProblems(
  frame: Pick<Frame, 'id' | 'overlays'>,
  blocks: Map<string, OverlayBlock>,
): string[] {
  const out: string[] = [];
  for (const o of frame.overlays ?? []) {
    const b = blocks.get(o.block);
    if (!b) {
      out.push(`frame ${frame.id}: overlay block ${o.block} is not installed`);
      continue;
    }
    for (const v of b.vars)
      if (v.required && !String(o.vars?.[v.id] ?? '').trim())
        out.push(`frame ${frame.id}: overlay ${o.block} needs ${v.id}`);
    for (const k of Object.keys(o.vars ?? {}))
      if (!b.vars.some((v) => v.id === k))
        out.push(`frame ${frame.id}: overlay ${o.block} has no variable ${k}`);
  }
  return out;
}

/** Hash các khối overlay đang dùng (đổi mẫu khi cập nhật app → `index` lỗi thời). */
export function overlayBlocksHash(model: VideoModel, appDataDir?: string): string | null {
  const used = new Set(model.frames.flatMap((f) => (f.overlays ?? []).map((o) => o.block)));
  if (!used.size) return null;
  const blocks = overlayBlocks(appDataDir);
  return sha256(
    [...used]
      .sort()
      .map((id) => `${id}:${blocks.get(id) ? sha256(blocks.get(id)!.template) : 'missing'}`)
      .join('\n'),
  );
}

/**
 * Overlay của các frame (FR-CP-05, FN-common 6–7): mỗi khai báo `sf-frame.overlays[]` thành một
 * sub-composition riêng (biến đã điền), đặt ở tầng overlay (trên nội dung + transition, dưới caption).
 */
export function overlayInstances(
  model: VideoModel,
  timing: { frames: { id: string; start_ms: number; duration_ms: number }[] },
  size: { width: number; height: number },
  appDataDir?: string,
): { instances: (OverlayInstance & { start_ms: number })[]; problems: string[] } {
  const blocks = overlayBlocks(appDataDir);
  const instances: (OverlayInstance & { start_ms: number })[] = [];
  const problems: string[] = [];
  for (const f of model.frames) {
    if (!f.overlays?.length) continue;
    const bad = overlayProblems(f, blocks);
    problems.push(...bad);
    if (bad.length) continue;
    const t = timing.frames.find((x) => x.id === f.id);
    if (!t) continue;
    const look = frameLook(model, f, appDataDir);
    const accent =
      (look.pack ? stylePack(look.pack, appDataDir)?.palette?.accent : undefined) ?? '#ffb020';
    f.overlays.forEach((o, n) => {
      const b = blocks.get(o.block)!;
      const offset = Math.min(b.delay_ms, Math.max(0, t.duration_ms - 500));
      const duration = Math.max(500, Math.min(b.duration_ms, t.duration_ms - offset));
      const id = `ov-${f.id}-${n}`;
      const vals: Record<string, string> = Object.fromEntries(
        b.vars.map((v) => [v.id, String(o.vars?.[v.id] ?? v.default ?? '')]),
      );
      const subs: Record<string, string> = {
        composition_id: id,
        width: String(size.width),
        height: String(size.height),
        duration: String(r3(duration / 1000)),
        out_at: String(r3(Math.max(0.2, duration / 1000 - 0.45))),
        accent: esc(accent),
        ...Object.fromEntries(Object.entries(vals).map(([k, v]) => [`vars.${k}`, esc(v)])),
      };
      const html = b.template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => subs[k] ?? m);
      instances.push({
        id,
        frame_id: f.id,
        block: o.block,
        offset_ms: offset,
        duration_ms: duration,
        start_ms: t.start_ms + offset,
        file: `compositions/overlays/${id}.html`,
        html,
      });
    });
  }
  return { instances, problems };
}
