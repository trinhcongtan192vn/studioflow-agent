import { Document, parseDocument } from 'yaml';
import {
  parseError,
  renderFrontMatter,
  splitFrontMatter,
  toJsonKey,
  yamlToString,
  type FrontMatter,
} from './frontmatter.js';

/** Khối mã có nhãn `sf-*` (D3 5.1) chứa YAML. */
export interface SfBlock {
  tag: string;
  data: unknown;
  doc: Document;
  /** Vị trí trong `body`: dòng mở ```` ``` ```` và dòng đóng. */
  open: number;
  close: number;
  /** Dòng (1-based) của dòng mở trong file. */
  line: number;
  orig: string;
  /** doc đã được sửa trực tiếp (giữ định dạng) thay vì qua `data`. */
  docDirty?: boolean;
}

export interface BlocksDoc {
  front: Record<string, unknown>;
  frontMatter: FrontMatter;
  body: string[];
  bodyStart: number;
  blocks: SfBlock[];
}

const OPEN = /^```(sf-[a-z][a-z0-9-]*)\s*$/;
const CLOSE = /^```\s*$/;
const ANY_FENCE = /^```/;

/** Tìm các khối `sf-*` trong thân; khối mã khác được bỏ qua như văn xuôi. */
export function findBlocks(body: string[], bodyStart: number): SfBlock[] {
  const blocks: SfBlock[] = [];
  for (let i = 0; i < body.length; i++) {
    const m = OPEN.exec(body[i]!);
    if (!m) {
      if (ANY_FENCE.test(body[i]!)) {
        // bỏ qua khối mã thường tới dòng đóng
        const close = body.findIndex((l, j) => j > i && CLOSE.test(l));
        if (close > i) i = close;
      }
      continue;
    }
    const close = body.findIndex((l, j) => j > i && CLOSE.test(l));
    const line = bodyStart + i;
    if (close < 0) throw parseError(line, `unterminated \`\`\`${m[1]} block`);
    const doc = parseDocument(body.slice(i + 1, close).join('\n'));
    if (doc.errors.length) {
      const err = doc.errors[0]!;
      throw parseError(line + (err.linePos?.[0]?.line ?? 1), `${m[1]}: ${err.message}`);
    }
    const data = doc.toJS() as unknown;
    blocks.push({ tag: m[1]!, data, doc, open: i, close, line, orig: toJsonKey(data) });
    i = close;
  }
  return blocks;
}

export function renderBlock(b: SfBlock): string[] {
  if (!b.docDirty && toJsonKey(b.data) === b.orig) return [];
  let doc = b.doc;
  if (!b.docDirty) {
    const before = JSON.parse(b.orig) as unknown;
    const isMap = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (isMap(before) && isMap(b.data)) {
      // Chỉ cập nhật khóa cấp đầu khác biệt để giữ định dạng phần còn lại.
      doc = b.doc.clone();
      const after = b.data as Record<string, unknown>;
      for (const k of Object.keys(before as object)) if (!(k in after)) doc.delete(k);
      for (const [k, v] of Object.entries(after)) {
        if (toJsonKey((before as Record<string, unknown>)[k]) !== toJsonKey(v)) doc.set(k, v);
      }
    } else {
      doc = new Document(b.data);
    }
  }
  return yamlToString(doc).replace(/\n$/, '').split('\n');
}

/** Ghép lại thân, thay các khối đã đổi; `extra` cho phép parser khác thay thêm đoạn dòng. */
export function renderBody(
  body: string[],
  replacements: { start: number; end: number; lines: string[] }[],
): string[] {
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  const out: string[] = [];
  let i = 0;
  for (const r of sorted) {
    out.push(...body.slice(i, r.start), ...r.lines);
    i = r.end;
  }
  out.push(...body.slice(i));
  return out;
}

export function blockReplacements(blocks: SfBlock[]) {
  return blocks.flatMap((b) => {
    const lines = renderBlock(b);
    return lines.length ? [{ start: b.open + 1, end: b.close, lines }] : [];
  });
}

/** Tài liệu Markdown chung: front matter + khối `sf-*` + văn xuôi (BRIEF, CAST, STORY, publish, frame.md). */
export function parseBlocksDoc(text: string): BlocksDoc {
  const { front, body, bodyStart } = splitFrontMatter(text);
  return {
    front: front.data,
    frontMatter: front,
    body,
    bodyStart,
    blocks: findBlocks(body, bodyStart),
  };
}

export function serializeBlocksDoc(d: BlocksDoc): string {
  d.frontMatter.data = d.front;
  return [
    ...renderFrontMatter(d.frontMatter),
    ...renderBody(d.body, blockReplacements(d.blocks)),
  ].join('\n');
}
