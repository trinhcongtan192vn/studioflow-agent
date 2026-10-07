import path from 'node:path';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { SessionContext, SessionOptions } from '../contracts/types.js';
import type { Gateway } from '../gateway/gateway.js';
import { createMcpServer } from '../gateway/mcp.js';
import { makeCanUseTool, RUNTIME_DISALLOWED, toolPolicy } from './policy.js';
import { systemAppendFor } from './system-append.js';

/** Model mặc định — kết quả xác minh 2026-10-03 (005 research R1). */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** `maxTurns` theo loại phiên (tech-defaults mục 2). */
export const MAX_TURNS = { main: 60, frame: 30, producer: 10, critic: 10, ops: 10 } as const;

import { EXTENSIONS_DIR } from '../paths.js';
export { EXTENSIONS_DIR };
export const STUDIOFLOW_CORE_PLUGIN = path.join(EXTENSIONS_DIR, 'studioflow-core');

/** `SessionOptions` (D5 mục 1) cho một loại phiên. */
export function sessionOptionsFor(
  kind: SessionContext['kind'],
  context: SessionContext,
  gateway: Gateway,
  extra: { model?: string; resume?: string; plugins?: string[] } = {},
): SessionOptions {
  const plugins =
    kind === 'critic' || kind === 'ops'
      ? []
      : [
          STUDIOFLOW_CORE_PLUGIN,
          ...(extra.plugins ?? []),
          path.join(context.channel_dir, 'profile'),
        ];
  return {
    kind,
    context: { ...context, kind },
    model: extra.model ?? DEFAULT_MODEL,
    systemAppend: systemAppendFor({ ...context, kind }),
    plugins,
    tools: toolPolicy(kind, gateway, [context.channel_dir, ...plugins]),
    ...(extra.resume ? { resume: extra.resume } : {}),
    maxTurns: MAX_TURNS[kind],
    telemetry: { traceparent: '' },
  };
}

/** Biến môi trường của phiên Claude Code bao ngoài (khi dev) không được lọt vào tiến trình SDK. */
const HOST_ENV =
  /^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PID|CLAUDE_EFFORT|AI_AGENT|ANTHROPIC_API_KEY$)/;

export function cleanEnv(
  env: Record<string, string | undefined>,
  apiKey?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !HOST_ENV.test(k)) out[k] = v;
  if (apiKey) out.ANTHROPIC_API_KEY = apiKey;
  return out;
}

/** Ánh xạ `SessionOptions` → tùy chọn Claude Agent SDK (tech-defaults mục 2, D5 mục 3). */
export function buildSdkOptions(
  o: SessionOptions,
  deps: {
    gateway: Gateway;
    env: Record<string, string | undefined>;
    apiKey?: string;
    resume?: string;
  },
): Options {
  const ctx = o.context;
  const cwd = ctx.video_id ? path.join(ctx.channel_dir, 'videos', ctx.video_id) : ctx.channel_dir;
  const resume = deps.resume ?? o.resume;
  return {
    cwd,
    model: o.model,
    settingSources: [],
    plugins: o.plugins.map((p) => ({ type: 'local' as const, path: p })),
    mcpServers: {
      sf: { type: 'sdk', name: 'sf', instance: createMcpServer(deps.gateway, ctx) as never },
    },
    allowedTools: o.tools.allowed,
    disallowedTools: RUNTIME_DISALLOWED,
    permissionMode: 'default',
    canUseTool: makeCanUseTool(o.tools) as Options['canUseTool'],
    systemPrompt: { type: 'preset', preset: 'claude_code', append: o.systemAppend },
    maxTurns: o.maxTurns,
    includePartialMessages: true,
    env: cleanEnv(deps.env, deps.apiKey),
    ...(resume ? { resume } : {}),
  };
}
