// 011 · US1 · FR-003 — frame packet (D6 mục 5).
import { describe, expect, it } from 'vitest';
import { buildFramePacket, frameInstruction, loadVideoModel } from '../../src/index.js';
import { fixtureChannel, fixtureVideoId } from '../domain-helpers.js';

const timing = {
  frames: [
    { id: 'fr_9x2b7cqe', start_ms: 0, duration_ms: 4000 },
    { id: 'fr_3m8k1w7d', start_ms: 4000, duration_ms: 2500 },
  ],
  lines: [],
  total_ms: 6500,
};

describe('frame packet (011 FR-003)', () => {
  it('carries frame, scene, lines, timing, output path and rules', () => {
    const model = loadVideoModel(fixtureChannel, fixtureVideoId);
    const p = buildFramePacket({ model, timing, frameId: 'fr_9x2b7cqe', assets: [] });
    expect(p).toMatchObject({
      video_id: fixtureVideoId,
      frame: { id: 'fr_9x2b7cqe', layers: [{ id: 'el_t5w8n3ja' }, { id: 'el_q2k7m4zp' }] },
      scene: { id: 'sc_p0q2m5ka' },
      timing: { start_ms: 0, duration_ms: 4000 },
      design_system: 'frame.md',
      output_path: 'compositions/frames/fr_9x2b7cqe.html',
    });
    expect(p.lines.map((l) => l.id)).toEqual(['ln_2r7c4kxm', 'ln_9w3b6tqa']);
    expect(p.rules.join('\n')).toContain('y ≤ 896px');
    // frame 2 tham chiếu asset chưa có file → quy tắc vẽ bằng code
    const p2 = buildFramePacket({ model, timing, frameId: 'fr_3m8k1w7d', assets: [] });
    expect(p2.rules.join('\n')).toContain('el_a1b2c3d4 chưa có asset');
    const text = frameInstruction(p, '# frame.md', 'frames');
    expect(text).toContain('"frame_id": "fr_9x2b7cqe"');
    expect(text).toContain('```json');
    expect(text).toContain('# frame.md');
  });

  it('unknown frame throws', () => {
    const model = loadVideoModel(fixtureChannel, fixtureVideoId);
    expect(() => buildFramePacket({ model, timing, frameId: 'fr_zzzzzzzz', assets: [] })).toThrow();
  });
});
