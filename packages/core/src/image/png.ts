import { deflateSync } from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) c = CRC[(c ^ b) & 255]! ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * PNG một màu (provider giả `image.fake`, D12): RGB hoặc RGBA; với alpha, nửa trái trong suốt để
 * phân biệt được ảnh trong suốt.
 */
export function solidPng(
  width: number,
  height: number,
  rgb: [number, number, number],
  alpha = false,
): Buffer {
  const bpp = alpha ? 4 : 3;
  const row = Buffer.alloc(1 + width * bpp);
  const rows: Buffer[] = [];
  for (let x = 0; x < width; x++) {
    row.set(rgb, 1 + x * bpp);
    if (alpha) row[1 + x * bpp + 3] = x < width / 2 ? 0 : 255;
  }
  for (let y = 0; y < height; y++) rows.push(row);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
