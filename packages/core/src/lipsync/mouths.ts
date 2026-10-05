import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Frame, LipsyncCues } from '../contracts/types.js';
import { styleDirs } from '../finish/styles.js';
import type { FrameTiming } from '../graph/timing.js';
import type { VideoModel } from '../graph/model.js';
import type { WriteStore } from '../store/writer.js';

export const DEFAULT_MOUTH_SET = 'flat';
const STATES = ['closed', 'half', 'open'] as const;

/** Thư mục bộ miệng `mouths/<set>/<view>/` trong các gói phong cách (D13 mục 6, FN-032). */
export function mouthDir(set: string, view: string, appDataDir?: string): string | undefined {
  if (!/^[\w-]+$/.test(set) || !/^[\w-]+$/.test(view)) return undefined;
  for (const d of styleDirs(appDataDir)) {
    if (!existsSync(d)) continue;
    for (const pack of readdirSync(d)) {
      const m = path.join(d, pack, 'mouths', set, view);
      if (STATES.every((s) => existsSync(path.join(m, `${s}.svg`)))) return m;
    }
  }
  return undefined;
}

export interface FrameLipsync {
  anchor: string;
  set: string;
  view: string;
  /** Cue theo giây tương đối đầu frame. */
  cues: { t: number; mouth: (typeof STATES)[number] }[];
}

/**
 * Khẩu hình của frame (032): frame có `lipsync` + cue của các line của nhân vật trong frame → mốc
 * tương đối đầu frame. Không có cue → undefined.
 */
export function frameLipsync(
  store: WriteStore,
  model: VideoModel,
  frame: Frame,
  timing: FrameTiming | undefined,
): FrameLipsync | undefined {
  if (!frame.lipsync?.cast_id || !frame.lipsync.mouth_anchor || !timing) return undefined;
  const ft = timing.frames.find((f) => f.id === frame.id);
  if (!ft) return undefined;
  const cast = model.cast[frame.lipsync.cast_id];
  const cues: FrameLipsync['cues'] = [];
  for (const l of timing.lines.filter((x) => x.frame_id === frame.id)) {
    const f = store.abs(`videos/${model.videoId}/lipsync/${l.id}.json`);
    if (!existsSync(f)) continue;
    const doc = JSON.parse(readFileSync(f, 'utf8')) as LipsyncCues;
    const off = (l.start_ms - ft.start_ms) / 1000;
    for (const c of doc.cues)
      cues.push({ t: Math.round((off + c.frame / doc.fps) * 1000) / 1000, mouth: c.mouth });
  }
  if (!cues.length) return undefined;
  return {
    anchor: frame.lipsync.mouth_anchor,
    set: cast?.mouth_set ?? DEFAULT_MOUTH_SET,
    view: 'front',
    cues: cues.sort((a, b) => a.t - b.t),
  };
}

const MARK_OPEN = '<!--sf:mouth-->';
const MARK_CLOSE = '<!--/sf:mouth-->';

/**
 * Chèn khẩu hình vào HTML frame (032): ba ảnh miệng trong phần tử `data-sf-id = anchor`, timeline GSAP
 * của frame đổi ảnh theo cue. `null` → gỡ. Idempotent (khối đánh dấu `sf:mouth`, script `data-sf-lipsync`).
 */
export function applyLipsync(
  html: string,
  frameId: string,
  ls: (FrameLipsync & { src: (s: string) => string }) | null,
): string {
  let out = html
    .replace(new RegExp(`${MARK_OPEN}[\\s\\S]*?${MARK_CLOSE}`, 'g'), '')
    .replace(/\n\s*<script data-sf-lipsync>[\s\S]*?<\/script>/g, '');
  if (!ls) return out;
  const anchorRe = new RegExp(`(<[a-z][^>]*\\sdata-sf-id="${ls.anchor}"[^>]*>)`, 'i');
  if (!anchorRe.test(out)) return out;
  const imgs = STATES.map(
    (s) =>
      `<img data-sf-mouth="${s}" src="${ls.src(s)}" alt="" style="position:absolute;left:0;top:0;width:100%;height:100%;opacity:${s === 'closed' ? 1 : 0}">`,
  ).join('');
  out = out.replace(anchorRe, `$1${MARK_OPEN}${imgs}${MARK_CLOSE}`);
  const sel = (s: string) => `[data-sf-id="${ls.anchor}"] [data-sf-mouth="${s}"]`;
  const all = `[data-sf-id="${ls.anchor}"] [data-sf-mouth]`;
  const sets = ls.cues
    .map(
      (c) =>
        `tl.set(${JSON.stringify(all)}, { opacity: 0 }, ${c.t}); tl.set(${JSON.stringify(sel(c.mouth))}, { opacity: 1 }, ${c.t});`,
    )
    .join('\n      ');
  const script = `<script data-sf-lipsync>
    (function () {
      const tl = (window.__timelines || {})[${JSON.stringify(frameId)}];
      if (!tl) return;
      ${sets}
    })();
    </script>`;
  const i = out.lastIndexOf('</script>');
  return i < 0
    ? out
    : `${out.slice(0, i + 9)}
    ${script}${out.slice(i + 9)}`;
}
