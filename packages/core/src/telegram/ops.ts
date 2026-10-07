import type { AgentRuntime, AgentSession, SessionContext } from '../contracts/types.js';
import { sessionOptionsFor } from '../agent/options.js';
import { newId } from '../domain/ids.js';
import type { Gateway } from '../gateway/gateway.js';

/**
 * Agent `ops` (055, FR-AP-12): trả lời câu hỏi vận hành qua Telegram bằng các tool chỉ-đọc/hành động của phiên
 * `ops` (D5 mục 4). Một phiên cho mỗi cuộc trò chuyện; dùng lại tối đa `MAX_QUESTIONS` câu rồi mở phiên mới
 * (giữ ngữ cảnh gọn). Runtime nên được bọc `recordSessions` để nhật ký nằm ở `ops/sessions/` (048).
 */
export const OPS_CONSTANTS = { MAX_QUESTIONS: 15 } as const;

export class OpsAgent {
  private readonly sessions = new Map<string, { session: AgentSession; used: number }>();

  constructor(
    private readonly d: {
      runtime: AgentRuntime;
      gateway: Gateway;
      /** Thư mục dữ liệu app (phiên không gắn kênh). */
      appDataDir: string;
      model?: string;
    },
  ) {}

  private async open(key: string): Promise<AgentSession> {
    const cur = this.sessions.get(key);
    if (cur && cur.used < OPS_CONSTANTS.MAX_QUESTIONS) {
      cur.used += 1;
      return cur.session;
    }
    if (cur) void cur.session.close().catch(() => {});
    const ctx: SessionContext = {
      session_id: newId('ss') as SessionContext['session_id'],
      kind: 'ops',
      channel_dir: this.d.appDataDir,
    };
    const session = await this.d.runtime.openSession(
      sessionOptionsFor('ops', ctx, this.d.gateway, this.d.model ? { model: this.d.model } : {}),
    );
    this.sessions.set(key, { session, used: 1 });
    return session;
  }

  /** Gửi câu hỏi, gom văn bản trả lời; lỗi runtime → thông báo tiếng Việt (không ném). */
  async ask(key: string, text: string): Promise<string> {
    let out = '';
    let error: string | undefined;
    try {
      const session = await this.open(key);
      for await (const e of session.send({ text })) {
        if (e.type === 'text_delta') out += e.text;
        else if (e.type === 'error') error = `${e.code}: ${e.message}`;
      }
    } catch (e) {
      error = String((e as Error)?.message ?? e);
    }
    out = out.trim();
    if (out) return out;
    // phiên lỗi → mở lại ở lần hỏi sau
    this.sessions.delete(key);
    return error ? `Mình chưa trả lời được lúc này (${error}).` : '';
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.session.close().catch(() => {})));
    this.sessions.clear();
  }
}
