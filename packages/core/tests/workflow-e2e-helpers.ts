// Hỗ trợ E2E workflow (029, 030): text giả cho script/meta, phiên frame giả viết frame hợp lệ.
import type {
  AgentEvent,
  AgentRuntime,
  Core,
  FramePacket,
  SessionContext,
  TextService,
} from '../src/index.js';
import { sampleFrame } from './frame-helpers.js';

/** Text giả: `script` trả `body`, `meta` trả JSON `meta`; critic chấm 9. */
export function stubText(body: string, meta: Record<string, unknown>): TextService {
  const usage = { input: 10, output: 5 };
  return {
    models: () => ({
      producer: { provider: 'claude', model: 'p' },
      critic: { provider: 'claude', model: 'c' },
      aux: { provider: 'claude', model: 'a' },
    }),
    generate: async (_r, input) => ({
      text: input.messages.some((m) => m.content.includes('JSON')) ? JSON.stringify(meta) : body,
      usage,
      cost_usd: 0,
      model: 'p',
    }),
    review: async (input) => ({
      score: 9,
      criteria: input.rubric.criteria.map((c) => ({ id: c.id, score: 9, weight: c.weight })),
      issues: [],
      usage,
      cost_usd: 0,
      model: 'c',
    }),
  };
}

/** Phiên frame giả: viết frame hợp lệ cho packet (ghi lại packet) và báo xong. */
export function frameRuntime(
  core: () => Core,
  packets: FramePacket[] = [],
  /** Phiên `producer` (bước có refine do agent viết, ví dụ storyboard): ghi file + báo xong. */
  producer?: (context: SessionContext) => Promise<void>,
): AgentRuntime {
  return {
    id: 'fake',
    authStatus: async () => ({ ok: true, method: 'claude-plan' }),
    async openSession(o) {
      return {
        id: o.context.session_id,
        async *send(m: { text: string }): AsyncIterable<AgentEvent> {
          if (o.kind === 'producer' && producer) {
            await producer(o.context);
            yield { type: 'done', stop_reason: 'end_turn' };
            return;
          }
          const packet = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(m.text)![1]!) as FramePacket;
          packets.push(packet);
          const step = /"step_id": "([^"]+)"/.exec(m.text)![1]!;
          await core().gateway.call(o.context, 'artifact.write', {
            path: packet.output_path,
            content: sampleFrame(packet),
          });
          await core().gateway.call(o.context, 'workflow.step_complete', {
            step_id: step,
            frame_id: packet.frame.id,
            outputs: [packet.output_path],
          });
          yield { type: 'done', stop_reason: 'end_turn' };
        },
        interrupt: async () => {},
        close: async () => {},
      };
    },
  };
}
