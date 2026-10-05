// 032 · FR-WF-09 — khẩu hình mức 1: RMS mỗi video frame → closed/half/open, giữ ≥ 2 frame; chèn miệng vào frame.
import { describe, expect, it } from 'vitest';
import { applyLipsync, computeCues, mouthDir } from '../../src/index.js';

const SR = 48000;
function signal(parts: [ms: number, amp: number][]): Float32Array {
  const n = parts.reduce((s, [ms]) => s + (ms * SR) / 1000, 0);
  const out = new Float32Array(n);
  let i = 0;
  for (const [ms, amp] of parts)
    for (let k = 0; k < (ms * SR) / 1000; k++, i++)
      out[i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR);
  return out;
}

describe('lip-sync level 1 (032)', () => {
  it('maps normalized RMS per video frame to closed/half/open with hold smoothing', () => {
    // 200 ms im lặng, 300 ms to, 300 ms vừa, 200 ms im lặng (30 fps → 6, 9, 9, 6 frame)
    const cues = computeCues(
      signal([
        [200, 0],
        [300, 1],
        [300, 0.25],
        [200, 0],
      ]),
      SR,
      30,
    );
    expect(cues.map((c) => c.mouth)).toEqual(['closed', 'open', 'half', 'closed']);
    expect(cues.map((c) => c.frame)).toEqual([0, 6, 15, 24]);
    // nhấp nháy 1 frame (33 ms) không đổi miệng
    const blip = computeCues(
      signal([
        [300, 0],
        [33, 1],
        [300, 0],
      ]),
      SR,
      30,
    );
    expect(blip.map((c) => c.mouth)).toEqual(['closed']);
  });

  it('injects the mouth set into the anchor and a GSAP swap timeline, idempotently', () => {
    const html = `<template><div id="root" data-composition-id="fr_aaaaaaaa"><div class="clip" data-sf-id="el_mmmmmmmm" style="left:1px"></div><script>window.__timelines["fr_aaaaaaaa"] = tl;</script></div></template>`;
    const ls = {
      anchor: 'el_mmmmmmmm',
      set: 'flat',
      view: 'front',
      cues: [
        { t: 0, mouth: 'closed' as const },
        { t: 0.2, mouth: 'open' as const },
      ],
      src: (s: string) => `public/mouths/flat/front/${s}.svg`,
    };
    const a = applyLipsync(html, 'fr_aaaaaaaa', ls);
    expect(a).toContain(
      'data-sf-id="el_mmmmmmmm" style="left:1px"><!--sf:mouth--><img data-sf-mouth="closed" src="public/mouths/flat/front/closed.svg"',
    );
    expect(a).toContain(
      'tl.set("[data-sf-id=\\"el_mmmmmmmm\\"] [data-sf-mouth=\\"open\\"]", { opacity: 1 }, 0.2);',
    );
    expect(applyLipsync(a, 'fr_aaaaaaaa', ls)).toBe(a);
    expect(applyLipsync(a, 'fr_aaaaaaaa', null)).toBe(html);
    expect(mouthDir('flat', 'front')).toMatch(/core-mouths[\\/]mouths[\\/]flat[\\/]front$/);
    expect(mouthDir('../x', 'front')).toBeUndefined();
  });
});
