import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { SfError } from '../errors.js';

const outside = (rel: string, why: string) =>
  new SfError('E_PATH_OUTSIDE', `path "${rel}" is outside the channel (${why})`);

/** Chuẩn hóa đường dẫn tương đối (D3 mục 1: tương đối, dấu `/`) và chặn mọi lối ra ngoài. */
export function normalizeRel(rel: string): string {
  const s = rel.replaceAll('\\', '/');
  if (s === '' || path.isAbsolute(rel) || s.startsWith('/') || /^[a-zA-Z]:/.test(s))
    throw outside(rel, 'absolute');
  const parts = s.split('/').filter((x) => x !== '' && x !== '.');
  if (parts.some((x) => x === '..')) throw outside(rel, '".." segment');
  if (parts.length === 0) throw outside(rel, 'empty');
  return parts.join('/');
}

/**
 * Đường dẫn tuyệt đối trong kênh. Kiểm thêm `realpath` của thư mục tồn tại gần nhất để chặn
 * symlink/junction trỏ ra ngoài.
 */
export function resolveInside(rootReal: string, rel: string): { rel: string; abs: string } {
  const norm = normalizeRel(rel);
  const abs = path.join(rootReal, ...norm.split('/'));
  let probe = abs;
  while (!existsSync(probe)) probe = path.dirname(probe);
  const real = realpathSync.native(probe);
  const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (real !== rootReal && !real.toLowerCase().startsWith(rootWithSep.toLowerCase())) {
    throw outside(rel, `resolves to ${real}`);
  }
  return { rel: norm, abs };
}

/** `videos/<vd>/…` → thư mục video (tương đối kênh) và phần còn lại; ngược lại undefined. */
export function splitVideoPath(rel: string): { videoRel: string; inner: string } | undefined {
  const m = /^(videos\/[^/]+)\/(.+)$/.exec(rel);
  return m ? { videoRel: m[1]!, inner: m[2]! } : undefined;
}
