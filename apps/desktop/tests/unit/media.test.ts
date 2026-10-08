// 089 — URL `sf-media://f/…` và đoạn Range có giới hạn.
import { describe, expect, it } from 'vitest';
import { MEDIA_CHUNK, mediaSlice } from '../../src/main/media-range';
import { mediaUrl } from '../../src/renderer/media-url';

describe('media (089)', () => {
  it('builds a standard-scheme URL that round-trips Vietnamese, spaces and #', () => {
    const abs = 'E:\\0. Làm Youtuber\\Kênh #1\\videos\\vd_a\\renders\\rd_b\\video.mp4';
    const u = mediaUrl(abs);
    expect(u.startsWith('sf-media://f/E%3A/0.%20L')).toBe(true);
    expect(decodeURIComponent(new URL(u).pathname).replace(/^\/+/, '')).toBe(
      abs.replace(/\\/g, '/'),
    );
  });

  it('caps open-ended ranges and keeps explicit ones', () => {
    const size = 10 * MEDIA_CHUNK;
    expect(mediaSlice(null, size)).toEqual({ status: 200, start: 0, end: size - 1 });
    expect(mediaSlice('bytes=0-', size)).toEqual({ status: 206, start: 0, end: MEDIA_CHUNK - 1 });
    expect(mediaSlice('bytes=393216-', size)).toEqual({
      status: 206,
      start: 393216,
      end: 393216 + MEDIA_CHUNK - 1,
    });
    expect(mediaSlice('bytes=100-199', size)).toEqual({ status: 206, start: 100, end: 199 });
    expect(mediaSlice(`bytes=${size - 10}-`, size)).toEqual({
      status: 206,
      start: size - 10,
      end: size - 1,
    });
    expect(mediaSlice('bytes=-500', size)).toEqual({
      status: 206,
      start: size - 500,
      end: size - 1,
    });
    expect(mediaSlice(`bytes=${size}-`, size)).toEqual({ status: 416 });
  });
});
