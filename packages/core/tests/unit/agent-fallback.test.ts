// 095 FR-AG-95-01..02
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentEvent,
  AgentRuntime,
  SessionOptions,
  UserMessage,
} from '../../src/contracts/types.js';
import { FallbackRuntime } from '../../src/agent/fallback.js';

const opts = { context: { session_id: 'ss_test' } } as unknown as SessionOptions;
function runtime(events: AgentEvent[]) {
  const messages: string[] = [];
  const close = vi.fn(async () => {});
  const rt: AgentRuntime = {
    id: 'test',
    authStatus: async () => ({ ok: true, method: 'chatgpt-plan' }),
    openSession: vi.fn(async () => ({
      id: 'ss_test',
      close,
      interrupt: close,
      async *send(m: UserMessage) {
        messages.push(m.text);
        yield* events;
      },
    })),
  };
  return { rt, messages, close };
}
const collect = async (events: AsyncIterable<AgentEvent>) => {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
};
const limit: AgentEvent = { type: 'error', code: 'E_RUNTIME_RATE_LIMIT', message: 'weekly limit' };
const done: AgentEvent = { type: 'done', stop_reason: 'end_turn' };

describe('095 plan fallback', () => {
  it('carries partial work, suppresses the handled error/done and skips Claude during cooldown', async () => {
    const p = runtime([
      { type: 'tool_call', id: '1', name: 'artifact.write', input: { path: 'x' } },
      { type: 'tool_result', id: '1', ok: true, summary: 'saved x' },
      limit,
      done,
    ]);
    const f = runtime([{ type: 'text_delta', text: 'continued' }, done]);
    let now = 0;
    const rt = new FallbackRuntime(p.rt, f.rt, { enabled: () => true, clock: () => now });
    const s = await rt.openSession(opts);
    const events = await collect(s.send({ text: 'make a video' }));
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(f.messages[0]).toContain('saved x');
    expect(f.messages[0]).toContain('make a video');
    await collect(s.send({ text: 'next' }));
    expect(p.messages).toHaveLength(1);
    now = 301_000;
    await collect(s.send({ text: 'retry Claude' }));
    expect(p.messages).toHaveLength(2);
  });
  it('does not fallback for other errors, disabled fallback, or unavailable plan auth', async () => {
    for (const mode of ['other', 'disabled', 'unavailable']) {
      const p = runtime([mode === 'other' ? { ...limit, code: 'E_INTERNAL' } : limit]);
      const f = runtime([done]);
      if (mode === 'unavailable') f.rt.authStatus = async () => ({ ok: false, method: 'none' });
      const rt = new FallbackRuntime(p.rt, f.rt, { enabled: () => mode !== 'disabled' });
      const events = await collect((await rt.openSession(opts)).send({ text: 'x' }));
      expect(events.some((e) => e.type === 'error')).toBe(true);
      expect(f.messages).toHaveLength(0);
    }
  });
  it('does not recursively fallback when Codex is also limited', async () => {
    const p = runtime([limit]);
    const f = runtime([limit]);
    const rt = new FallbackRuntime(p.rt, f.rt, { enabled: () => true });
    expect(
      (await collect((await rt.openSession(opts)).send({ text: 'x' }))).filter(
        (e) => e.type === 'error',
      ),
    ).toEqual([limit]);
    expect(f.messages).toHaveLength(1);
  });
  it('interrupt prevents switching during a pending availability check', async () => {
    const p = runtime([limit]);
    const f = runtime([done]);
    let release!: () => void;
    f.rt.authStatus = async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return { ok: true, method: 'chatgpt-plan' };
    };
    const s = await new FallbackRuntime(p.rt, f.rt, { enabled: () => true }).openSession(opts);
    const work = collect(s.send({ text: 'x' }));
    await vi.waitFor(() => expect(release).toBeDefined());
    await s.interrupt();
    release();
    await work;
    expect(f.messages).toHaveLength(0);
  });
});
