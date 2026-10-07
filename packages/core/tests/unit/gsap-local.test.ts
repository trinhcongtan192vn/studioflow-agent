// 059 — GSAP nạp từ bản cục bộ trong project (không phụ thuộc CDN khi check/render): đổi URL CDN trong
// HTML thành `public/vendor/gsap-<ver>.min.js`, chép file vào video qua module ghi.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureGsap, GSAP_LOCAL, GSAP_VERSION, localizeGsap } from '../../src/hf/gsap.js';
import { fixVideoFrames } from '../../src/hf/clip-fix.js';
import { workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture | undefined;
afterEach(() => {
  fx?.cleanup();
  fx = undefined;
});

describe('localizeGsap', () => {
  it('rewrites jsDelivr / cdnjs / unpkg GSAP URLs to the local copy', () => {
    expect(GSAP_LOCAL).toBe(`public/vendor/gsap-${GSAP_VERSION}.min.js`);
    const html = [
      '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>',
      "<script src='https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js'></script>",
      '<script src="https://unpkg.com/gsap@3/dist/gsap.min.js"></script>',
      '<script src="https://cdn.jsdelivr.net/npm/other@1/x.js"></script>',
    ].join('\n');
    const out = localizeGsap(html);
    expect(out.match(new RegExp(GSAP_LOCAL.replace(/\./g, '\\.'), 'g'))).toHaveLength(3);
    expect(out).toContain('https://cdn.jsdelivr.net/npm/other@1/x.js');
    expect(localizeGsap('<p>không có gsap</p>')).toBe('<p>không có gsap</p>');
  });
});

describe('ensureGsap / fixVideoFrames', () => {
  it('copies the pinned GSAP into the video and localizes frames', () => {
    fx = workflowFixture();
    ensureGsap(fx.store, fx.videoId);
    const local = readFileSync(fx.store.abs(fx.v(GSAP_LOCAL)), 'utf8');
    expect(local.slice(0, 40)).toContain(`GSAP ${GSAP_VERSION}`);
    fx.store.write(
      fx.v('compositions/frames/fr_a.html'),
      '<template><div id="root"><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script></div></template>',
      { by: 'test', validate: false },
    );
    expect(fixVideoFrames(fx.store, fx.videoId)).toEqual(['fr_a']);
    expect(readFileSync(fx.store.abs(fx.v('compositions/frames/fr_a.html')), 'utf8')).toContain(
      `src="${GSAP_LOCAL}"`,
    );
    expect(fixVideoFrames(fx.store, fx.videoId)).toEqual([]); // đã sửa → không đổi nữa
  });
});
