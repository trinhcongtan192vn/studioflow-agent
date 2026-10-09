// 094 · FR-ST-94-02 — proxy Studio: chế độ chỉnh cho mọi thao tác sửa file cảnh; vẫn chặn render, tải lên,
// xóa file, ghi ngoài file cảnh; xem trước chỉ đọc.
import { describe, expect, it } from 'vitest';
import { studioWriteAllowed } from '../../src/index.js';

const P = '/api/projects/p1';

describe('studioWriteAllowed (094)', () => {
  it('edit mode allows element mutations, GSAP, raw save of scene files and undo', () => {
    for (const [m, u] of [
      ['POST', `${P}/file-mutations/patch-element/compositions/frames/fr_a.html`],
      ['POST', `${P}/file-mutations/remove-element/compositions/frames/fr_a.html`],
      ['POST', `${P}/gsap-mutations/compositions/frames/fr_a.html`],
      ['PUT', `${P}/files/compositions%2Fframes%2Ffr_a.html`],
      ['PUT', `${P}/files/index.html`],
      ['POST', `${P}/history/undo`],
      ['POST', `${P}/selection`],
    ] as const)
      expect(studioWriteAllowed(m, u), `${m} ${u}`).toBe(true);
  });

  it('edit mode still blocks render, upload, background removal, file delete/duplicate and non-scene files', () => {
    for (const [m, u] of [
      ['POST', `${P}/render`],
      ['POST', `${P}/upload`],
      ['POST', `${P}/media/remove-background`],
      ['POST', `${P}/duplicate-file`],
      ['DELETE', `${P}/files/compositions%2Fframes%2Ffr_a.html`],
      ['PUT', `${P}/files/public%2Fimg.png`],
      ['PUT', `${P}/files/compositions%2F..%2F..%2Fx.html`],
      ['DELETE', P],
    ] as const)
      expect(studioWriteAllowed(m, u), `${m} ${u}`).toBe(false);
  });

  it('preview mode only allows probing and selection', () => {
    expect(studioWriteAllowed('POST', `${P}/file-mutations/probe-element/x.html`, true)).toBe(true);
    expect(studioWriteAllowed('POST', `${P}/file-mutations/patch-element/x.html`, true)).toBe(
      false,
    );
    expect(studioWriteAllowed('PUT', `${P}/files/index.html`, true)).toBe(false);
    expect(studioWriteAllowed('GET', `${P}/files/index.html`, true)).toBe(true);
  });
});
