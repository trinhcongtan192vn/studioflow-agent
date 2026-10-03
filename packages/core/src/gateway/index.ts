import { Gateway, type GatewayOptions } from './gateway.js';
import { artifactTools } from './tools/artifact.js';
import { configTools } from './tools/config.js';
import { scriptTools } from './tools/script.js';

/** Gateway với tool nền của 003 (`artifact.*`, `config.*`, `script.run`). */
export function createGateway(opts: GatewayOptions = {}): Gateway {
  const gw = new Gateway(opts);
  for (const t of [...artifactTools, ...configTools, ...scriptTools]) gw.register(t);
  return gw;
}

export { Gateway, type GatewayOptions } from './gateway.js';
export { kindsForTool, SESSION_KINDS, type SessionKind } from './policy.js';
export {
  PermissionBus,
  type PermissionDecision,
  type PermissionKind,
  type PermissionRequest,
} from './permission.js';
export { createMcpServer, toMcpName } from './mcp.js';
export { startHttpGateway, type HttpGateway } from './http.js';
export { setScriptExecutable, type ScriptExecutable, type ScriptResult } from './tools/script.js';
export { globToRegExp } from './glob.js';
export type { ToolDefinition, ToolContext, CallOptions } from './types.js';
