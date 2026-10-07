/**
 * Parser RSS 2.0 tối giản cho Google Trends / Google News (049). Hai nguồn này có cấu trúc phẳng, ổn
 * định → regex đủ dùng, không thêm thư viện XML. Lỗi định dạng → bỏ qua mục, không ném lỗi.
 */

export interface RssNews {
  title: string;
  url?: string;
  source?: string;
}

export interface RssItem {
  title: string;
  link?: string;
  /** ISO 8601 từ `pubDate` (RFC 822). */
  published_at?: string;
  /** Tên nguồn (`<source>` của Google News). */
  source?: string;
  /** Lượt tìm ước tính (`ht:approx_traffic` của Google Trends). */
  traffic?: number;
  /** Tin kèm theo (`ht:news_item` của Google Trends). */
  news: RssNews[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Bỏ CDATA và giải thực thể XML (có tên + số thập phân/hex). */
export function decodeXml(s: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  if (cdata) return cdata[1]!;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** "200K+" / "2M+" / "20,000+" / "1.000+" → số; không đọc được → `undefined`. */
export function parseTraffic(s: string | undefined): number | undefined {
  const m = /^\s*([\d.,]+)\s*([KkMm]?)\+?\s*$/.exec(s ?? '');
  if (!m) return undefined;
  const mult = { k: 1e3, m: 1e6 }[m[2]!.toLowerCase()] ?? 1;
  // có hậu tố: dấu , . là thập phân (1,5K); không hậu tố: dấu phân cách hàng nghìn
  const n = mult > 1 ? Number(m[1]!.replace(',', '.')) : Number(m[1]!.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? Math.round(n * mult) : undefined;
}

const tag = (block: string, name: string): string | undefined => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? decodeXml(m[1]!).trim() : undefined;
};

function isoDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** Các `<item>` của một RSS 2.0. */
export function parseRss(xml: string): RssItem[] {
  const out: RssItem[] = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)) {
    let block = m[1]!;
    const news: RssNews[] = [];
    // tin kèm theo lồng trong item: tách ra trước để `<title>` của item không lẫn
    block = block.replace(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g, (_, n: string) => {
      const title = tag(n, 'ht:news_item_title');
      const url = tag(n, 'ht:news_item_url');
      const source = tag(n, 'ht:news_item_source');
      if (title) news.push({ title, ...(url ? { url } : {}), ...(source ? { source } : {}) });
      return '';
    });
    let title = tag(block, 'title');
    if (!title) continue;
    const source = tag(block, 'source');
    // Google News: "Tiêu đề - Nguồn" → bỏ đuôi nguồn
    if (source && title.endsWith(` - ${source}`))
      title = title.slice(0, -` - ${source}`.length).trim();
    const link = tag(block, 'link');
    const published = isoDate(tag(block, 'pubDate'));
    const traffic = parseTraffic(tag(block, 'ht:approx_traffic'));
    out.push({
      title,
      ...(link ? { link } : {}),
      ...(published ? { published_at: published } : {}),
      ...(source ? { source } : {}),
      ...(traffic === undefined ? {} : { traffic }),
      news,
    });
  }
  return out;
}
