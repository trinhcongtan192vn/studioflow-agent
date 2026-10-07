// 049 · FR-AP-04 — parser RSS nhỏ cho Google Trends / Google News (không thêm phụ thuộc).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeXml, parseRss, parseTraffic } from '../../src/research/rss.js';
import { coreDir } from '../helpers.js';

const fx = (n: string) => readFileSync(path.join(coreDir, 'tests/fixtures/research', n), 'utf8');

describe('parseRss', () => {
  it('reads Google Trends items with traffic and attached news', () => {
    const items = parseRss(fx('trends-vn.xml'));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'giá vàng hôm nay',
      traffic: 500_000,
      published_at: '2026-10-07T01:00:00.000Z',
      news: [
        {
          title: 'Giá vàng tăng mạnh & lập đỉnh mới',
          url: 'https://example.vn/gia-vang',
          source: 'Báo Mẫu',
        },
      ],
    });
    expect(items[1]!.traffic).toBe(20_000);
    expect(items[1]!.news.map((n) => n.title)).toEqual([
      'Lễ giỗ Đức Thánh Trần tại đền Kiếp Bạc',
      'Hàng vạn người về Kiếp Bạc',
    ]);
  });

  it('reads Google News items, dropping the " - source" title suffix', () => {
    const items = parseRss(fx('news-lich-su.xml'));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Phát hiện bảo vật thời Lý ở Hoàng thành Thăng Long',
      link: 'https://news.google.com/rss/articles/CBMiAAA?oc=5',
      source: 'Báo Mẫu',
      published_at: '2026-10-05T08:00:00.000Z',
      news: [],
    });
    expect(items[1]!.title).toBe('Sách giáo khoa lịch sử mới – có gì khác?');
  });

  it('is lenient: no items / garbage → empty list; missing title skipped', () => {
    expect(parseRss('')).toEqual([]);
    expect(parseRss('<html>503 Service Unavailable</html>')).toEqual([]);
    expect(parseRss('<rss><channel><item><link>x</link></item></channel></rss>')).toEqual([]);
  });
});

describe('helpers', () => {
  it('decodes entities and CDATA', () => {
    expect(decodeXml('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&apos; &#8211; &#x1EA1;')).toBe(
      'a & b <c> "d" \'e\' – ạ',
    );
    expect(decodeXml('<![CDATA[x & <y>]]>')).toBe('x & <y>');
  });
  it('parses approximate traffic', () => {
    expect(parseTraffic('200K+')).toBe(200_000);
    expect(parseTraffic('2M+')).toBe(2_000_000);
    expect(parseTraffic('20,000+')).toBe(20_000);
    expect(parseTraffic('1.000+')).toBe(1000);
    expect(parseTraffic('')).toBeUndefined();
    expect(parseTraffic('nhiều')).toBeUndefined();
  });
});
