import type { AgentRuntime } from '../contracts/types.js';
import type { Gateway } from '../gateway/gateway.js';
import { ClaudeAgentRuntime } from './claude.js';
import { RecordReplayRuntime } from './replay.js';

/**
 * Runtime của app: Claude Agent SDK; khi `SF_LLM` = `record`/`replay` (test, D12) bọc lớp ghi/phát
 * lại với thư mục bản ghi `fixtureDir` (mặc định `SF_LLM_FIXTURES`).
 */
export function createRuntime(opts: {
  gateway: Gateway;
  fixtureDir?: string;
  getApiKey?: () => Promise<string | undefined>;
}): AgentRuntime {
  const claude = new ClaudeAgentRuntime({ gateway: opts.gateway, getApiKey: opts.getApiKey });
  const mode = process.env.SF_LLM;
  if (mode === 'record' || mode === 'replay') {
    const fixtureDir = opts.fixtureDir ?? process.env.SF_LLM_FIXTURES;
    if (!fixtureDir) throw new Error('SF_LLM is set but no fixture directory (SF_LLM_FIXTURES)');
    return new RecordReplayRuntime(claude, {
      fixtureDir,
      mode,
      replayToolsFor: ['frame'],
      callTool: (ctx, name, input) => opts.gateway.call(ctx, name, input),
    });
  }
  return claude;
}

export { ClaudeAgentRuntime, renderUserMessage, type ClaudeRuntimeDeps } from './claude.js';
export { RecordReplayRuntime } from './replay.js';
export { mapSdkMessage, agentErrorFrom } from './events.js';
export {
  toolPolicy,
  makeCanUseTool,
  RUNTIME_BUILTINS,
  RUNTIME_DISALLOWED,
  type CanUseToolFn,
} from './policy.js';
export {
  sessionOptionsFor,
  buildSdkOptions,
  cleanEnv,
  DEFAULT_MODEL,
  MAX_TURNS,
  STUDIOFLOW_CORE_PLUGIN,
  EXTENSIONS_DIR,
} from './options.js';
export { systemAppendFor, SYSTEM_APPEND_BASE } from './system-append.js';
