import { createHash } from 'node:crypto';

/** Chuẩn hóa xuống dòng về `\n` (D3 mục 8). */
export const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

/** sha256 hex: văn bản được chuẩn hóa `\n`; Buffer băm nguyên byte. */
export function sha256(content: string | Buffer): string {
  const h = createHash('sha256');
  h.update(typeof content === 'string' ? normalizeNewlines(content) : content);
  return h.digest('hex');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** JSON với khóa sắp xếp (dùng cho khóa cache, input_hash). */
export const canonicalJson = (value: unknown): string => JSON.stringify(canonical(value));
