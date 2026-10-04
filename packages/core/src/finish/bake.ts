import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { imageInfo } from '../assets/image-info.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { SfError } from '../errors.js';
import { runHf } from '../hf/cli.js';
import { GSAP_SRC } from '../hf/index-html.js';
import { ffmpegPath } from '../models/install.js';
import { createScratchDir, writeOutsideProject } from '../store/scratch.js';
import type { WriteStore } from '../store/writer.js';

/** Ảnh đã grade theo look (027 research R2): `public/looks/<tên>-<hash>.png` (dẫn xuất, cache theo ảnh+look). */
export function bakedRel(src: string, grading: Record<string, unknown>, srcHash: string): string {
  const base = path.posix.basename(src).replace(/\.[^.]+$/, '');
  return `public/looks/${base}-${sha256(`${srcHash}\n${canonicalJson(grading)}`).slice(0, 12)}.png`;
}

const FPS = 10;

function ffmpeg(appDataDir: string | undefined, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(appDataDir ?? ''), ['-hide_banner', '-loglevel', 'error', ...args], {
      windowsHide: true,
    });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new SfError('E_PROVIDER_FAILED', `ffmpeg crop failed: ${err.slice(-300)}`)),
    );
  });
}

export interface BakeItem {
  /** Tương đối video, ví dụ `public/as_x.png`. */
  src: string;
  grading: Record<string, unknown>;
}

/**
 * Nướng look vào ảnh (FR-CP-04, 027): mọi cặp (ảnh, grading) còn thiếu render chung một lần bằng
 * HyperFrames (`--format png-sequence`, mỗi ảnh một khung ở góc trái trên, nền trong suốt) rồi cắt
 * về kích thước gốc. Trả map `src|hash grading` → đường dẫn ảnh đã grade (tương đối video).
 */
export async function bakeLooks(
  store: WriteStore,
  videoId: string,
  items: BakeItem[],
  opts: { appDataDir?: string; signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  const v = `videos/${videoId}`;
  const out = new Map<string, string>();
  const todo: (BakeItem & { rel: string; w: number; h: number; buf: Buffer })[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const abs = store.abs(`${v}/${it.src}`);
    if (!existsSync(abs)) continue;
    const buf = readFileSync(abs);
    const info = imageInfo(buf);
    if (!info || info.kind !== 'image') continue; // SVG: không grade
    const rel = bakedRel(it.src, it.grading, sha256(buf));
    out.set(bakeKey(it), rel);
    if (seen.has(rel) || existsSync(store.abs(`${v}/${rel}`))) continue;
    seen.add(rel);
    todo.push({ ...it, rel, w: info.width, h: info.height, buf });
  }
  if (!todo.length) return out;
  const W = Math.max(...todo.map((t) => t.w));
  const H = Math.max(...todo.map((t) => t.h));
  const s = createScratchDir('sf-bake-');
  try {
    const dur = 1 / FPS;
    const imgs = todo.map((t, i) => {
      const f = `public/i${i}${path.extname(t.src) || '.png'}`;
      writeOutsideProject(path.join(s.dir, f), t.buf);
      const g = JSON.stringify(t.grading).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<img id="i${i}" class="clip" data-start="${(i * dur).toFixed(3)}" data-duration="${dur.toFixed(3)}" data-track-index="0" src="${f}" data-color-grading="${g}" style="position:absolute;left:0;top:0;width:${t.w}px;height:${t.h}px">`;
    });
    const total = (todo.length * dur).toFixed(3);
    writeOutsideProject(
      path.join(s.dir, 'index.html'),
      `<!doctype html><html><head><meta charset="UTF-8" /><script src="${GSAP_SRC}"></script><style>html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:transparent}#root{position:relative;width:${W}px;height:${H}px}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}">${imgs.join('')}</div><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.set("#root",{opacity:1},${total});window.__timelines["main"]=tl;</script></body></html>`,
    );
    const seq = path.join(s.dir, 'seq');
    const r = await runHf(
      ['render', s.dir, '--format', 'png-sequence', '-o', seq, '--fps', String(FPS), '--quiet'],
      { cwd: s.dir, timeoutMs: 600_000, ...(opts.signal ? { signal: opts.signal } : {}) },
    );
    const frames = existsSync(seq)
      ? readdirSync(seq)
          .filter((f) => f.endsWith('.png'))
          .sort()
      : [];
    if (frames.length < todo.length)
      throw new SfError(
        'E_PROVIDER_FAILED',
        `baking looks: hyperframes render wrote ${frames.length}/${todo.length} frames: ${(r.stderr || r.stdout).slice(-300)}`,
      );
    for (const [i, t] of todo.entries()) {
      const cropped = path.join(s.dir, `c${i}.png`);
      await ffmpeg(opts.appDataDir, [
        '-y',
        '-i',
        path.join(seq, frames[i]!),
        '-vf',
        `crop=${t.w}:${t.h}:0:0`,
        cropped,
      ]);
      store.importFile(cropped, `${v}/${t.rel}`, { by: 'graph.build' });
    }
  } finally {
    s.cleanup();
  }
  return out;
}

export const bakeKey = (it: BakeItem) => `${it.src}|${sha256(canonicalJson(it.grading))}`;
