import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

/** Một phần tử chữ cần thu nhỏ để nằm trong vùng an toàn (đo trong Chrome, `safe-area.ts`). */
export interface FontFix {
  frame_id: string;
  /** `data-sf-id` của chính phần tử (nếu có). */
  sf_id?: string;
  /** `data-sf-id` của tổ tiên gần nhất (khi phần tử không có). */
  anchor_sf_id?: string;
  tag: string;
  /** Thuộc tính `class` lúc đo. */
  cls: string;
  /** Chữ riêng của phần tử (đã gom khoảng trắng). */
  text: string;
  from_px: number;
  font_px: number;
}

const isElement = (n: Node): n is Element => 'tagName' in n;
const attr = (e: Element, name: string) => e.attrs.find((a) => a.name === name)?.value;

function kids(n: Node): Node[] {
  const own = 'childNodes' in n ? (n.childNodes as Node[]) : [];
  const tpl = (n as { content?: { childNodes: Node[] } }).content;
  return tpl ? [...own, ...tpl.childNodes] : own;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const ownText = (e: Element) =>
  norm(
    kids(e)
      .filter((c) => c.nodeName === '#text')
      .map((c) => (c as { value: string }).value)
      .join(' '),
  );

/** Phần tử khớp với chỗ đo: theo `data-sf-id` riêng, không có thì thẻ + class + chữ dưới tổ tiên có id. */
function findTarget(root: Node, f: FontFix): Element | undefined {
  const found: Element[] = [];
  const want = new Set(f.cls.split(/\s+/).filter(Boolean));
  const walk = (n: Node, anchor: string | undefined) => {
    for (const c of kids(n)) {
      if (!isElement(c)) continue;
      const sf = attr(c, 'data-sf-id');
      if (f.sf_id) {
        if (sf === f.sf_id) found.push(c);
      } else if (
        c.tagName === f.tag &&
        anchor === f.anchor_sf_id &&
        (attr(c, 'class') ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .every((x) => want.has(x)) &&
        f.text &&
        ownText(c).startsWith(f.text)
      )
        found.push(c);
      walk(c, sf ?? anchor);
    }
  };
  walk(root, undefined);
  return found.length === 1 ? found[0] : undefined;
}

function withFontSize(style: string | undefined, px: number): string {
  const parts = (style ?? '')
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x && !/^font-size\s*:/i.test(x));
  return [...parts, `font-size: ${px}px`].join('; ');
}

/**
 * Ghi `font-size` (inline, thắng class CSS) cho từng phần tử đo được là tràn vùng an toàn; giữ nguyên phần
 * còn lại của file (sửa chuỗi tại vị trí thẻ mở). Phần tử không tìm thấy duy nhất → `missed`.
 */
export function applyFontFixes(
  html: string,
  fixes: FontFix[],
): { html: string; applied: FontFix[]; missed: FontFix[] } {
  const root = parseFragment(html, { sourceCodeLocationInfo: true }) as unknown as Node;
  const edits: { start: number; end: number; text: string }[] = [];
  const applied: FontFix[] = [];
  const missed: FontFix[] = [];
  for (const f of fixes) {
    const e = findTarget(root, f);
    const loc = e?.sourceCodeLocation;
    if (!e || !loc?.startTag) {
      missed.push(f);
      continue;
    }
    const style = withFontSize(attr(e, 'style'), f.font_px).replaceAll('"', '&quot;');
    const at = loc.attrs?.style;
    edits.push(
      at
        ? { start: at.startOffset, end: at.endOffset, text: `style="${style}"` }
        : (() => {
            const tagEnd = loc.startTag!.endOffset;
            const close = html[tagEnd - 2] === '/' ? tagEnd - 2 : tagEnd - 1;
            return { start: close, end: close, text: ` style="${style}"` };
          })(),
    );
    applied.push(f);
  }
  let out = html;
  for (const ed of edits.sort((a, b) => b.start - a.start))
    out = out.slice(0, ed.start) + ed.text + out.slice(ed.end);
  return { html: out, applied, missed };
}
