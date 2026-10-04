import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

/** Một thay đổi trình bày (D3 5.5 `ManualDelta.changes`) + phân loại theo D9 3.3. */
export interface StudioChange {
  file: string;
  element_id: string;
  /** `style.<prop>`, tên thuộc tính, `text`, `element`, `tag`, `script`, `css`. */
  attr: string;
  before: string | null;
  after: string | null;
  allowed: boolean;
  reason?: string;
}

/** D9 3.3: vị trí/kích thước. */
const STYLE_OK = new Set([
  'left',
  'top',
  'right',
  'bottom',
  'width',
  'height',
  'transform',
  'opacity',
  'z-index',
]);
/** D9 3.3: timing của HyperFrames, grade/hiệu ứng, audio; `data-hf-*` là đánh dấu nội bộ của Studio (025 R1). */
const ATTR_OK = [
  /^data-(start|duration|end|offset|track-index|layer|media-start|trim-start|trim-end)$/,
  /^data-color-grading/,
  /^data-media-/,
  /^data-volume/,
  /^data-fade-/,
];

/** Đánh dấu nội bộ Studio gắn cho mọi phần tử khi mở (`data-hf-id`, 025 R1) — không phải thay đổi. */
const STUDIO_MARK = /^data-hf-/;

/** Bỏ đánh dấu của Studio (giữ nguyên định dạng file — thay chuỗi, không serialize lại). */
export function stripStudioMarks(html: string): string {
  return html.replace(/\s+data-hf-[\w-]+\s*=\s*("[^"]*"|'[^']*')/g, '');
}

const isFullDocument = (html: string) => /^\s*(<!doctype|<html)/i.test(html);
const parseAny = (html: string) => (isFullDocument(html) ? parse(html) : parseFragment(html));

function children(n: Node): Node[] {
  const kids = 'childNodes' in n ? (n.childNodes as Node[]) : [];
  const tpl = (n as { content?: Node }).content;
  return tpl ? [...kids, ...((tpl as { childNodes: Node[] }).childNodes ?? [])] : kids;
}

const isElement = (n: Node): n is Element => 'tagName' in n;
const attrOf = (e: Element, name: string) => e.attrs.find((a) => a.name === name)?.value;

/** Phần tử theo thứ tự tài liệu, khóa = `data-sf-id` hoặc đường dẫn dưới tổ tiên có id gần nhất. */
function index(root: Node): Map<string, Element> {
  const out = new Map<string, Element>();
  const walk = (n: Node, scope: string) => {
    const counts = new Map<string, number>();
    for (const c of children(n)) {
      if (!isElement(c)) continue;
      const sf = attrOf(c, 'data-sf-id');
      const i = counts.get(c.tagName) ?? 0;
      counts.set(c.tagName, i + 1);
      const htmlId = attrOf(c, 'id');
      const key = sf ?? (htmlId ? `#${htmlId}` : `${scope}/${c.tagName}[${i}]`);
      out.set(key, c);
      walk(c, sf ?? key);
    }
  };
  walk(root, '');
  return out;
}

const ownText = (e: Element) =>
  children(e)
    .filter((c) => c.nodeName === '#text')
    .map((c) => (c as { value: string }).value)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

export function parseStyle(s: string | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (s ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) m.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  return m;
}

/** Token JS thô: chuỗi, số, tên, dấu (bỏ khoảng trắng/chú thích). */
function tokens(js: string): { kind: 'lit' | 'code'; v: string }[] {
  const re =
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\$])*`)|(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_$][\w$]*)|(\S)/g;
  const out: { kind: 'lit' | 'code'; v: string }[] = [];
  for (const m of js.matchAll(re)) {
    if (m[1] !== undefined || m[2] !== undefined) out.push({ kind: 'lit', v: (m[1] ?? m[2])! });
    else if (m[3] !== undefined || m[4] !== undefined)
      out.push({ kind: 'code', v: (m[3] ?? m[4])! });
  }
  return out;
}

/** D9 3.4 (b): script chỉ được đổi giá trị số/chuỗi (cùng chuỗi token). */
function diffScript(
  a: string,
  b: string,
): { allowed: boolean; before: string; after: string } | undefined {
  if (a === b) return undefined;
  const ta = tokens(a);
  const tb = tokens(b);
  const same =
    ta.length === tb.length &&
    ta.every((t, i) => t.kind === tb[i]!.kind && (t.kind === 'lit' || t.v === tb[i]!.v));
  if (!same) return { allowed: false, before: '', after: '' };
  const diff = ta.map((t, i) => [t.v, tb[i]!.v] as const).filter(([x, y]) => x !== y);
  if (!diff.length) return undefined;
  return {
    allowed: true,
    before: diff.map(([x]) => x).join(', '),
    after: diff.map(([, y]) => y).join(', '),
  };
}

const attrAllowed = (name: string) => ATTR_OK.some((r) => r.test(name));

/**
 * So DOM bản gốc và bản Studio (D9 3.2): ghép phần tử theo `data-sf-id`; phân loại từng thay đổi theo
 * danh sách cho phép (3.3) và quy tắc keyframe (3.4 b). Chỉ khác định dạng → không có thay đổi.
 */
export function diffHtml(base: string, next: string, file: string): StudioChange[] {
  const a = index(parseAny(base));
  const b = index(parseAny(next));
  const out: StudioChange[] = [];
  const push = (c: Omit<StudioChange, 'file'>) => out.push({ file, ...c });
  for (const [key, ea] of a) {
    const eb = b.get(key);
    const id = attrOf(ea, 'data-sf-id') ?? key;
    if (!eb) {
      push({
        element_id: id,
        attr: 'element',
        before: ea.tagName,
        after: null,
        allowed: false,
        reason: 'xóa phần tử không được phép',
      });
      continue;
    }
    if (ea.tagName !== eb.tagName) {
      push({
        element_id: id,
        attr: 'tag',
        before: ea.tagName,
        after: eb.tagName,
        allowed: false,
        reason: 'đổi thẻ không được phép',
      });
      continue;
    }
    if (ea.tagName === 'script') {
      const d = diffScript(ownTextRaw(ea), ownTextRaw(eb));
      if (d)
        push({
          element_id: id,
          attr: 'script',
          before: d.before || null,
          after: d.after || null,
          allowed: d.allowed,
          ...(d.allowed
            ? {}
            : { reason: 'script đổi cấu trúc (chỉ được đổi giá trị số/chuỗi trong lời gọi GSAP)' }),
        });
      continue;
    }
    if (ea.tagName === 'style') {
      if (ownTextRaw(ea).trim() !== ownTextRaw(eb).trim())
        push({
          element_id: id,
          attr: 'css',
          before: null,
          after: null,
          allowed: false,
          reason: 'đổi CSS của khối <style> không được phép',
        });
      continue;
    }
    const names = new Set([...ea.attrs.map((x) => x.name), ...eb.attrs.map((x) => x.name)]);
    const noSfId = !attrOf(ea, 'data-sf-id');
    for (const name of names) {
      if (STUDIO_MARK.test(name)) continue;
      const va = attrOf(ea, name) ?? null;
      const vb = attrOf(eb, name) ?? null;
      if (va === vb) continue;
      if (name === 'style') {
        const sa = parseStyle(va ?? undefined);
        const sb = parseStyle(vb ?? undefined);
        for (const p of new Set([...sa.keys(), ...sb.keys()])) {
          const x = sa.get(p) ?? null;
          const y = sb.get(p) ?? null;
          if (x === y) continue;
          const ok = STYLE_OK.has(p) && !noSfId;
          push({
            element_id: id,
            attr: `style.${p}`,
            before: x,
            after: y,
            allowed: ok,
            ...(ok
              ? {}
              : {
                  reason: noSfId
                    ? 'chỉ chỉnh được phần tử có data-sf-id'
                    : `thuộc tính style "${p}" ngoài danh sách cho phép`,
                }),
          });
        }
        continue;
      }
      const ok = attrAllowed(name) && (!noSfId || id === '#el-music');
      push({
        element_id: id,
        attr: name,
        before: va,
        after: vb,
        allowed: ok,
        ...(ok
          ? {}
          : {
              reason:
                noSfId && attrAllowed(name)
                  ? 'chỉ chỉnh được phần tử có data-sf-id'
                  : `thuộc tính "${name}" ngoài danh sách cho phép`,
            }),
      });
    }
    if (ownText(ea) !== ownText(eb))
      push({
        element_id: id,
        attr: 'text',
        before: ownText(ea),
        after: ownText(eb),
        allowed: false,
        reason: 'đổi nội dung chữ không được phép (sửa chữ qua chat/kịch bản)',
      });
  }
  for (const [key, eb] of b)
    if (!a.has(key))
      push({
        element_id: attrOf(eb, 'data-sf-id') ?? key,
        attr: 'element',
        before: null,
        after: eb.tagName,
        allowed: false,
        reason: 'thêm phần tử không được phép',
      });
  return out;
}

function ownTextRaw(e: Element): string {
  return children(e)
    .filter((c) => c.nodeName === '#text')
    .map((c) => (c as { value: string }).value)
    .join('');
}

/**
 * Áp lại delta lên frame dựng lại (D9 mục 5 "sinh lại rồi áp lại chỉnh tay", 025 R4): style/thuộc tính
 * trên phần tử cùng `data-sf-id`; script và phần tử không còn → trả về `unapplied`.
 */
export function applyDelta(
  html: string,
  changes: Pick<StudioChange, 'element_id' | 'attr' | 'before' | 'after'>[],
): { html: string; unapplied: typeof changes } {
  const doc = parseAny(html);
  const els = index(doc);
  const unapplied: typeof changes = [];
  for (const c of changes) {
    const e = els.get(c.element_id);
    if (
      !e ||
      c.attr === 'script' ||
      c.attr === 'text' ||
      c.attr === 'element' ||
      c.attr === 'tag' ||
      c.attr === 'css'
    ) {
      unapplied.push(c);
      continue;
    }
    if (c.attr.startsWith('style.')) {
      const prop = c.attr.slice(6);
      const st = parseStyle(attrOf(e, 'style'));
      if (c.after === null) st.delete(prop);
      else st.set(prop, c.after);
      setAttr(e, 'style', [...st].map(([k, v]) => `${k}: ${v}`).join('; '));
    } else if (c.after === null) e.attrs = e.attrs.filter((x) => x.name !== c.attr);
    else setAttr(e, c.attr, c.after);
  }
  return { html: serialize(doc as never), unapplied };
}

function setAttr(e: Element, name: string, value: string): void {
  const a = e.attrs.find((x) => x.name === name);
  if (a) a.value = value;
  else e.attrs.push({ name, value });
}
