// Ghi font-size inline đúng phần tử chữ tràn vùng an toàn; phần còn lại của file giữ nguyên.
import { describe, expect, it } from 'vitest';
import { applyFontFixes, type FontFix } from '../../src/hf/text-fit.js';

const html = `<template>
  <div id="root" data-composition-id="fr_aaaaaaaa">
    <style>.main-text { font-size: 220px; }</style>
    <div class="clip title" data-sf-id="el_title001" data-start="0">
      <div class="main-text">
        NOT INVENTED.<br>
        <span class="accent" data-sf-id="el_accent01" style="color: red; font-size: 200px">UNDERSTOOD.</span>
      </div>
      <div class="main-text">OTHER</div>
    </div>
  </div>
</template>
`;
const fix = (f: Partial<FontFix>): FontFix => ({
  frame_id: 'fr_aaaaaaaa',
  tag: 'div',
  cls: 'main-text',
  text: '',
  from_px: 220,
  font_px: 150,
  ...f,
});

describe('applyFontFixes', () => {
  it('adds font-size to an element found by class + own text under its data-sf-id ancestor', () => {
    const r = applyFontFixes(html, [fix({ anchor_sf_id: 'el_title001', text: 'NOT INVENTED.' })]);
    expect(r.applied).toHaveLength(1);
    expect(r.html).toContain(
      '<div class="main-text" style="font-size: 150px">\n        NOT INVENTED.',
    );
    expect(r.html).toContain('<div class="main-text">OTHER</div>');
    expect(r.html.replace(' style="font-size: 150px"', '')).toBe(html);
  });

  it('replaces font-size inside an existing style and keeps the other declarations', () => {
    const r = applyFontFixes(html, [
      fix({ sf_id: 'el_accent01', tag: 'span', cls: 'accent', text: 'UNDERSTOOD.', font_px: 120 }),
    ]);
    expect(r.html).toContain('style="color: red; font-size: 120px">UNDERSTOOD.');
    expect(r.html).not.toContain('font-size: 200px');
  });

  it('applies several fixes in one file; an element that cannot be found uniquely is reported', () => {
    const r = applyFontFixes(html, [
      fix({ anchor_sf_id: 'el_title001', text: 'NOT INVENTED.' }),
      fix({ sf_id: 'el_accent01', tag: 'span', cls: 'accent', text: 'UNDERSTOOD.', font_px: 120 }),
      fix({ anchor_sf_id: 'el_title001', text: '' }),
    ]);
    expect(r.applied).toHaveLength(2);
    expect(r.missed).toHaveLength(1);
    expect(r.html).toContain('font-size: 150px');
    expect(r.html).toContain('font-size: 120px');
  });
});
