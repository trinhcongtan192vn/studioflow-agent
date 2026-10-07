// 058 — HyperFrames cấm animate autoAlpha trên phần tử `clip` (gsap_animates_clip_element): app tự đổi
// autoAlpha → opacity cho tween nhắm vào clip (id hoặc class), giữ nguyên tween của phần tử thường.
import { describe, expect, it } from 'vitest';
import { clipSelectors, fixClipAutoAlpha } from '../../src/hf/clip-fix.js';

const frame = (script: string) => `<template><div id="root" data-composition-id="fr_xklyxpsa">
<div id="fr_xklyxpsa-bg" class="clip" data-start="0" data-duration="6" data-track-index="0"></div>
<div id="fr_xklyxpsa-title" class="clip fr_xklyxpsa-title" data-start="0" data-duration="6" data-track-index="1">Tin nóng (2026)</div>
<div class="clip fr_xklyxpsa-hot-label" data-start="1" data-duration="5" data-track-index="2">HOT</div>
<span id="fr_xklyxpsa-plain" class="badge">thường</span>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
${script}
window.__timelines["fr_xklyxpsa"] = tl;
</script></div></template>`;

describe('clipSelectors', () => {
  it('collects ids and non-"clip" classes of clip elements', () => {
    expect([...clipSelectors(frame(''))].sort()).toEqual(
      [
        '#fr_xklyxpsa-bg',
        '#fr_xklyxpsa-title',
        '.fr_xklyxpsa-hot-label',
        '.fr_xklyxpsa-title',
      ].sort(),
    );
  });
});

describe('fixClipAutoAlpha', () => {
  it('rewrites autoAlpha to opacity only in tweens that target clip elements', () => {
    const src =
      frame(`tl.fromTo("#fr_xklyxpsa-title", { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0.2);
tl.to('.fr_xklyxpsa-hot-label', { autoAlpha: 1, scale: Math.min(1.1, 2) }, 1.0);
gsap.set("#fr_xklyxpsa-bg", {autoAlpha:1});
tl.to("#fr_xklyxpsa-plain", { autoAlpha: 1 }, 2);
tl.to(\`#fr_xklyxpsa-title, #fr_xklyxpsa-plain\`, { autoAlpha: 0.5, text: "a (b) c" }, 3);`);
    const r = fixClipAutoAlpha(src);
    expect(r.fixed).toEqual([
      '#fr_xklyxpsa-title',
      '.fr_xklyxpsa-hot-label',
      '#fr_xklyxpsa-bg',
      '#fr_xklyxpsa-title, #fr_xklyxpsa-plain',
    ]);
    expect(r.html).toContain(
      'tl.fromTo("#fr_xklyxpsa-title", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0.2);',
    );
    expect(r.html).toContain(
      "tl.to('.fr_xklyxpsa-hot-label', { opacity: 1, scale: Math.min(1.1, 2) }, 1.0);",
    );
    expect(r.html).toContain('gsap.set("#fr_xklyxpsa-bg", {opacity:1});');
    // phần tử thường: giữ autoAlpha
    expect(r.html).toContain('tl.to("#fr_xklyxpsa-plain", { autoAlpha: 1 }, 2);');
    // danh sách selector có clip → đổi (chuỗi trong tham số giữ nguyên)
    expect(r.html).toContain('{ opacity: 0.5, text: "a (b) c" }, 3);');
    // chữ ngoài script không bị đụng
    expect(r.html).toContain('Tin nóng (2026)');
  });

  it('is a no-op (same string) when nothing needs fixing', () => {
    const src = frame('tl.fromTo("#fr_xklyxpsa-title", { opacity: 0 }, { opacity: 1 }, 0);');
    const r = fixClipAutoAlpha(src);
    expect(r).toEqual({ html: src, fixed: [] });
  });
});
