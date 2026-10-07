// 060 — model cho phiên dựng frame: frame đơn giản → model rẻ ở lần đầu; phức tạp / thử lại → model chính.
import { describe, expect, it } from 'vitest';
import type { FramePacket } from '../../src/contracts/types.js';
import { frameModel, isSimpleFrame } from '../../src/hf/frame-model.js';

const packet = (o: {
  layers?: number;
  intent?: string;
  ms?: number;
  lipsync?: boolean;
  pinned?: boolean;
  mouth?: boolean;
}): FramePacket =>
  ({
    frame: {
      id: 'fr_aaaaaaaa',
      intent: o.intent ?? 'Tiêu đề lớn giữa khung',
      layers: [
        ...Array.from({ length: o.layers ?? 2 }, (_, i) => ({
          id: `el_0000000${i}`,
          kind: 'text',
        })),
        ...(o.mouth ? [{ id: 'el_mouth001', kind: 'mouth' }] : []),
      ],
      ...(o.lipsync ? { lipsync: { cast_id: 'ca_x', mouth_anchor: 'el_mouth001' } } : {}),
    },
    timing: { start_ms: 0, duration_ms: o.ms ?? 5000 },
    ...(o.pinned ? { pinned_delta: {} } : {}),
  }) as unknown as FramePacket;

const cfg = { model: 'claude-sonnet-5-5', simple: 'claude-haiku-4-5-20251001' };

describe('frame model routing', () => {
  it('classifies simple vs complex frames', () => {
    expect(isSimpleFrame(packet({}))).toBe(true);
    expect(isSimpleFrame(packet({ layers: 4 }))).toBe(false);
    expect(isSimpleFrame(packet({ intent: 'Bản đồ Đông Nam Á với mũi tên' }))).toBe(false);
    expect(isSimpleFrame(packet({ intent: 'timeline of events' }))).toBe(false);
    expect(isSimpleFrame(packet({ ms: 12_000 }))).toBe(false);
    expect(isSimpleFrame(packet({ lipsync: true, mouth: true }))).toBe(false);
    expect(isSimpleFrame(packet({ pinned: true }))).toBe(false);
  });
  it('uses the cheap model on the first attempt of a simple frame only', () => {
    expect(frameModel(packet({}), 1, cfg)).toEqual({ model: cfg.simple, simple: true });
    expect(frameModel(packet({}), 2, cfg)).toEqual({ model: cfg.model, simple: false }); // thử lại → model chính
    expect(frameModel(packet({ layers: 5 }), 1, cfg)).toEqual({ model: cfg.model, simple: false });
    expect(frameModel(packet({}), 1, { model: cfg.model, simple: '' })).toEqual({
      model: cfg.model,
      simple: false,
    }); // tắt model rẻ
  });
});
