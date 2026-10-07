import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { WriteStore } from '../store/writer.js';

/**
 * 059: GSAP nạp từ bản cục bộ trong project video thay vì CDN — `hyperframes check`/render và bake look
 * không còn hỏng khi mạng chập chờn ("Navigation timeout", "gsap is not defined"). Phiên bản ghim cùng
 * bản CDN cũ (3.14.2, gói npm `gsap`, giấy phép "Standard no charge").
 */
export const GSAP_VERSION = '3.14.2';
/** Đường dẫn tương đối gốc project (index.html và sub-composition đều phân giải theo gốc). */
export const GSAP_LOCAL = `public/vendor/gsap-${GSAP_VERSION}.min.js`;

const CDN =
  /https?:\/\/(?:cdn\.jsdelivr\.net\/npm\/gsap@[\w.^~-]+\/dist\/gsap\.min\.js|cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\/[\w.-]+\/gsap\.min\.js|unpkg\.com\/gsap@[\w.^~-]+\/dist\/gsap\.min\.js)/g;

/** Đổi mọi URL CDN của GSAP trong HTML thành bản cục bộ. */
export function localizeGsap(html: string): string {
  return html.replace(CDN, GSAP_LOCAL);
}

let source: Buffer | undefined;
/** Nội dung `gsap.min.js` của gói đã cài (ghim trong package.json của core). */
export function gsapSource(): Buffer {
  source ??= readFileSync(createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js'));
  return source;
}

/** Chép GSAP vào `videos/<vd>/public/vendor/` (qua module ghi) nếu chưa có hoặc khác bản ghim. */
export function ensureGsap(store: WriteStore, videoId: string): void {
  const rel = `videos/${videoId}/${GSAP_LOCAL}`;
  const src = gsapSource();
  const abs = store.abs(rel);
  if (existsSync(abs) && statSync(abs).size === src.length) return;
  store.write(rel, src, { by: 'hf.adapter', validate: false });
}
