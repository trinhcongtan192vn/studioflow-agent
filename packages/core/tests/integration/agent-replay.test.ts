// 005 · US4 · FR-008 — ghi/phát lại phiên agent (D12 mục 2).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCore,
  RecordReplayRuntime,
  sessionOptionsFor,
  type AgentEvent,
  type AgentRuntime,
  type SessionContext,
} from '../../src/index.js';
import { LIVE_PROMPT } from '../agent-helpers.js';
import { coreDir } from '../helpers.js';
import { fixtureChannel, fixtureVideoId, tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function fakeRuntime(script: AgentEvent[]): AgentRuntime & { sends: number } {
  const rt = {
    id: 'fake',
    sends: 0,
    authStatus: async () => ({ ok: true, method: 'none' as const }),
    openSession: async () => ({
      id: 'sess',
      async *send() {
        rt.sends++;
        yield* script;
      },
      interrupt: async () => {},
      close: async () => {},
    }),
  };
  return rt;
}

const collect = async (it: AsyncIterable<AgentEvent>) => {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

// Cùng bộ tool với phiên thật đã ghi (Gateway của createCore: tool nền + job.* + graph.*).
const gw = createCore({ dbFile: ':memory:', start: false }).gateway;
function ctxAt(channel: string): SessionContext {
  return {
    session_id: 'ss_test0001',
    kind: 'main',
    channel_dir: channel,
    video_id: fixtureVideoId,
  };
}

describe('RecordReplayRuntime (005 US4)', () => {
  const events: AgentEvent[] = [
    { type: 'text_delta', text: 'Ba' },
    { type: 'done', stop_reason: 'end_turn' },
  ];

  it('record writes a fixture, replay reads it without calling the runtime', async () => {
    const t = tempDir('llm-');
    cleanups.push(t.cleanup);
    const inner = fakeRuntime(events);
    const rec = new RecordReplayRuntime(inner, { fixtureDir: t.dir, mode: 'record' });
    const s1 = await rec.openSession(sessionOptionsFor('main', ctxAt(fixtureChannel), gw));
    expect(await collect(s1.send({ text: 'Có bao nhiêu line?' }))).toEqual(events);
    expect(readdirSync(t.dir)).toHaveLength(1);

    const inner2 = fakeRuntime([]);
    const rep = new RecordReplayRuntime(inner2, { fixtureDir: t.dir, mode: 'replay' });
    // đường dẫn kênh khác (ví dụ thư mục tạm) không ảnh hưởng khóa
    const s2 = await rep.openSession(
      sessionOptionsFor('main', ctxAt(path.join(t.dir, 'khác')), gw),
    );
    expect(await collect(s2.send({ text: 'Có bao nhiêu line?' }))).toEqual(events);
    expect(inner2.sends).toBe(0);
  });

  it('replay with no fixture yields an E_LLM_FIXTURE_MISSING error event', async () => {
    const t = tempDir('llm-');
    cleanups.push(t.cleanup);
    const rep = new RecordReplayRuntime(fakeRuntime([]), { fixtureDir: t.dir, mode: 'replay' });
    const s = await rep.openSession(sessionOptionsFor('main', ctxAt(fixtureChannel), gw));
    expect(await collect(s.send({ text: 'chưa ghi' }))).toEqual([
      {
        type: 'error',
        code: 'E_LLM_FIXTURE_MISSING',
        message: expect.stringContaining('SF_LLM=record'),
      },
    ]);
  });

  it('the conversation history is part of the key', async () => {
    const t = tempDir('llm-');
    cleanups.push(t.cleanup);
    const rec = new RecordReplayRuntime(fakeRuntime(events), { fixtureDir: t.dir, mode: 'record' });
    const s = await rec.openSession(sessionOptionsFor('main', ctxAt(fixtureChannel), gw));
    await collect(s.send({ text: 'một' }));
    await collect(s.send({ text: 'một' }));
    expect(readdirSync(t.dir)).toHaveLength(2);
  });

  it('replays a recorded real Claude session (fixture from SF_LLM=record)', async () => {
    const dir = path.join(coreDir, 'tests', 'fixtures', 'llm', 'agent');
    const rep = new RecordReplayRuntime(fakeRuntime([]), { fixtureDir: dir, mode: 'replay' });
    const s = await rep.openSession(sessionOptionsFor('main', ctxAt(fixtureChannel), gw));
    const ev = await collect(s.send({ text: LIVE_PROMPT }));
    expect(ev.some((e) => e.type === 'tool_call' && e.name === 'mcp__sf__artifact_read')).toBe(
      true,
    );
    expect(ev.at(-1)).toMatchObject({ type: 'done' });
  });
});
