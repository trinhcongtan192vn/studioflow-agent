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

/** Xem trước (017, chỉ đọc): chỉ chọn/thăm dò phần tử. */
const PREVIEW_WRITES = [
  /^\/api\/projects\/[^/]+\/file-mutations\/(probe-element|probe-elements)(\/|$)/,
  /^\/api\/projects\/[^/]+\/selection$/,
];

export function studioWriteAllowed(method: string, url: string, readOnly = false): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return true;
  const p = decodeURIComponent(url.split('?')[0]!);
  if (!p.startsWith('/api/')) return true;
  return (readOnly ? PREVIEW_WRITES : ALLOWED_WRITES).some((r) => r.test(p));
}

/**
 * Trang cầu nối cùng origin với Studio (028, FR-CH-04): WebMCP của Studio chỉ mở tool khi khung cha cùng
 * origin (Chrome chưa có Permissions Policy `tools`) → trang này nhúng Studio và chuyển tiếp thông điệp
 * MCP giữa app (khung cha khác origin) và Studio.
 */
export const BRIDGE_PATH = '/__sf/bridge.html';
/**
 * Electron (Chromium 138) đặt `originAgentCluster = false` cho mọi khung kể cả khi có header
 * `Origin-Agent-Cluster`; polyfill WebMCP của Studio coi đó là lỗi bảo mật và không đăng ký tool. Studio
 * chạy cục bộ, đã cách ly sau proxy → báo agent cluster theo origin cho polyfill.
 */
const STUDIO_SHIM =
  '<script>try{if(globalThis.originAgentCluster===false)Object.defineProperty(globalThis,"originAgentCluster",{value:true,configurable:true})}catch(e){}</script>';
const BRIDGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Studio</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block;overflow:hidden;background:#111}</style></head><body><iframe id="s" allow="tools; clipboard-read; clipboard-write; fullscreen"></iframe><script>
const s = document.getElementById('s');
s.src = '/' + location.hash;
addEventListener('message', (e) => {
  if (e.source === s.contentWindow) parent.postMessage(e.data, '*');
  else if (e.source === parent && parent !== window) s.contentWindow.postMessage(e.data, location.origin);
});
</script></body></html>`;

/**
 * Proxy cục bộ trước `hf-studio` (FR-ST-03): chặn API ghi ngoài danh sách (403 kèm giải thích); HTTP và
 * WebSocket còn lại đi xuyên. Chỉ lắng nghe 127.0.0.1.
 */
export function startStudioProxy(
  targetPort: number,
  o: { readOnly?: boolean } = {},
): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer((req: IncomingMessage, res) => {
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === BRIDGE_PATH) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'origin-agent-cluster': '?1',
      });
      res.end(BRIDGE_HTML);
      return;
    }
    if (!studioWriteAllowed(req.method ?? 'GET', req.url ?? '/', o.readOnly)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error:
            'StudioFlow: thao tác này không được phép khi chỉnh trong Studio (chỉ chỉnh vị trí, kích thước, timing, keyframe, grade, âm lượng). Sửa nội dung/mã qua chat.',
        }),
      );
      return;
    }
    // trang ứng dụng Studio: chèn shim WebMCP (xem STUDIO_SHIM) → đọc nguyên văn để sửa
    const appPage =
      req.method === 'GET' && /^\/(index\.html)?$/.test((req.url ?? '').split('?')[0]!);
    const up = request(
      {
        host: '127.0.0.1',
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${targetPort}`,
          ...(appPage ? { 'accept-encoding': 'identity' } : {}),
        },
      },
      (r) => {
        const html = appPage && String(r.headers['content-type'] ?? '').includes('text/html');
        if (!html) {
          res.writeHead(r.statusCode ?? 502, { ...r.headers, 'origin-agent-cluster': '?1' });
          r.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => {
          const body = Buffer.concat(chunks)
            .toString('utf8')
            .replace(/<head[^>]*>/i, (h) => h + STUDIO_SHIM);
          const { 'content-length': _len, ...headers } = r.headers;
          void _len;
          res.writeHead(r.statusCode ?? 200, { ...headers, 'origin-agent-cluster': '?1' });
          res.end(body);
        });
      },
    );
    up.on('error', (e) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
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
