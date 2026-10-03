// 011 · US2 · FR-005, FR-006 — index.html, transition, captions.html, kiểm file frame.
import { describe, expect, it } from 'vitest';
import {
  buildCaptionsHtml,
  buildIndexHtml,
  checkFrameFile,
  framePlacements,
  groundColor,
  sfIdsOf,
  transitionSeconds,
} from '../../src/index.js';

const frames = [
  { id: 'fr_aaaaaaaa', start_ms: 0, duration_ms: 4000 },
  {
    id: 'fr_bbbbbbbb',
    start_ms: 4000,
    duration_ms: 3000,
    transition_in: { type: 'crossfade', duration_ms: 600 },
  },
  {
    id: 'fr_cccccccc',
    start_ms: 7000,
    duration_ms: 2000,
    transition_in: { type: 'cut', duration_ms: 0 },
  },
];

describe('index.html (011 US2)', () => {
  it('mounts frames in order with timing, alternating tracks, voices and captions', () => {
    const html = buildIndexHtml({
      width: 1920,
      height: 1080,
      ground: '#101418',
      frames,
      voices: [
        {
          line_id: 'ln_aaaaaaaa',
          file: 'audio/lines/ln_aaaaaaaa.wav',
          start_ms: 500,
          duration_ms: 2500,
        },
      ],
      captions: true,
      total_ms: 9000,
    });
    expect(html).toContain('data-composition-id="main" data-start="0" data-duration="9"');
    // frame đi được giữ thêm 0,6 s cho crossfade; frame đến giữ data-start
    expect(html).toMatch(
      /id="el-fr_aaaaaaaa"[^>]*data-start="0" data-duration="4.6" data-track-index="0"/,
    );
    expect(html).toMatch(
      /id="el-fr_bbbbbbbb"[^>]*data-start="4" data-duration="3" data-track-index="1"/,
    );
    expect(html).toMatch(
      /data-composition-src="compositions\/frames\/fr_cccccccc.html" data-start="7" data-duration="2" data-track-index="0"/,
    );
    expect(html).toContain(
      'src="audio/lines/ln_aaaaaaaa.wav" data-start="0.5" data-duration="2.5" data-track-index="10"',
    );
    expect(html).toContain(
      'data-composition-src="compositions/captions.html" data-start="0" data-duration="9" data-track-index="2"',
    );
    expect(html).toContain('tl.to("#el-fr_aaaaaaaa", { opacity: 0, duration: 0.6');
    expect(html).toContain('tl.fromTo("#el-fr_bbbbbbbb"');
    expect(html).not.toContain('el-fr_cccccccc", {'); // cắt thẳng: không GSAP
    expect(html).toContain('window.__timelines["main"] = tl;');
    expect(html).toContain('background: #101418');
  });

  it('transition durations come from the registry; cut/none → null', () => {
    expect(transitionSeconds({ type: 'zoom-through' })).toBe(0.4);
    expect(transitionSeconds({ type: 'push-slide LEFT', duration_ms: 500 })).toBe(0.5);
    expect(transitionSeconds({ type: 'none' })).toBeNull();
    expect(transitionSeconds(undefined)).toBeNull();
    expect(framePlacements(frames).map((p) => p.tail)).toEqual([0.6, 0, 0]);
  });

  it('push-slide picks a direction and substitutes offsets', () => {
    const html = buildIndexHtml({
      width: 1920,
      height: 1080,
      frames: [
        frames[0]!,
        { ...frames[1]!, transition_in: { type: 'push-slide RIGHT', duration_ms: 500 } },
      ],
      voices: [],
      captions: false,
      total_ms: 7000,
    });
    expect(html).toContain('x: 1920');
    expect(html).toContain('x: -1920');
    expect(html).not.toContain('captions.html');
  });
});

describe('captions.html (011 US2)', () => {
  it('one clip per group in a template, word highlight tweens', () => {
    const html = buildCaptionsHtml({
      width: 1920,
      height: 1080,
      groups: [
        {
          id: 'cg_aaaaaaaa',
          line_id: 'ln_aaaaaaaa',
          word_range: [0, 1],
          text: 'Năm 1428,',
          start_ms: 0,
          end_ms: 900,
          speaker: 'narrator',
          abs_start_ms: 500,
          abs_end_ms: 1400,
          words: [
            { text: 'Năm', start_ms: 500 },
            { text: '1428,', start_ms: 900 },
          ],
        },
      ] as never,
    });
    expect(html.trim().startsWith('<template>')).toBe(true);
    expect(html).toContain('data-composition-id="captions"');
    expect(html).toContain('data-start="0.5" data-duration="0.9"');
    expect(html).toContain('tl.set("#cap-cg_aaaaaaaa-1", { color: "#FFD54A" }, 0.9);');
    expect(html).toContain('window.__timelines["captions"] = tl;');
  });
});

describe('frame file checks (011 FR-004, FR-006)', () => {
  const good = `<template>
  <div id="root" data-composition-id="fr_aaaaaaaa" data-width="1920" data-height="1080">
    <div class="clip" data-sf-id="el_t5w8n3ja" data-start="0" data-duration="4" data-track-index="0"></div>
    <h1 class="clip" data-sf-id="el_q2k7m4zp" data-start="0" data-duration="4" data-track-index="1">1428</h1>
    <script>window.__timelines = window.__timelines || {}; const tl = gsap.timeline({ paused: true }); window.__timelines["fr_aaaaaaaa"] = tl;</script>
  </div>
</template>`;
  it('accepts a valid frame', () => {
    expect(checkFrameFile(good, 'fr_aaaaaaaa', ['el_t5w8n3ja', 'el_q2k7m4zp'])).toEqual([]);
    expect([...sfIdsOf(good)]).toEqual(['el_t5w8n3ja', 'el_q2k7m4zp']);
  });
  it('reports missing ids, wrapper, timeline, bad extra ids', () => {
    const codes = (h: string) =>
      checkFrameFile(h, 'fr_aaaaaaaa', ['el_t5w8n3ja', 'el_q2k7m4zp', 'el_zzzzzzzz']).map(
        (p) => p.code,
      );
    expect(codes(good)).toEqual(['missing_sf_id']);
    expect(codes(`<!doctype html>${good}`)).toContain('missing_template_wrapper');
    expect(codes(good.replace('window.__timelines["fr_aaaaaaaa"] = tl;', ''))).toContain(
      'timeline_not_registered',
    );
    expect(codes(good.replace('el_q2k7m4zp', 'title'))).toContain('bad_sf_id');
  });
  it('reads the canvas ground from frame.md', () => {
    expect(groundColor('## Màu\n- canvas: #101418\n- accent: #e8b04a')).toBe('#101418');
    expect(groundColor(undefined)).toBeUndefined();
  });
});
