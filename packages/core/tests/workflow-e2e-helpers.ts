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

const LAYOUT_CYCLE = ['image-title', 'stat-pop', 'image-caption', 'big-text', 'list', 'quote'];

/**
 * Đạo diễn giả (luồng v2): đọc danh sách line trong prompt của bước `direct`, trả kế hoạch hợp lệ — một cảnh mỗi
 * line, layout xoay vòng, ảnh sinh theo prompt (ảnh thư viện kênh cho cảnh đầu nếu prompt có), nhạc theo scene.
 */
export function directorPlan(prompt: string): Record<string, unknown> {
  const lines = [...prompt.matchAll(/^(ln_[0-9a-z]{8}) · /gm)].map((m) => m[1]!);
  const lib = /^- (as_[0-9a-z]{8}):/m.exec(prompt)?.[1];
  const music = !prompt.includes('"music": null');
  // frame tùy biến bật → cảnh đầu là frame "hero" (phiên frame AI)
  const hero = prompt.includes('"hero": true');
  return {
    images: [{ key: 'img1', prompt: 'a clear blue sky over green hills, cinematic, no text' }],
    scenes: [
      {
        title: 'Scene',
        mood: 'curious',
        music: music ? 'calm curious piano' : null,
        shots: lines.map((id, i) => {
          const layout = LAYOUT_CYCLE[i % LAYOUT_CYCLE.length]!;
          return {
            line_ids: [id],
            layout,
            image: i === 0 && lib ? `asset:${lib}` : layout.startsWith('image') ? 'img1' : null,
            text:
              layout === 'stat-pop'
                ? { number: '87%', main: 'ánh sáng xanh' }
                : layout === 'list'
                  ? { items: ['Ánh sáng', 'Không khí', 'Màu xanh'] }
                  : { main: `Ý ${i + 1}`, sub: layout === 'quote' ? 'Rayleigh' : null },
            motion: 'ken-burns-in',
            transition: i ? 'crossfade' : 'cut',
            ...(hero && i === 0 ? { hero: true } : {}),
          };
        }),
      },
    ],
  };
}

const isDirector = (input: { messages: { content: string }[] }) =>
  input.messages.some((m) => m.content.includes('You are the art director'));

/** Bọc một TextService: prompt của bước `direct` → kế hoạch của `directorPlan`. */
export function withDirector(base: TextService): TextService {
  return {
    ...base,
    generate: async (role, input, scope) =>
      isDirector(input)
        ? {
            text: JSON.stringify(directorPlan(input.messages.map((m) => m.content).join('\n'))),
            usage: { input: 10, output: 5 },
            cost_usd: 0,
            model: 'claude-opus-5-5',
          }
        : base.generate(role, input, scope),
  };
}

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
      text: isDirector(input)
        ? JSON.stringify(directorPlan(input.messages.map((m) => m.content).join('\n')))
        : input.messages.some((m) => m.content.includes('JSON'))
          ? JSON.stringify(meta)
          : body,
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
