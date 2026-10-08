// 091 — chú thích TikTok: tiêu đề + hashtag từ thẻ, không quá 150 ký tự, không cắt giữa hashtag.
import { describe, expect, it } from 'vitest';
import { tiktokCaption } from '../../src/publish/tiktok.js';

describe('tiktokCaption (091)', () => {
  it('appends tags as hashtags without spaces', () => {
    expect(tiktokCaption('Năm 1428', ['lịch sử', 'Lê Lợi', '#đã có'])).toBe(
      'Năm 1428 #lịchsử #LêLợi #đãcó',
    );
  });
  it('drops whole hashtags that do not fit and caps the title', () => {
    const title = 'a'.repeat(140);
    expect(tiktokCaption(title, ['ngắn', 'dài quá mức cho phép'])).toBe(`${title} #ngắn`);
    expect(tiktokCaption('b'.repeat(200), ['x'])).toBe('b'.repeat(150));
    expect(tiktokCaption('Tiêu đề', [' ', ''])).toBe('Tiêu đề');
  });
});
