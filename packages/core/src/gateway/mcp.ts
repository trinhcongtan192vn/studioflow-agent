import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { SessionContext } from '../contracts/types.js';
import { CORE_VERSION } from '../version.js';
import type { Gateway } from './gateway.js';

/** Tên MCP: thay `.` bằng `_` (D4 mục 2.1). */
export const toMcpName = (name: string): string => name.replaceAll('.', '_');

/**
 * MCP server `sf` gắn với một `SessionContext` (dùng trong tiến trình — 005 gắn vào Claude Agent
 * SDK — hoặc qua HTTP). Kết quả tool là `ToolResult` JSON; lỗi tool không phải lỗi giao thức.
 */
export function createMcpServer(gw: Gateway, session: SessionContext): McpServer {
  const mcp = new McpServer({ name: 'sf', version: CORE_VERSION }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: gw.list(session.kind).map((t) => ({
      name: toMcpName(t.name),
      description: t.description,
      inputSchema: t.input as { type: 'object' },
    })),
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const byMcp = new Map(gw.list(session.kind).map((t) => [toMcpName(t.name), t.name]));
    const name = byMcp.get(req.params.name) ?? req.params.name;
    const r = await gw.call(session, name, req.params.arguments ?? {});
    return { content: [{ type: 'text' as const, text: JSON.stringify(r) }], isError: !r.ok };
  });
  return mcp;
}
