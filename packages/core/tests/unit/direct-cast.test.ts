// Cảnh ghép với nhân vật đã khai báo (vd_ojl8icgh, 2026-10-10): đạo diễn tự do xin tư thế; ảnh biểu cảm có sẵn
// khớp đúng thì dùng lại (không sinh); nền/ảnh dùng chung mang khóa để graph sinh một lần.
import { parse } from 'yaml';
import { expect, it } from 'vitest';
import { directPrompt, planToStoryboard, type DirectPlan } from '../../src/workflow/direct.js';

const line = (id: string) => ({
  id,
  beat_id: 'bt_aaaaaaaa',
  beat: 'B',
  text: 't',
  speaker: 'narrator',
  ms: 2000,
});

it('existing cast: expression reused, a requested pose is generated from the reference, shared backgrounds are keyed', () => {
  const plan: DirectPlan = {
    backgrounds: [{ key: 'park', prompt: 'a grassy park' }],
    scenes: [
      {
        title: 'S',
        shots: [
          {
            line_ids: ['ln_aaaaaaa1'],
            layout: 'scene',
            background: 'park',
            actors: [{ cast: 'ca_maya0001', expression: 'happy' }],
          },
          {
            line_ids: ['ln_aaaaaaa2'],
            layout: 'scene',
            background: 'park',
            actors: [{ cast: 'ca_maya0001', pose: 'holding a small blue ball up high' }],
          },
        ],
      },
    ],
  };
  const frames = [
    {
      scene: 0,
      shot: plan.scenes[0]!.shots[0]!,
      lines: [line('ln_aaaaaaa1')],
      continuation: false,
    },
    {
      scene: 0,
      shot: plan.scenes[0]!.shots[1]!,
      lines: [line('ln_aaaaaaa2')],
      continuation: false,
    },
  ];
  const md = planToStoryboard('vd_aaaaaaaa', plan, frames, {
    aspect: '16:9',
    libraryIds: new Set(['as_happy001', 'as_mayaref1']),
    music: false,
    heroAllowed: false,
    castRefs: { ca_maya0001: ['as_mayaref1'] },
    castInfo: {
      ca_maya0001: {
        name: 'Maya',
        look: '9-year-old girl, yellow T-shirt, denim overalls',
        expressions: { happy: 'as_happy001' },
      },
    },
    lipsync: {},
  });
  const blocks = [...md.matchAll(/```sf-frame\n([\s\S]*?)\n```/g)].map(
    (m) => parse(m[1]!) as { layers: Record<string, unknown>[] },
  );
  const actor = (i: number) => blocks[i]!.layers.find((l) => l.kind === 'object')!;
  // biểu cảm có sẵn → asset_id, không yêu cầu sinh
  expect(actor(0)).toMatchObject({ asset_id: 'as_happy001' });
  expect(actor(0).asset_request).toBeUndefined();
  // tư thế riêng → sinh từ ngoại hình + ảnh chuẩn làm tham chiếu
  expect(actor(1)).toMatchObject({
    notes: expect.stringMatching(/^actor: cast=ca_maya0001/),
    asset_request: {
      transparent: true,
      prompt: expect.stringContaining('yellow T-shirt, denim overalls, holding a small blue ball'),
      reference_asset_ids: ['as_mayaref1'],
    },
  });
  // nền dùng chung: cùng khóa `bg: park` ở cả hai cảnh
  const bg = (i: number) => blocks[i]!.layers.find((l) => l.kind === 'background')!;
  expect(bg(0).notes).toBe('bg: park');
  expect(bg(1).notes).toBe('bg: park');
});

it('channel characters from earlier videos are optional for the director; the video cast is required', () => {
  const p = directPrompt({
    brief: 'b',
    language: 'en',
    width: 1080,
    height: 1920,
    lines: [line('ln_aaaaaaa1')],
    params: {},
    library: [],
    cast: [
      { id: 'ca_mine0001', name: 'Leo' },
      { id: 'ca_maya0001', name: 'Maya', optional: true },
    ],
    heroAllowed: false,
    music: false,
  });
  const own = p.indexOf('## Characters of this video');
  const opt = p.indexOf('## Channel characters from earlier videos (OPTIONAL');
  expect(own).toBeGreaterThan(-1);
  expect(opt).toBeGreaterThan(own);
  expect(p.slice(own, opt)).toContain('ca_mine0001: Leo');
  expect(p.slice(opt)).toContain('ca_maya0001: Maya');
  expect(p.slice(own, opt)).not.toContain('ca_maya0001');
});
