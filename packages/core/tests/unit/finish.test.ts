// 027 · FR-CP-04/05 — look (nướng vào ảnh), hiệu ứng media (lúc render), overlay theo frame.
import { describe, expect, it } from 'vitest';
import {
  applyFinish,
  contentOf,
  frameImageSources,
  lookFromGrading,
  overlayBlocks,
  overlayProblems,
  parseEffect,
  stylePack,
  type Frame,
} from '../../src/index.js';

const html = `<template><div data-composition-id="fr_aaaaaaaa">
<img class="clip" data-sf-id="el_aaaaaaaa" src="public/as_11111111.png" style="left:0">
<img data-sf-id="el_bbbbbbbb" src="https://x/y.png" />
<div data-sf-id="el_cccccccc">chữ</div></div></template>`;

describe('frame finishing (027)', () => {
  it('swaps baked images in, keeps the original in data-sf-src and restores it when the look is removed', () => {
    expect(frameImageSources(html)).toEqual(['public/as_11111111.png']);
    const baked = new Map([['public/as_11111111.png', 'public/looks/as_11111111-abc.png']]);
    const a = applyFinish(html, { baked, fx: { details: { grain: 0.25 } } });
    expect(a).toContain(
      'src="public/looks/as_11111111-abc.png" style="left:0" data-sf-src="public/as_11111111.png" data-color-grading="{&quot;details&quot;:{&quot;grain&quot;:0.25}}"',
    );
    expect(a).toMatch(/src="https:\/\/x\/y.png" data-color-grading="[^"]+" \/>/);
    expect(a).toContain('<div data-sf-id="el_cccccccc">chữ</div>');
    // áp lại idempotent; bỏ look + hiệu ứng → về nguyên bản
    expect(applyFinish(a, { baked, fx: { details: { grain: 0.25 } } })).toBe(a);
    expect(frameImageSources(a)).toEqual(['public/as_11111111.png']);
    expect(applyFinish(a, {})).toBe(html);
  });

  it('parses effect ids with optional amounts', () => {
    expect(parseEffect('bloom')).toEqual({ key: 'bloom' });
    expect(parseEffect(' grain:0.4 ')).toEqual({ key: 'grain', amount: 0.4 });
  });

  it('content hash ignores effects, overlays and the frame look', () => {
    const f = {
      id: 'fr_aaaaaaaa',
      scene_id: 'sc_aaaaaaaa',
      order: 1,
      beat_ids: [],
      line_ids: [],
      intent: 'x',
      layers: [],
      effects: ['grain'],
      overlays: [{ block: 'lower-third', vars: { title: 'A' } }],
      config: { 'look.id': 'warm-archive', 'frame.min_duration_ms': 3000 },
    } as unknown as Frame;
    expect(contentOf(f)).toEqual({
      id: 'fr_aaaaaaaa',
      scene_id: 'sc_aaaaaaaa',
      order: 1,
      beat_ids: [],
      line_ids: [],
      intent: 'x',
      layers: [],
      config: { 'frame.min_duration_ms': 3000 },
    });
    const g = { ...f, config: { 'look.id': 'x' } } as unknown as Frame;
    expect('config' in contentOf(g)).toBe(false);
  });

  it('shipped style packs and overlay blocks; overlay declarations are validated', () => {
    expect(stylePack('warm-archive')?.grading).toMatchObject({ preset: 'vintage-wash' });
    expect(stylePack('neutral')?.grading).toBeUndefined();
    expect(stylePack('../etc')).toBeUndefined();
    const blocks = overlayBlocks();
    expect([...blocks.keys()].sort()).toEqual(['location-tag', 'lower-third']);
    expect(
      overlayProblems(
        {
          id: 'fr_aaaaaaaa',
          overlays: [
            { block: 'lower-third', vars: { subtitle: 'x', foo: 'y' } },
            { block: 'nope', vars: {} },
          ],
        } as never,
        blocks,
      ),
    ).toEqual([
      'frame fr_aaaaaaaa: overlay lower-third needs title',
      'frame fr_aaaaaaaa: overlay lower-third has no variable foo',
      'frame fr_aaaaaaaa: overlay block nope is not installed',
    ]);
  });

  it('maps a Studio grade back to the look with the same preset', () => {
    const ids = ['neutral', 'warm-archive', 'vintage-film'];
    expect(lookFromGrading('{"preset":"vintage-wash","intensity":0.4}', ids)).toBe('warm-archive');
    expect(lookFromGrading('{"preset":"food-pop"}', ids)).toBeUndefined();
    expect(lookFromGrading('warm-archive', ids)).toBe('warm-archive');
  });
});
