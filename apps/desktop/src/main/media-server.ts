import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { mediaSlice } from './media-range.js';

/**
 * Phát video/ảnh trong app qua HTTP cục bộ (127.0.0.1, đường dẫn có token ngẫu nhiên, chỉ file được phép).
 * Giao thức tùy biến `sf-media:` trả Range theo đoạn làm trình phát Chromium nhảy tới cuối hoặc lỗi giải mã ở
 * ranh giới đoạn với video thật (B-frame, AAC, nhiều đoạn — 2026-10-10, vd_nnwcjgp9); HTTP thật thì Chromium
 * tự xin Range và đọc luồng ổn định. URL: `<base>/<encodeURIComponent(đường dẫn tuyệt đối)>`.
 */
export function startMediaServer(o: {
  allowed: (abs: string) => boolean;
  types: Record<string, string>;
}): Promise<{ base: string; close(): void }> {
  const token = randomBytes(16).toString('hex');
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const prefix = `/m/${token}/`;
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !url.pathname.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    const abs = path.normalize(decodeURIComponent(url.pathname.slice(prefix.length)));
    if (abs.includes('..') || !o.allowed(abs) || !existsSync(abs)) {
      res.writeHead(404).end();
      return;
    }
    const size = statSync(abs).size;
    const type = o.types[path.extname(abs).slice(1).toLowerCase()] ?? 'application/octet-stream';
    // đoạn đúng như yêu cầu (không cắt nhỏ): HTTP thật, Chromium tự xin tiếp khi cần
    const slice = mediaSlice(req.headers.range ?? null, size, Number.MAX_SAFE_INTEGER);
    if (slice.status === 416) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    const { start, end } = slice;
    res.writeHead(slice.status, {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      ...(slice.status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(abs, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        base: `http://127.0.0.1:${addr.port}/m/${token}`,
        close: () => server.close(),
      });
    }),
  );
}
