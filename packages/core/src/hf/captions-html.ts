import type { CaptionGroups, CaptionOverrides } from '../contracts/types.js';
import { GSAP_SRC } from './index-html.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Áp `caption-overrides.json` (text/mốc theo group; tách/gộp ở 026) lên `caption_groups.json`. */
export function applyCaptionOverrides(
  g: CaptionGroups,
  o?: CaptionOverrides,
): CaptionGroups['groups'] {
  return g.groups.map((x) => ({ ...x, ...(o?.groups?.[x.id] ?? {}) }));
}

export interface CaptionWordTiming {
  /** Mốc tuyệt đối trên video (ms) của từng từ trong group, cùng thứ tự với chữ. */
  words: { text: string; start_ms: number }[];
}

/**
 * `compositions/captions.html` — sub-composition caption (FN-common mục 3): mỗi group một clip ở dải
 * dưới (vùng giữ chỗ ~17% của frame worker), từ đang đọc được tô màu nhấn.
 */
export function buildCaptionsHtml(i: {
  width: number;
  height: number;
  groups: (CaptionGroups['groups'][number] & {
    abs_start_ms: number;
    abs_end_ms: number;
    words: { text: string; start_ms: number }[];
  })[];
  style?: string;
}): string {
  const fontPx = Math.round(i.height * 0.045);
  const bottom = Math.round(i.height * 0.06);
  const clips = i.groups.map((g, n) => {
    const words = g.words
      .map((w, k) => `<span class="w" id="cap-${g.id}-${k}">${esc(w.text)}</span>`)
      .join(' ');
    return `    <div class="clip cap" id="cap-${g.id}" data-sf-caption="${g.id}" data-start="${r3(g.abs_start_ms / 1000)}" data-duration="${r3(Math.max(1, g.abs_end_ms - g.abs_start_ms) / 1000)}" data-track-index="${n % 2}"><div class="pill">${words}</div></div>`;
  });
  const tweens = i.groups.flatMap((g) =>
    g.words.map(
      (w, k) => `    tl.set("#cap-${g.id}-${k}", { color: "#FFD54A" }, ${r3(w.start_ms / 1000)});`,
    ),
  );
  return `<template>
  <div id="root" data-composition-id="captions" data-width="${i.width}" data-height="${i.height}">
    <script src="${GSAP_SRC}"></script>
    <style>
      #root { position: relative; width: ${i.width}px; height: ${i.height}px; }
      .cap { position: absolute; left: 0; right: 0; bottom: ${bottom}px; display: flex; justify-content: center; }
      .pill { max-width: ${Math.round(i.width * 0.8)}px; padding: ${Math.round(fontPx * 0.3)}px ${Math.round(fontPx * 0.6)}px; border-radius: ${Math.round(fontPx * 0.4)}px; background: rgba(0, 0, 0, 0.62); color: #ffffff; font-family: sans-serif; font-weight: 700; font-size: ${fontPx}px; line-height: 1.25; text-align: center; }
      .w { color: #ffffff; }
    </style>
${clips.join('\n')}
    <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
${tweens.join('\n')}
    window.__timelines["captions"] = tl;
    </script>
  </div>
</template>
`;
}
