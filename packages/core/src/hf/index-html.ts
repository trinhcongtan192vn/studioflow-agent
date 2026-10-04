import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EXTENSIONS_DIR } from '../agent/options.js';

/** Bản GSAP mà HyperFrames dùng trong mẫu index (assemble-index.mjs v0.8.115). */
export const GSAP_SRC = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';

interface TransitionRecord {
  name: string;
  default_duration_s: number;
  directions: string[];
  default_direction?: string;
  gsap_template?: string[];
  gsap_template_horizontal?: string[];
  gsap_template_vertical?: string[];
}
interface Registry {
  transitions: TransitionRecord[];
  default_calm?: string;
  max_duration_s?: number;
}

let registry: Registry | undefined;
/** Registry transition vendored từ HyperFrames (011 R1, R3). */
export function transitionRegistry(): Registry {
  registry ??= JSON.parse(
    readFileSync(path.join(EXTENSIONS_DIR, 'studioflow-core', 'hf', 'transitions.json'), 'utf8'),
  ) as Registry;
  return registry;
}

const NO_TRANSITION = new Set(['cut', 'none', '']);

/** Thời lượng transition vào (giây) theo registry; `null` = cắt thẳng. */
export function transitionSeconds(
  t: { type: string; duration_ms?: number } | undefined,
): number | null {
  if (!t || NO_TRANSITION.has(t.type.trim().toLowerCase())) return null;
  const reg = transitionRegistry();
  const rec =
    reg.transitions.find((x) => x.name === t.type.split(/\s+/)[0]!.toLowerCase()) ??
    reg.transitions.find((x) => x.name === reg.default_calm) ??
    reg.transitions[0]!;
  const s = t.duration_ms ? t.duration_ms / 1000 : rec.default_duration_s;
  return Math.min(s, reg.max_duration_s ?? 2);
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function gsapLines(
  t: { type: string },
  from: string,
  to: string,
  dur: number,
  at: number,
  w: number,
  h: number,
): string[] {
  const reg = transitionRegistry();
  const [name, dirRaw] = t.type.trim().split(/\s+/);
  const rec =
    reg.transitions.find((x) => x.name === name!.toLowerCase()) ??
    reg.transitions.find((x) => x.name === reg.default_calm) ??
    reg.transitions[0]!;
  const subs: Record<string, string> = {
    __OLD__: `"#el-${from}"`,
    __NEW__: `"#el-${to}"`,
    __T__: String(r3(at)),
    __DUR__: String(r3(dur)),
  };
  let tpl = rec.gsap_template ?? [];
  if (rec.directions.length) {
    const dir = (dirRaw ?? rec.default_direction ?? rec.directions[0]!).toUpperCase();
    const vertical = dir === 'UP' || dir === 'DOWN';
    tpl = (vertical ? rec.gsap_template_vertical : rec.gsap_template_horizontal) ?? [];
    const d = vertical ? (dir === 'UP' ? -h : h) : dir === 'LEFT' ? -w : w;
    subs[vertical ? '__DY__' : '__DX__'] = String(d);
    subs[vertical ? '__DYIN__' : '__DXIN__'] = String(-d);
  }
  return [
    ...tpl.map((l) => Object.entries(subs).reduce((s, [k, v]) => s.split(k).join(v), l)),
    `tl.addLabel("sf:transition:${from}:${to}:${rec.name}", ${r3(at)});`,
  ];
}

export interface IndexFrame {
  id: string;
  start_ms: number;
  duration_ms: number;
  transition_in?: { type: string; duration_ms: number };
}

/**
 * Thời lượng vỏ frame trong index (011 R3): frame đi được giữ thêm `dur` của transition vào của frame
 * sau; frame đến giữ `data-start`. Frame packet dùng cùng giá trị để frame tự kéo dài nội dung.
 */
export function framePlacements(
  frames: IndexFrame[],
): { id: string; start: number; duration: number; tail: number }[] {
  return frames.map((f, i) => {
    const next = frames[i + 1];
    const tail = next ? (transitionSeconds(next.transition_in) ?? 0) : 0;
    return {
      id: f.id,
      start: r3(f.start_ms / 1000),
      duration: r3(f.duration_ms / 1000 + tail),
      tail,
    };
  });
}

export interface IndexInput {
  width: number;
  height: number;
  ground?: string;
  frames: IndexFrame[];
  voices: { line_id: string; file: string; start_ms: number; duration_ms: number }[];
  captions: boolean;
  /** Overlay (027): sub-composition đặt trên nội dung, dưới caption (FN-common mục 7). */
  overlays?: { id: string; file: string; start_ms: number; duration_ms: number; block: string }[];
  total_ms: number;
  /** Bed nhạc đã trộn (012): thuộc tính D8 mục 3. */
  music?: {
    file: string;
    track_ids: string[];
    volume_db: number;
    duck_db: number;
    fade_ms: number;
  };
}

/** `index.html` theo quy ước HyperFrames (assemble-index.mjs + transitions.mjs v0.8.115, 011 R1). */
export function buildIndexHtml(i: IndexInput): string {
  const total = r3(i.total_ms / 1000);
  const places = framePlacements(i.frames);
  const body: string[] = [];
  places.forEach((p, n) => {
    body.push(
      `      <div id="el-${p.id}" class="scene" data-sf-frame="${p.id}" data-composition-id="${p.id}" data-composition-src="compositions/frames/${p.id}.html" data-start="${p.start}" data-duration="${p.duration}" data-track-index="${n % 2}"></div>`,
    );
  });
  // thứ tự tầng (FN-common 7): frame (0, 1) → overlay (2) → caption (3)
  for (const o of i.overlays ?? []) {
    body.push(
      `      <div id="el-${o.id}" class="scene" data-sf-overlay="${o.block}" data-composition-id="${o.id}" data-composition-src="${o.file}" data-start="${r3(o.start_ms / 1000)}" data-duration="${r3(o.duration_ms / 1000)}" data-track-index="2"></div>`,
    );
  }
  if (i.captions) {
    body.push(
      `      <div id="el-captions" class="scene" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${total}" data-track-index="3"></div>`,
    );
  }
  for (const v of i.voices) {
    body.push(
      `      <audio id="el-${v.line_id}-voice" data-sf-line="${v.line_id}" src="${v.file}" data-start="${r3(v.start_ms / 1000)}" data-duration="${r3(v.duration_ms / 1000)}" data-track-index="10" data-volume="1"></audio>`,
    );
  }
  if (i.music) {
    const m = i.music;
    body.push(
      `      <audio id="el-music" data-sf-track="${m.track_ids.join(',')}" src="${m.file}" data-start="0" data-duration="${total}" data-track-index="11" data-volume="1" data-volume-db="${m.volume_db}" data-fade-in-ms="${m.fade_ms}" data-fade-out-ms="${m.fade_ms}" data-duck-db="${m.duck_db}"></audio>`,
    );
  }
  const gsap: string[] = [];
  i.frames.forEach((f, n) => {
    if (n === 0) return;
    const dur = transitionSeconds(f.transition_in);
    if (dur === null) return;
    gsap.push(
      ...gsapLines(
        f.transition_in!,
        i.frames[n - 1]!.id,
        f.id,
        dur,
        f.start_ms / 1000,
        i.width,
        i.height,
      ),
    );
  });
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${i.width}, height=${i.height}" />
    <script src="${GSAP_SRC}"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${i.width}px; height: ${i.height}px; overflow: hidden; background: #000; }
      #root { position: relative; width: ${i.width}px; height: ${i.height}px; overflow: hidden;${i.ground ? ` background: ${i.ground};` : ''} }
      .scene { position: absolute; inset: 0; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${i.width}" data-height="${i.height}">
${body.join('\n')}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${gsap.map((l) => `      ${l}`).join('\n')}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}
