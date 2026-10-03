import path from 'node:path';
import type {
  AgentEvent,
  AgentRuntime,
  AgentSession,
  SessionOptions,
  UserMessage,
} from '../contracts/types.js';
import { llmCall, LlmFixtureError, type LlmMode } from '../testing/llm-replay.js';
import { renderUserMessage } from './claude.js';

/**
 * Ghi/phát lại phiên agent (D12 mục 2): khóa = loại phiên, model, chỉ dẫn hệ thống, tên plugin,
 * tool cho phép và lịch sử tin nhắn của phiên — không gồm đường dẫn tuyệt đối.
 */
export class RecordReplayRuntime implements AgentRuntime {
  readonly id: string;

  constructor(
    private readonly inner: AgentRuntime,
    private readonly opts: { fixtureDir: string; mode?: LlmMode },
  ) {
    this.id = `${inner.id}+${opts.mode ?? process.env.SF_LLM ?? 'replay'}`;
  }

  authStatus() {
    return this.inner.authStatus();
  }

  async openSession(o: SessionOptions): Promise<AgentSession> {
    const history: string[] = [];
    let innerSession: AgentSession | undefined;
    const { fixtureDir, mode } = this.opts;
    const inner = this.inner;
    return {
      id: o.context.session_id,
      async *send(message: UserMessage): AsyncIterable<AgentEvent> {
        history.push(renderUserMessage(message));
        const request = {
          kind: o.kind,
          model: o.model,
          systemAppend: o.systemAppend,
          plugins: o.plugins.map((p) => path.basename(p)),
          allowed: o.tools.allowed,
          history: [...history],
        };
        try {
          const events = await llmCall(
            request,
            async () => {
              innerSession ??= await inner.openSession(o);
              const out: AgentEvent[] = [];
              for await (const e of innerSession.send(message)) out.push(e);
              return out;
            },
            { fixtureDir, mode },
          );
          yield* events;
        } catch (e) {
          if (e instanceof LlmFixtureError)
            yield { type: 'error', code: e.code, message: e.message };
          else throw e;
        }
      },
      interrupt: async () => innerSession?.interrupt(),
      close: async () => innerSession?.close(),
    };
  }
}
