import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { WriteStore } from '../store/writer.js';
import { localizeGsap } from './gsap.js';

/**
 * 058: HyperFrames tự quản lý hiển thị của phần tử `class="clip"`; GSAP `autoAlpha` ghi cả `visibility` nên
 * `hyperframes check` báo `gsap_animates_clip_element` và chặn render phát hành. Đổi `autoAlpha` → `opacity`
 * trong các tween (`to`/`from`/`fromTo`/`set`) có selector chuỗi trỏ vào phần tử clip — cùng hiệu ứng mờ dần,
 * không đụng visibility. Tween nhắm phần tử thường giữ nguyên.
 */

/** Selector (`#id`, `.class` khác `clip`) của mọi phần tử `class="… clip …"` trong frame. */
export function clipSelectors(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/<[a-zA-Z][\w-]*\b[^>]*>/g)) {
    const tag = m[0];
    const cls = /\bclass\s*=\s*(["'])(.*?)\1/.exec(tag)?.[2];
    if (!cls) continue;
    const names = cls.split(/\s+/).filter(Boolean);
    if (!names.includes('clip')) continue;
    const id = /\bid\s*=\s*(["'])(.*?)\1/.exec(tag)?.[2];
    if (id) out.add(`#${id}`);
    for (const n of names) if (n !== 'clip') out.add(`.${n}`);
  }
  return out;
}

/** Vị trí đóng ngoặc khớp với `(` tại `open`, bỏ qua nội dung chuỗi; -1 nếu không thấy. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < s.length && s[i] !== c; i++) if (s[i] === '\\') i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/** `autoAlpha` (khóa đối tượng) → `opacity` ngoài chuỗi. */
function swapKey(args: string): string {
  let out = '';
  for (let i = 0; i < args.length; i++) {
    const c = args[i]!;
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      for (; j < args.length && args[j] !== c; j++) if (args[j] === '\\') j++;
      out += args.slice(i, j + 1);
      i = j;
      continue;
    }
    if (
      args.startsWith('autoAlpha', i) &&
      !/[\w$]/.test(args[i - 1] ?? '') &&
      !/[\w$]/.test(args[i + 9] ?? '')
    ) {
      out += 'opacity';
      i += 8;
      continue;
    }
    out += c;
  }
  return out;
}

/** Sửa frame; `fixed` = selector của các tween đã đổi (theo thứ tự xuất hiện). */
export function fixClipAutoAlpha(html: string): { html: string; fixed: string[] } {
  const clips = clipSelectors(html);
  if (!clips.size || !html.includes('autoAlpha')) return { html, fixed: [] };
  const fixed: string[] = [];
  let out = '';
  let last = 0;
  const call = /\.(?:to|from|fromTo|set)\(\s*(["'`])([^"'`]+)\1/g;
  for (let m = call.exec(html); m; m = call.exec(html)) {
    const open = m.index + m[0].indexOf('(');
    const close = matchParen(html, open);
    if (close < 0) continue;
    const targets = m[2]!.split(',').map((x) => x.trim());
    const args = html.slice(open, close + 1);
    if (!targets.some((t) => clips.has(t)) || !/\bautoAlpha\b/.test(args)) continue;
    out += html.slice(last, open) + swapKey(args);
    last = close + 1;
    call.lastIndex = close + 1;
    fixed.push(m[2]!);
  }
  return fixed.length ? { html: out + html.slice(last), fixed } : { html, fixed: [] };
}

/** Sửa một frame: autoAlpha trên clip (058) + GSAP cục bộ thay CDN (059). */
export function sanitizeFrameHtml(html: string): string {
  return localizeGsap(fixClipAutoAlpha(html).html);
}

/**
 * Sửa mọi frame của video (`compositions/frames/*.html`) qua module ghi; trả id frame đã đổi để người gọi
 * ghi nhận lại vào build graph (`markBuilt … contentOnly`) — không để `index` cũ (bài học 046).
 */
export function fixVideoFrames(store: WriteStore, videoId: string): string[] {
  const rel = `videos/${videoId}/compositions/frames`;
  const dir = store.abs(rel);
  if (!existsSync(dir)) return [];
  const changed: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const before = readFileSync(path.join(dir, f), 'utf8');
    const after = sanitizeFrameHtml(before);
    if (after === before) continue;
    store.write(`${rel}/${f}`, after, { by: 'frame-fix', validate: false });
    changed.push(path.basename(f, '.html'));
  }
  return changed;
}
