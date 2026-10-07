import type { AgentRuntime, AgentSession, SessionOptions } from '../contracts/types.js';
import type { ChatLine } from '../ipc/schema.js';
import type { WriteStore } from '../store/writer.js';

/** Thư mục nhật ký phiên con của video (D3 5.16, 048): `videos/<vd>/sessions/<ss>.jsonl`. */
export const sessionLogRel = (videoId: string | undefined, sessionId: string): string =>
  videoId ? `videos/${videoId}/sessions/${sessionId}.jsonl` : `sessions/${sessionId}.jsonl`;

/**
 * 048 (FR-AP-14): nhật ký mọi phiên agent không phải `main` (frame, producer, critic…) — cùng định dạng
 * dòng chat (D3 5.16) để xem lại như lịch sử chat; phiên `main` đã được host ghi vào `chat/`.
 * Sự kiện chuyển nguyên vẹn cho người gọi; ghi nhật ký là cố gắng tối đa (lỗi ghi không làm hỏng phiên).
 */
export function recordSessions(
  runtime: AgentRuntime,
  storeFor: (channelDir: string) => WriteStore,
): AgentRuntime {
  return {
    id: runtime.id,
    authStatus: () => runtime.authStatus(),
    async openSession(opts: SessionOptions): Promise<AgentSession> {
      const session = await runtime.openSession(opts);
      if (opts.kind === 'main') return session;
      const ctx = opts.context;
      const rel = sessionLogRel(ctx.video_id, session.id);
      const write = (line: Omit<ChatLine, 'ts'>) => {
        try {
          storeFor(ctx.channel_dir).appendLine(
            rel,
            JSON.stringify({ ts: new Date().toISOString(), ...line }),
            { by: 'session-log' },
          );
        } catch {
          /* nhật ký là phụ — không chặn phiên */
        }
      };
      write({
        role: 'system',
        content: `Phiên ${opts.kind}${ctx.frame_id ? ` · frame ${ctx.frame_id}` : ''} · model ${opts.model}`,
        session: {
          id: session.id,
          kind: opts.kind,
          ...(ctx.video_id ? { video_id: ctx.video_id } : {}),
          ...(ctx.frame_id ? { frame_id: ctx.frame_id } : {}),
        },
      });
      return {
        id: session.id,
        interrupt: () => session.interrupt(),
        close: () => session.close(),
        async *send(message) {
          write({ role: 'user', content: message.text });
          let text = '';
          const calls = new Map<string, { name: string; input: unknown }>();
          let usage: { input_tokens: number; output_tokens: number } | undefined;
          const flush = () => {
            if (text.trim()) write({ role: 'assistant', content: text });
            text = '';
          };
          try {
            for await (const e of session.send(message)) {
              if (e.type === 'text_delta') text += e.text;
              else if (e.type === 'tool_call') {
                flush();
                calls.set(e.id, { name: e.name, input: e.input });
              } else if (e.type === 'tool_result') {
                const c = calls.get(e.id);
                write({
                  role: 'tool',
                  content: e.summary,
                  tool: {
                    name: c?.name ?? '?',
                    input: c?.input,
                    output_summary: e.summary,
                    ok: e.ok,
                  },
                });
              } else if (e.type === 'usage')
                usage = { input_tokens: e.input_tokens, output_tokens: e.output_tokens };
              else if (e.type === 'error') {
                flush();
                write({ role: 'system', content: `Lỗi ${e.code}: ${e.message}` });
              } else if (e.type === 'done') {
                flush();
                write({
                  role: 'system',
                  content: `Kết thúc: ${e.stop_reason}`,
                  ...(usage ? { usage } : {}),
                });
              }
              yield e;
            }
          } finally {
            flush();
          }
        },
      };
    },
  };
}
