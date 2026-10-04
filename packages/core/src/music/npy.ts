import { SfError } from '../errors.js';

/**
 * Đọc vector `.npy` float32 một chiều (D8 mục 1 `.index/<track_id>.npy`, 021 R4): header NPY v1/v2 +
 * dữ liệu little-endian.
 */
export function readNpyF32(buf: Buffer): Float32Array {
  if (buf.length < 10 || buf[0] !== 0x93 || buf.toString('latin1', 1, 6) !== 'NUMPY')
    throw new SfError('E_SCHEMA_INVALID', 'not an NPY file');
  const major = buf[6]!;
  const headerLen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
  const start = (major === 1 ? 10 : 12) + headerLen;
  const header = buf.toString('latin1', major === 1 ? 10 : 12, start);
  if (!/'descr':\s*'<f4'/.test(header) || /'fortran_order':\s*True/.test(header))
    throw new SfError('E_SCHEMA_INVALID', `unsupported NPY header ${header.trim()}`);
  const data = buf.subarray(start);
  const out = new Float32Array(data.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = data.readFloatLE(i * 4);
  return out;
}

/** Cosine của hai vector (chuẩn hóa lại cho chắc). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
