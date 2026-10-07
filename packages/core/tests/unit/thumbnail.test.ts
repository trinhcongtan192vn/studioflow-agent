// 063 — bước thumbnail: câu móc, trang ghép chữ, kiểm JPEG 16:9 ≤ 2 MB, bỏ qua video dọc.
import { describe, expect, it } from 'vitest';
import {
  accentColor,
  fallbackHeadline,
  headlineHtml,
  jpegSize,
  parseThumbnailIdea,
  thumbnailCheck,
  thumbnailHtml,
} from '../../src/thumbnail/thumbnail.js';
import { tempDir } from '../domain-helpers.js';
import { WriteStore } from '../../src/store/writer.js';

/** JPEG tối thiểu: SOI + APP0 giả + SOF0 (w×h) + EOI. */
const fakeJpeg = (w: number, h: number) => {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
};

describe('thumbnail helpers', () => {
  it('reads JPEG size from the SOF marker', () => {
    expect(jpegSize(fakeJpeg(1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(jpegSize(Buffer.from('not a jpeg'))).toBeUndefined();
  });

  it('headline: last word highlighted, escaped; fallback trims the title to ≤ 5 words', () => {
    expect(headlineHtml('Mặt Trời biến mất')).toBe('Mặt Trời biến <b>mất</b>');
    expect(headlineHtml('<x>')).toBe('&lt;x&gt;');
    expect(fallbackHeadline('Nhật thực và nguyệt thực: vì sao không xảy ra mỗi tháng?')).toBe(
      'Nhật thực và nguyệt thực',
    );
  });

  it('parses the LLM idea (JSON in surrounding text) or rejects incomplete output', () => {
    expect(
      parseThumbnailIdea(
        'Đây: {"headline": "Mặt Trời BIẾN MẤT", "image_prompt": "solar eclipse, black disk"} xong',
      ),
    ).toEqual({ headline: 'Mặt Trời BIẾN MẤT', image_prompt: 'solar eclipse, black disk' });
    expect(parseThumbnailIdea('{"headline": ""}')).toBeUndefined();
    expect(parseThumbnailIdea('không có json')).toBeUndefined();
  });

  it('page uses the local GSAP, the background and channel colours', () => {
    const html = thumbnailHtml({
      headline: 'Bí ẩn bầu trời',
      bg: 'public/bg.png',
      font: 'Be Vietnam Pro',
      accent: '#ff3b30',
      ground: '#101418',
    });
    expect(html).toContain('public/vendor/gsap-');
    expect(html).toContain('src="public/bg.png"');
    expect(html).toContain('background:#ff3b30');
    expect(html).toContain('Bí ẩn bầu <b>trời</b>');
    expect(accentColor('accent: #FF3B30')).toBe('#FF3B30');
    // không có ảnh nền → không có thẻ <img> (tránh biểu tượng ảnh hỏng)
    expect(
      thumbnailHtml({ headline: 'A b', bg: '', font: 'x', accent: '#fff', ground: '#000' }),
    ).not.toContain('<img');
  });

  it('check: JPEG 16:9 ≤ 2 MB; vertical videos pass without a thumbnail', () => {
    const t = tempDir('thumb-');
    try {
      const store = new WriteStore(t.dir);
      const abs = (rel: string) => store.abs(rel);
      expect(thumbnailCheck(abs, 'vd_a', true)).toEqual({ pass: true });
      expect(thumbnailCheck(abs, 'vd_a', false)).toMatchObject({
        pass: false,
        detail: 'thumbnail.jpg missing',
      });
      store.write('videos/vd_a/thumbnail.jpg', fakeJpeg(1280, 720), {
        by: 'test',
        validate: false,
      });
      expect(thumbnailCheck(abs, 'vd_a', false)).toEqual({ pass: true });
      store.write('videos/vd_a/thumbnail.jpg', fakeJpeg(1080, 1920), {
        by: 'test',
        validate: false,
      });
      expect(thumbnailCheck(abs, 'vd_a', false).detail).toMatch(/16:9/);
    } finally {
      t.cleanup();
    }
  });
});
