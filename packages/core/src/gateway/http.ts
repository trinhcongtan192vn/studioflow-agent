import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { SessionContext } from '../contracts/types.js';
import type { Gateway } from './gateway.js';
import { createMcpServer } from './mcp.js';

export interface HttpGateway {
  url: string;
  token: string;
  kind: SessionContext['kind'];
  close(): Promise<void>;
}

function tokenOk(header: string | undefined, token: string): boolean {
  const want = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(header ?? '');
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Gateway qua MCP Streamable HTTP cho runtime khác (D4 mục 2.1, tech-defaults mục 1): chỉ
 * 127.0.0.1, cổng ngẫu nhiên, token Bearer sinh mỗi lần khởi động. Chế độ stateless.
 */
export async function startHttpGateway(gw: Gateway, session: SessionContext): Promise<HttpGateway> {
  const token = randomBytes(24).toString('base64url');
  const server = http.createServer((req, res) => {
    void (async () => {
      if (!tokenOk(req.headers.authorization, token)) {
        res.writeHead(401, { 'www-authenticate': 'Bearer' }).end();
        return;
      }
      if (req.url !== '/mcp') {
        res.writeHead(404).end();
        return;
      }
      const mcp = createMcpServer(gw, session);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    })().catch((e) => {
      if (!res.headersSent) res.writeHead(500).end(String((e as Error).message));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    kind: session.kind,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
