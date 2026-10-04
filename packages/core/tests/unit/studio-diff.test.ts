// 025 · FR-ST-02/03 — lọc diff Studio theo danh sách cho phép (D9 3.3, 3.4 b).
import { describe, expect, it } from 'vitest';
import { applyDelta, diffHtml, stripStudioMarks } from '../../src/index.js';

const frame = (
  o: { left?: string; dur?: string; text?: string; extra?: string; tl?: string } = {},
) =>
  `<template><div data-composition-id="fr_aaaaaaaa">` +
  `<div data-sf-id="el_bbbbbbbb" data-start="0" data-duration="${o.dur ?? '4'}" style="left: ${o.left ?? '10px'}; top: 20px; color: red">${o.text ?? 'Năm 1428'}</div>` +
  (o.extra ?? '') +
  `<script>window.__timelines = window.__timelines || {}; const tl = gsap.timeline({ paused: true }); ${o.tl ?? 'tl.to("[data-sf-id=el_bbbbbbbb]", { x: 100, duration: 1.5 }, 0.5);'} window.__timelines["fr_aaaaaaaa"] = tl;</script>` +
  `</div></template>`;

const F = 'compositions/frames/fr_aaaaaaaa.html';

describe('studio diff (025)', () => {
  it('position, timing and keyframe values are allowed', () => {
    const c = diffHtml(
      frame(),
      frame({
        left: '120px',
        dur: '6',
        tl: 'tl.to("[data-sf-id=el_bbbbbbbb]", { x: 240, duration: 2 }, 0.5);',
      }),
      F,
    );
    expect(c.every((x) => x.allowed)).toBe(true);
    expect(c.map((x) => x.attr).sort()).toEqual(['data-duration', 'script', 'style.left']);
    expect(c.find((x) => x.attr === 'style.left')).toMatchObject({
      element_id: 'el_bbbbbbbb',
      before: '10px',
      after: '120px',
    });
  });

  it('text, colour, added elements and script structure are rejected with a reason', () => {
    const text = diffHtml(frame(), frame({ text: 'Năm 1429' }), F);
    expect(text).toEqual([
      expect.objectContaining({ allowed: false, attr: 'text', element_id: 'el_bbbbbbbb' }),
    ]);
    const color = diffHtml(frame(), frame().replace('color: red', 'color: blue'), F);
    expect(color[0]).toMatchObject({ allowed: false, attr: 'style.color' });
    const added = diffHtml(frame(), frame({ extra: '<div data-sf-id="el_cccccccc">x</div>' }), F);
    expect(
      added.some((x) => !x.allowed && x.attr === 'element' && x.element_id === 'el_cccccccc'),
    ).toBe(true);
    const code = diffHtml(
      frame(),
      frame({ tl: 'tl.to("[data-sf-id=el_bbbbbbbb]", { x: 100, rotation: 90 }, 0.5);' }),
      F,
    );
    expect(code[0]).toMatchObject({ allowed: false, attr: 'script' });
    expect(code[0]!.reason).toMatch(/script/i);
  });

  it('formatting and Studio data-hf-* marks are not changes; stripStudioMarks removes the marks', () => {
    expect(diffHtml(frame(), frame().replace('<template>', '<template>\n  '), F)).toEqual([]);
    const marked = frame().replace('data-start="0"', 'data-start="0" data-hf-id="x1"');
    expect(diffHtml(frame(), marked, F)).toEqual([]);
    expect(stripStudioMarks(marked)).toBe(frame());
  });

  it('applyDelta re-applies style/attribute changes by data-sf-id and reports the rest', () => {
    const r = applyDelta(frame({ left: '5px' }), [
      { element_id: 'el_bbbbbbbb', attr: 'style.left', before: '10px', after: '120px' },
      { element_id: 'el_bbbbbbbb', attr: 'data-duration', before: '4', after: '6' },
      { element_id: 'el_zzzzzzzz', attr: 'style.top', before: '0', after: '1px' },
      { element_id: 'el_bbbbbbbb', attr: 'script', before: '100', after: '240' },
    ]);
    expect(r.html).toContain('left: 120px');
    expect(r.html).toContain('data-duration="6"');
    expect(r.unapplied.map((c) => c.element_id + ':' + c.attr)).toEqual([
      'el_zzzzzzzz:style.top',
      'el_bbbbbbbb:script',
    ]);
  });
});
