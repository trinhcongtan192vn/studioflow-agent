import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import { connect } from 'node:net';

/**
 * API ghi của Studio được phép khi chỉnh (025 R2, D9 3.3): sửa thuộc tính/style phần tử, keyframe GSAP,
 * thăm dò, chọn phần tử. Mọi API ghi khác (lưu mã thô, thêm/xóa/bọc/tách phần tử, cài khối, render) bị chặn.
 */
const ALLOWED_WRITES = [
  /^\/api\/projects\/[^/]+\/file-mutations\/(patch-element|patch-elements-batch|patch-element-batches|probe-element|probe-elements)(\/|$)/,
  /^\/api\/projects\/[^/]+\/(gsap-mutations|gsap-mutations-batch|gsap-mutation-rollback)(\/|$)/,
  /^\/api\/projects\/[^/]+\/selection$/,
];

export function studioWriteAllowed(method: string, url: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return true;
  const p = decodeURIComponent(url.split('?')[0]!);
  if (!p.startsWith('/api/')) return true;
  return ALLOWED_WRITES.some((r) => r.test(p));
}

/**
 * Proxy cục bộ trước `hf-studio` (FR-ST-03): chặn API ghi ngoài danh sách (403 kèm giải thích); HTTP và
 * WebSocket còn lại đi xuyên. Chỉ lắng nghe 127.0.0.1.
 */
export function startStudioProxy(
  targetPort: number,
): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer((req: IncomingMessage, res) => {
    if (!studioWriteAllowed(req.method ?? 'GET', req.url ?? '/')) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error:
            'StudioFlow: thao tác này không được phép khi chỉnh trong Studio (chỉ chỉnh vị trí, kích thước, timing, keyframe, grade, âm lượng). Sửa nội dung/mã qua chat.',
        }),
      );
      return;
    }
    const up = request(
      {
        host: '127.0.0.1',
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `127.0.0.1:${targetPort}` },
      },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`studio unavailable: ${e.message}`);
    });
    req.pipe(up);
  });
  server.on('upgrade', (req, socket, head) => {
    const up = connect(targetPort, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const end = () => {
      up.destroy();
      socket.destroy();
    };
    up.on('error', end);
    socket.on('error', end);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as { port: number }).port,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      }),
    ),
  );
}
