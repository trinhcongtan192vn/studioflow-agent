/** Kích thước + alpha từ header ảnh (PNG/JPEG/GIF/WebP/SVG), không phụ thuộc ngoài (011 R6). */
export interface ImageInfo {
  kind: 'image' | 'svg';
  width: number;
  height: number;
  alpha: boolean;
}

export function imageInfo(buf: Buffer): ImageInfo | undefined {
  // PNG: IHDR ngay sau chữ ký; color type 4/6 hoặc có tRNS → alpha
  if (buf.length > 26 && buf.readUInt32BE(0) === 0x89504e47) {
    const colorType = buf[25]!;
    return {
      kind: 'image',
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      alpha: colorType === 4 || colorType === 6 || buf.includes('tRNS'),
    };
  }
  // GIF
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { kind: 'image', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), alpha: true };
  }
  // JPEG: tìm marker SOFn
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const m = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return {
          kind: 'image',
          width: buf.readUInt16BE(i + 7),
          height: buf.readUInt16BE(i + 5),
          alpha: false,
        };
      }
      i += 2 + len;
    }
    return undefined;
  }
  // WebP (VP8 / VP8L / VP8X)
  if (
    buf.length > 30 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return {
        kind: 'image',
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
        alpha: (buf[20]! & 0x10) !== 0,
      };
    }
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return {
        kind: 'image',
        width: (b & 0x3fff) + 1,
        height: ((b >> 14) & 0x3fff) + 1,
        alpha: ((b >> 28) & 1) === 1,
      };
    }
    if (chunk === 'VP8 ')
      return {
        kind: 'image',
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
        alpha: false,
      };
  }
  // SVG: width/height hoặc viewBox
  const head = buf.toString('utf8', 0, Math.min(buf.length, 4096));
  if (/<svg\b/i.test(head)) {
    const tag = /<svg\b[^>]*>/i.exec(head)?.[0] ?? '';
    const num = (a: string) =>
      Number(new RegExp(`\\b${a}\\s*=\\s*["']([\\d.]+)`, 'i').exec(tag)?.[1]);
    const vb = /viewBox\s*=\s*["'][\d.\s-]*?([\d.]+)[\s,]+([\d.]+)["']/i.exec(tag);
    const w = num('width') || Number(vb?.[1]) || 0;
    const h = num('height') || Number(vb?.[2]) || 0;
    return { kind: 'svg', width: Math.round(w), height: Math.round(h), alpha: true };
  }
  return undefined;
}
