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
 * Ghi/phát lại phiên agent (D12 mục 2): khóa = loại phiên, model, chỉ dẫn hệ thống, tên plugin và
 * lịch sử tin nhắn của phiên — không gồm đường dẫn tuyệt đối, không gồm danh sách tool (thêm tool ở
 * tính năng sau không làm mất bản ghi; chính sách tool được kiểm riêng bằng test contract).
 */
export class RecordReplayRuntime implements AgentRuntime {
  readonly id: string;

  constructor(
    private readonly inner: AgentRuntime,
    private readonly opts: {
      fixtureDir: string;
      mode?: LlmMode;
      /**
       * Khi phát lại: gọi lại tool Gateway có tác dụng (ghi file, báo xong) của các loại phiên này
       * qua `callTool`, để test phiên `frame` chạy lại được (011 R4).
       */
      replayToolsFor?: SessionOptions['kind'][];
      callTool?: (ctx: SessionOptions['context'], name: string, input: unknown) => Promise<unknown>;
    },
  ) {
    this.id = `${inner.id}+${opts.mode ?? process.env.SF_LLM ?? 'replay'}`;
  }

  authStatus() {
    return this.inner.authStatus();
  }

  async openSession(o: SessionOptions): Promise<AgentSession> {
    const history: string[] = [];
    let innerSession: AgentSession | undefined;
    const { fixtureDir, mode, replayToolsFor, callTool } = this.opts;
    const replaying = (mode ?? process.env.SF_LLM ?? 'replay') === 'replay';
    const reexec = replaying && callTool && replayToolsFor?.includes(o.kind);
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
          for (const e of events) {
            if (reexec && e.type === 'tool_call' && e.name.startsWith('mcp__sf__')) {
              // tên MCP `mcp__sf__artifact_write` → tool `artifact.write`
              const name = e.name.slice('mcp__sf__'.length).replace('_', '.');
              await callTool!(o.context, name, e.input);
            }
            yield e;
          }
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
