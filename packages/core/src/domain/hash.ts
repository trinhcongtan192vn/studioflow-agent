import { createHash } from 'node:crypto';

/** Chuẩn hóa xuống dòng về `\n` (D3 mục 8). */
export const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

/** sha256 hex: văn bản được chuẩn hóa `\n`; Buffer băm nguyên byte. */
export function sha256(content: string | Buffer): string {
  const h = createHash('sha256');
  h.update(typeof content === 'string' ? normalizeNewlines(content) : content);
  return h.digest('hex');
}
