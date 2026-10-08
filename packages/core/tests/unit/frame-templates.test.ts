// 086 · FR-FB-86-01/02 — frame dựng từ mẫu: chọn mẫu, hợp đồng frame worker, màu đọc được.
import { describe, expect, it } from 'vitest';
import { checkFrameFile, type FramePacket } from '../../src/index.js';
import { loadOutputProfile } from '../../src/hf/outputs.js';
import {
  contrast,
  parseDesignTokens,
  pickTemplate,
  readable,
  templateFrame,
} from '../../src/hf/templates.js';

const packet = (intent: string, layers: FramePacket['frame']['layers']): FramePacket =>
  ({
    video_id: 'vd_aaaaaaaa',
    frame: {
      id: 'fr_aaaaaaaa',
      scene_id: 'sc_aaaaaaaa',
      order: 1,
      beat_ids: [],
      line_ids: [],
      intent,
      layers,
    },
    scene: { id: 'sc_aaaaaaaa', order: 1, title: 'S', frame_ids: ['fr_aaaaaaaa'] },
    lines: [],
    timing: { start_ms: 0, duration_ms: 3200 },
    design_system: 'frame.md',
    assets: [],
    output_path: 'compositions/frames/fr_aaaaaaaa.html',
    rules: [],
  }) as unknown as FramePacket;

const text = (id: string, t: string) => ({ id, kind: 'text', text: t }) as never;

describe('template frames (086)', () => {
  it('picks the template from the intent, else from the layers', () => {
    expect(pickTemplate(packet('stat-pop. Con số bật lên', [text('el_aaaaaaa1', 'x')]))).toBe(
      'stat-pop',
    );
    expect(pickTemplate(packet('Hook', [text('el_aaaaaaa1', 'ĐIỂM ≠ Ý ĐỊNH')]))).toBe(
      'split-reveal',
    );
    expect(pickTemplate(packet('Hook', [text('el_aaaaaaa1', '87%')]))).toBe('stat-pop');
    expect(
      pickTemplate(
        packet('Hook', [
          text('el_aaaaaaa1', 'a'),
          text('el_aaaaaaa2', 'b'),
          text('el_aaaaaaa3', 'c'),
        ]),
      ),
    ).toBe('list');
    expect(pickTemplate(packet('Mở đầu', [text('el_aaaaaaa1', 'Một câu chữ lớn')]))).toBe(
      'big-text',
    );
  });

  it('every template writes a valid frame file with one data-sf-id per layer', () => {
    const tokens = parseDesignTokens('## Màu\n- canvas: #101418\n- accent (nhấn): #e8b04a\n');
    for (const profileId of ['yt-1080p30', 'yt-shorts-1080x1920'])
      for (const p of [
        packet('big-text', [text('el_aaaaaaa1', 'AI tự đâm cháy thuyền')]),
        packet('stat-pop', [text('el_aaaaaaa1', 'NHIỀU ĐIỂM HƠN')]),
        packet('split-reveal', [text('el_aaaaaaa1', 'ĐIỂM ≠ Ý ĐỊNH')]),
        packet('split-reveal', [text('el_aaaaaaa1', 'Điểm'), text('el_aaaaaaa2', 'Ý định')]),
        packet('list', [
          text('el_aaaaaaa1', 'Một'),
          text('el_aaaaaaa2', 'Hai'),
          text('el_aaaaaaa3', 'Ba'),
        ]),
        packet('big-text', [
          { id: 'el_bbbbbbb1', kind: 'background' } as never,
          text('el_aaaaaaa1', 'Thuyền'),
          { id: 'el_ccccccc1', kind: 'shape', notes: 'thuyền cháy' } as never,
        ]),
      ]) {
        const html = templateFrame(p, loadOutputProfile(profileId), tokens, {
          karaoke: profileId.includes('shorts'),
        });
        expect(
          checkFrameFile(
            html,
            'fr_aaaaaaaa',
            p.frame.layers.map((l) => l.id),
          ),
        ).toEqual([]);
        expect(html).toContain('window.__timelines["fr_aaaaaaaa"] = tl;');
        expect(html).not.toMatch(/autoAlpha|visibility|Math\.random|Date\.now/);
      }
  });

  it('reads design tokens from frame.md and keeps text readable on the canvas', () => {
    const t = parseDesignTokens(
      '- canvas: #f5efe0\n- ink (chữ chính): #222222\n- accent (nhấn): #f2d27a\n- Họ font: `serif`',
    );
    expect(t).toMatchObject({
      canvas: '#f5efe0',
      ink: '#222222',
      accent: '#f2d27a',
      font: 'serif',
    });
    // vàng nhạt trên nền kem không đủ tương phản → dùng màu chữ chính
    expect(readable(t.accent, t.canvas, t.ink)).toBe('#222222');
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });
});
