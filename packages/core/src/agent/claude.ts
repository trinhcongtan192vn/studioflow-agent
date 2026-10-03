import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentEvent,
  AgentRuntime,
  AgentSession,
  SessionOptions,
  UserMessage,
} from '../contracts/types.js';
import type { Gateway } from '../gateway/gateway.js';
import { context, trace } from '@opentelemetry/api';
import { clean, currentTraceparent, tracer } from '../trace/trace.js';
import { agentErrorFrom, mapSdkMessage } from './events.js';
import { buildSdkOptions, cleanEnv } from './options.js';

export interface ClaudeRuntimeDeps {
  gateway: Gateway;
  /** Khóa API dự phòng từ kho bí mật (D5 mục 5.4) — chỉ đặt vào env tiến trình SDK. */
  getApiKey?: () => Promise<string | undefined>;
  query?: typeof sdkQuery;
  env?: Record<string, string | undefined>;
}

/** Tin nhắn người dùng → prompt: văn bản + đính kèm + ngữ cảnh (D5 mục 1 `UserMessage`). */
export function renderUserMessage(m: UserMessage): string {
  const parts = [m.text];
  for (const a of m.attachments ?? []) parts.push(`[Đính kèm: ${a.path} (${a.mime})]`);
  if (m.context_refs?.length) parts.push(`[Ngữ cảnh: ${JSON.stringify(m.context_refs)}]`);
  return parts.join('\n');
}

class ClaudeSession implements AgentSession {
  readonly id: string;
  private sdkSession?: string;
  private current?: { interrupt(): Promise<unknown> };

  constructor(
    private readonly opts: SessionOptions,
    private readonly deps: ClaudeRuntimeDeps,
  ) {
    this.id = opts.context.session_id;
    this.sdkSession = opts.resume;
  }

  async *send(message: UserMessage): AsyncIterable<AgentEvent> {
    const query = this.deps.query ?? sdkQuery;
    // span `sf.agent.session` (D11); tool gọi trong phiên là span con, TRACEPARENT xuống SDK
    const span = tracer().startSpan('sf.agent.session', {
      attributes: clean({
        'sf.session_kind': this.opts.kind,
        'sf.session_id': this.id,
        'sf.video_id': this.opts.context.video_id,
      }),
    });
    const ctx = trace.setSpan(context.active(), span);
    let tokensIn = 0;
    let tokensOut = 0;
    try {
      const apiKey = await this.deps.getApiKey?.();
      const tp = context.with(ctx, () => currentTraceparent());
      const q = context.with(ctx, () =>
        query({
          prompt: renderUserMessage(message),
          options: buildSdkOptions(this.opts, {
            gateway: this.deps.gateway,
            env: { ...(this.deps.env ?? process.env), ...(tp ? { TRACEPARENT: tp } : {}) },
            apiKey,
            resume: this.sdkSession,
          }),
        }),
      );
      this.current = q;
      for await (const m of q) {
        if ((m as { session_id?: string }).session_id)
          this.sdkSession = (m as { session_id: string }).session_id;
        for (const e of mapSdkMessage(m)) {
          if (e.type === 'usage') {
            tokensIn += e.input_tokens;
            tokensOut += e.output_tokens;
          }
          yield e;
        }
      }
    } catch (e) {
      span.setAttribute('sf.error', String((e as Error).message).slice(0, 300));
      yield agentErrorFrom(e);
    } finally {
      this.current = undefined;
      span.setAttributes({
        'gen_ai.usage.input_tokens': tokensIn,
        'gen_ai.usage.output_tokens': tokensOut,
      });
      span.end();
    }
  }

  async interrupt(): Promise<void> {
    await this.current?.interrupt();
  }

  async close(): Promise<void> {
    await this.interrupt().catch(() => {});
  }
}

/** Agent Runtime Port trên Claude Agent SDK (D5 mục 1, 3; tech-defaults mục 2). */
export class ClaudeAgentRuntime implements AgentRuntime {
  readonly id = 'claude-agent-sdk';

  constructor(private readonly deps: ClaudeRuntimeDeps) {}

  /** Không gửi prompt: dùng `accountInfo()` trên một luồng nhập chưa phát gì (005 research R1). */
  async authStatus(): Promise<{
    ok: boolean;
    method: 'claude-plan' | 'api-key' | 'none';
    detail?: string;
  }> {
    const query = this.deps.query ?? sdkQuery;
    const apiKey = await this.deps.getApiKey?.();
    let release: () => void = () => {};
    // eslint-disable-next-line require-yield -- luồng nhập cố ý không phát gì (chỉ hỏi accountInfo)
    const idle = (async function* () {
      await new Promise<void>((r) => (release = r));
    })();
    try {
      const q = query({
        prompt: idle as AsyncIterable<never>,
        options: {
          settingSources: [],
          allowedTools: [],
          maxTurns: 1,
          env: cleanEnv(this.deps.env ?? process.env, apiKey),
        },
      });
      const info = await Promise.race([
        q.accountInfo(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('auth check timed out')), 20_000),
        ),
      ]);
      release();
      if (info.apiKeySource && info.apiKeySource !== 'none')
        return { ok: true, method: 'api-key', detail: info.apiKeySource };
      if (info.subscriptionType)
        return { ok: true, method: 'claude-plan', detail: info.subscriptionType };
      return { ok: false, method: 'none', detail: 'not logged in to Claude and no API key' };
    } catch (e) {
      release();
      return {
        ok: false,
        method: apiKey ? 'api-key' : 'none',
        detail: String((e as Error).message),
      };
    }
  }

  async openSession(opts: SessionOptions): Promise<AgentSession> {
    return new ClaudeSession(opts, this.deps);
  }
}
