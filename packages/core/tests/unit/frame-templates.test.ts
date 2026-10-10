// 086 · FR-FB-86-01/02 — frame dựng từ mẫu: chọn mẫu, hợp đồng frame worker, màu đọc được.
import { describe, expect, it } from 'vitest';
import { checkFrameFile, type FramePacket } from '../../src/index.js';
import { loadOutputProfile } from '../../src/hf/outputs.js';
import {
  contentBox,
  contrast,
  fitFontSize,
  parseDesignTokens,
  LAYOUTS,
  pickTemplate,
  readable,
  templateFrame,
  wrapLines,
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
    expect(pickTemplate(packet('Hook', [text('el_aaaaaaa1', 'ĐIỂM ≠ Ý ĐỊNH')]))).toBe('split-text');
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

  it('088: Vietnamese capitals wrap by word and fit with room for diacritics', () => {
    // vd_rbxtpyp5: "NHIỀU ĐIỂM HƠN" 211 px tràn mép trên vùng an toàn của Short
    const box = contentBox(loadOutputProfile('yt-shorts-1080x1920'), true);
    expect(box.y).toBe(Math.round(1920 * 0.08) + 24);
    const size = fitFontSize('NHIỀU ĐIỂM HƠN', box, 270);
    expect(size).toBeLessThan(211);
    expect(wrapLines('NHIỀU ĐIỂM HƠN', size, box.w * 0.88) * size * 1.35).toBeLessThanOrEqual(
      box.h * 0.85,
    );
    // một từ dài hơn dòng → không vừa
    expect(wrapLines('Supercalifragilistic', 200, 500)).toBe(Infinity);
  });

  it('v2: every layout with its images is a valid frame; image layouts without an image fall back to text', () => {
    const tokens = parseDesignTokens('- canvas: #101418\n- accent (nhấn): #e8b04a\n');
    const img = (id: string, kind = 'background') =>
      ({ id, kind, asset_id: `as_${id.slice(3)}` }) as never;
    const withAssets = (p: FramePacket, ids: string[]) =>
      ({
        ...p,
        assets: ids.map((id) => ({
          asset_id: `as_${id.slice(3)}`,
          file: `public/as_${id.slice(3)}.png`,
          width: 1024,
          height: 1024,
          alpha: false,
        })),
      }) as FramePacket;
    const texts = (layout: string) =>
      layout === 'list' || layout === 'chart-bar'
        ? [
            text('el_aaaaaaa1', 'Tốc độ: 42'),
            text('el_aaaaaaa2', 'Độ bền: 87'),
            text('el_aaaaaaa3', 'Giá: 15'),
          ]
        : layout === 'stat-pop'
          ? [text('el_aaaaaaa1', '87%'), text('el_aaaaaaa2', 'người dùng')]
          : [text('el_aaaaaaa1', 'Cao su lưu hóa'), text('el_aaaaaaa2', 'Charles Goodyear')];
    for (const profileId of ['yt-1080p30', 'yt-shorts-1080x1920'])
      for (const layout of LAYOUTS) {
        const layers = [
          img('el_bbbbbbb1'),
          ...(layout === 'image-split' ? [img('el_bbbbbbb2', 'image')] : []),
          ...texts(layout),
        ];
        const p = withAssets(
          {
            ...packet(`${layout}. x`, layers),
            frame: { ...packet('', layers).frame, layout },
          } as FramePacket,
          layers.filter((l: { asset_id?: string }) => l.asset_id).map((l: { id: string }) => l.id),
        );
        const html = templateFrame(p, loadOutputProfile(profileId), tokens, {
          karaoke: profileId.includes('shorts'),
        });
        expect(pickTemplate(p), layout).toBe(layout);
        expect(
          checkFrameFile(
            html,
            'fr_aaaaaaaa',
            layers.map((l: { id: string }) => l.id),
          ),
          `${profileId} ${layout}`,
        ).toEqual([]);
        expect(html).not.toMatch(/autoAlpha|visibility|Math\.random|Date\.now/);
        // ảnh có mặt (layout ảnh: tràn khung / hai cột; layout chữ: nền mờ sau lớp tối)
        expect(html).toContain('src="public/as_bbbbbbb1.png"');
      }
    // layout cần ảnh mà ảnh chưa có (sinh lỗi) → bản chữ tương ứng
    const noImg = { ...packet('', [text('el_aaaaaaa1', 'Ảnh lỗi')]) } as FramePacket;
    for (const [layout, fallback] of [
      ['image-title', 'big-text'],
      ['image-caption', 'big-text'],
      ['image-zoom-detail', 'big-text'],
      ['image-split', 'split-text'],
    ] as const)
      expect(pickTemplate({ ...noImg, frame: { ...noImg.frame, layout } } as FramePacket)).toBe(
        fallback,
      );
  });

  it('v2: accent word is coloured; the mouth layer sits at the character mouth anchor', () => {
    const tokens = parseDesignTokens('- canvas: #101418\n- accent (nhấn): #e8b04a\n');
    const p = packet('big-text', [
      {
        id: 'el_aaaaaaa1',
        kind: 'text',
        text: 'Không phát minh, mà thấu hiểu',
        notes: 'accent: thấu hiểu',
      } as never,
      { id: 'el_mmmmmmm1', kind: 'mouth', notes: 'anchor: 0.4,0.3' } as never,
    ]);
    const W = 1920;
    const html = templateFrame(p, loadOutputProfile('yt-1080p30'), tokens, { karaoke: false });
    expect(html).toMatch(/<span style="color:#e8b04a">thấu hiểu<\/span>/);
    expect(html).toContain(
      `left: ${Math.round(0.4 * W - W * 0.03)}px; top: ${Math.round(0.3 * 1080 - W * 0.018)}px`,
    );
  });

  it('scene: background with camera motion, cut-out actors placed, entering and moving; no images → text layout', () => {
    const tokens = parseDesignTokens('- canvas: #101418\n');
    const layers = [
      {
        id: 'el_bbbbbbb1',
        kind: 'background',
        asset_id: 'as_bbbbbbb1',
      },
      {
        id: 'el_ccccccc1',
        kind: 'object',
        asset_id: 'as_ccccccc1',
        notes: 'actor: cast=c1; x=0.3; size=0.8; facing=left; enter=left; action=walk',
      },
      { id: 'el_aaaaaaa1', kind: 'text', text: 'Năm 1839' },
    ] as never;
    const p = {
      ...packet('scene', layers),
      frame: { ...packet('scene', layers).frame, layout: 'scene', motion: 'pan-right' },
      assets: [
        { asset_id: 'as_bbbbbbb1', file: 'public/bg.png', width: 1920, height: 1088, alpha: false },
        { asset_id: 'as_ccccccc1', file: 'public/c1.png', width: 768, height: 1344, alpha: true },
      ],
    } as unknown as FramePacket;
    expect(pickTemplate(p)).toBe('scene');
    const html = templateFrame(p, loadOutputProfile('yt-1080p30'), tokens, { karaoke: false });
    // nền: pan phải; nhân vật cao 80% khung, tâm ở 30% bề rộng, quay trái, đi vào từ trái và bước đi
    expect(html).toContain('xPercent: -3 }, { scale: 1.15, xPercent: 3');
    const h = Math.round(1080 * 0.8);
    const w = Math.round((h * 768) / 1344);
    expect(html).toContain(
      `left: ${Math.round(0.3 * 1920 - w / 2)}px; top: ${1080 - h + 22}px; width: ${w}px; height: ${h}px`,
    );
    expect(html).toMatch(/fr_aaaaaaaa-el_ccccccc1-flip \{[^}]*scaleX\(-1\)/);
    expect(html).toContain('tl.fromTo(".fr_aaaaaaaa-el_ccccccc1-move", { x: -864, opacity: 1 }');
    expect(html).toContain('.fr_aaaaaaaa-el_ccccccc1-walk", { x: 96 }, { x: -96');
    expect(html).toContain('Năm 1839');
    // ảnh chưa sinh được → layout chữ
    expect(pickTemplate({ ...p, assets: [] } as FramePacket)).toBe('big-text');
  });
});
