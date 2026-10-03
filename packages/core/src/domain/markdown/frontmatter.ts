import { parseDocument, type Document } from 'yaml';
import { SfError } from '../../errors.js';
import { normalizeNewlines } from '../hash.js';

/** Lỗi cú pháp marker/khối, có số dòng (1-based, tính cả front matter). */
export function parseError(line: number, message: string): SfError {
  const e = new SfError('E_PARSE_MARKER', `line ${line}: ${message}`, { line });
  (e as SfError & { line: number }).line = line;
  return e;
}

export const toJsonKey = (v: unknown): string => JSON.stringify(v);

export interface FrontMatter {
  /** Giá trị đã parse; sửa trực tiếp rồi serialize. */
  data: Record<string, unknown>;
  /** Dòng gốc (gồm hai dòng `---`). */
  raw: string[];
  orig: string;
  doc: Document;
}

export interface SplitDoc {
  front: FrontMatter;
  /** Các dòng thân (sau front matter), chỉ số 0 = dòng `bodyStart + 1` của file. */
  body: string[];
  /** Số dòng (1-based) của dòng thân đầu tiên. */
  bodyStart: number;
}

const YAML_OPTS = { lineWidth: 0, minContentWidth: 0 } as const;

export function yamlToString(doc: Document): string {
  return doc.toString(YAML_OPTS);
}

/** Tách front matter YAML `---` … `---` khỏi thân. Bắt buộc có front matter (D3 5.1). */
export function splitFrontMatter(text: string): SplitDoc {
  const lines = normalizeNewlines(text).split('\n');
  if (lines[0] !== '---') throw parseError(1, 'missing YAML front matter (---)');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw parseError(1, 'unterminated front matter');
  const yamlText = lines.slice(1, end).join('\n');
  const doc = parseDocument(yamlText);
  if (doc.errors.length) {
    const err = doc.errors[0]!;
    throw parseError(2 + (err.linePos?.[0]?.line ?? 1) - 1, `front matter: ${err.message}`);
  }
  const data = (doc.toJS() ?? {}) as Record<string, unknown>;
  if (typeof data !== 'object' || Array.isArray(data))
    throw parseError(2, 'front matter must be a map');
  return {
    front: { data, raw: lines.slice(0, end + 1), orig: toJsonKey(data), doc },
    body: lines.slice(end + 1),
    bodyStart: end + 2,
  };
}

/** Front matter: nguyên văn nếu không đổi; nếu đổi chỉ cập nhật khóa khác biệt (giữ chú thích). */
export function renderFrontMatter(f: FrontMatter): string[] {
  if (toJsonKey(f.data) === f.orig) return f.raw;
  const doc = f.doc.clone();
  const before = JSON.parse(f.orig) as Record<string, unknown>;
  for (const key of Object.keys(before)) if (!(key in f.data)) doc.delete(key);
  for (const [key, value] of Object.entries(f.data)) {
    if (toJsonKey(before[key]) !== toJsonKey(value)) doc.set(key, value);
  }
  return ['---', ...yamlToString(doc).replace(/\n$/, '').split('\n'), '---'];
}
