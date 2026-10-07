// 048 (FR-AP-14) — nhật ký phiên agent: mọi phiên không phải `main` (frame, producer, critic…) được ghi
// lại như lịch sử chat (`videos/<vd>/sessions/<ss>.jsonl`) để xem lại; phiên `main` đã có `chat/`.
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import type { AgentEvent, AgentRuntime, SessionOptions } from '../../src/contracts/types.js';
import { recordSessions } from '../../src/agent/recorder.js';
import { workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture | undefined;
afterEach(() => {
  fx?.cleanup();
  fx = undefined;
});

const events: AgentEvent[] = [
  { type: 'text_delta', text: 'Đang dựng ' },
  { type: 'text_delta', text: 'frame.' },
  { type: 'tool_call', id: 't1', name: 'mcp__sf__artifact_write', input: { path: 'x.html' } },
  { type: 'tool_result', id: 't1', ok: false, summary: 'E_OWNER_CONFLICT: Studio đang sửa' },
  { type: 'usage', input_tokens: 10, output_tokens: 20 },
  { type: 'done', stop_reason: 'end_turn' },
];
const fake = (id: string): AgentRuntime => ({
  id: 'fake',
  authStatus: async () => ({ ok: true, method: 'claude-plan' }),
  openSession: async () => ({
    id,
    async *send() {
      yield* events;
    },
    interrupt: async () => {},
    close: async () => {},
  }),
});
const opts = (f: WorkflowFixture, kind: SessionOptions['kind'], id: string) =>
  ({
    kind,
    context: { session_id: id, kind, channel_dir: f.dir, video_id: f.videoId },
    model: 'm',
    systemAppend: '',
    plugins: [],
    tools: { allowed: [], readRoots: [] },
  }) as unknown as SessionOptions;

it('records a frame session as chat lines (header, prompt, text, tool call + result, end)', async () => {
  fx = workflowFixture();
  const rt = recordSessions(fake('ss_frame001'), (d) => fx!.core.gateway.storeFor(d));
  const s = await rt.openSession({
    ...opts(fx, 'frame', 'ss_frame001'),
    context: { ...opts(fx, 'frame', 'ss_frame001').context, frame_id: 'fr_aaaaaaaa' },
  } as SessionOptions);
  const seen: string[] = [];
  for await (const e of s.send({ text: 'Dựng frame fr_aaaaaaaa' })) seen.push(e.type);
  expect(seen).toEqual(events.map((e) => e.type)); // sự kiện chuyển nguyên vẹn
  const f = fx.store.abs(fx.v('sessions/ss_frame001.jsonl'));
  const lines = readFileSync(f, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  expect(lines.map((l) => l.role)).toEqual(['system', 'user', 'assistant', 'tool', 'system']);
  expect(lines[0]).toMatchObject({
    session: { kind: 'frame', id: 'ss_frame001', frame_id: 'fr_aaaaaaaa' },
  });
  expect(lines[1].content).toBe('Dựng frame fr_aaaaaaaa');
  expect(lines[2].content).toBe('Đang dựng frame.');
  expect(lines[3]).toMatchObject({
    content: 'E_OWNER_CONFLICT: Studio đang sửa',
    tool: { name: 'mcp__sf__artifact_write', input: { path: 'x.html' }, ok: false },
  });
  expect(lines[4]).toMatchObject({
    content: 'Kết thúc: end_turn',
    usage: { input_tokens: 10, output_tokens: 20 },
  });
});

it('does not double-record the main session (host already logs chat/)', async () => {
  fx = workflowFixture();
  const rt = recordSessions(fake('ss_main0001'), (d) => fx!.core.gateway.storeFor(d));
  const s = await rt.openSession(opts(fx, 'main', 'ss_main0001'));
  for await (const _ of s.send({ text: 'x' })) void _;
  expect(existsSync(fx.store.abs(fx.v('sessions/ss_main0001.jsonl')))).toBe(false);
});
