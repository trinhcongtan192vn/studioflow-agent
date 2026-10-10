import type { AgentRuntime } from '../contracts/types.js';
import type { Gateway } from '../gateway/gateway.js';
import { ClaudeAgentRuntime } from './claude.js';
import { RecordReplayRuntime } from './replay.js';
import { FallbackRuntime } from './fallback.js';
import { createCodexPlan, fallbackSettings } from './fallback-settings.js';
import type { CodexPlanRuntime } from './codex.js';
import { readFileSync } from 'node:fs';
import { isId } from '../domain/ids.js';

/**
 * Runtime của app: Claude Agent SDK; khi `SF_LLM` = `record`/`replay` (test, D12) bọc lớp ghi/phát
 * lại với thư mục bản ghi `fixtureDir` (mặc định `SF_LLM_FIXTURES`).
 */
export function createRuntime(opts: {
  gateway: Gateway;
  fixtureDir?: string;
  getApiKey?: () => Promise<string | undefined>;
  appDataDir?: string;
  codex?: CodexPlanRuntime;
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
  return new FallbackRuntime(claude, opts.codex ?? createCodexPlan(opts.gateway, opts.appDataDir), {
    enabled: () => fallbackSettings(opts.appDataDir).enabled,
    history: (o) => {
      if (o.kind !== 'main' || !isId('ss', o.context.session_id)) return '';
      const rel = o.context.video_id
        ? `videos/${o.context.video_id}/chat/${o.context.session_id}.jsonl`
        : `chat/${o.context.session_id}.jsonl`;
      try {
        return readFileSync(opts.gateway.storeFor(o.context.channel_dir).abs(rel), 'utf8').slice(
          -64_000,
        );
      } catch {
        return '';
      }
    },
  });
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
