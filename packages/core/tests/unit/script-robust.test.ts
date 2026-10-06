// 036 — kịch bản: người nói phải thuộc dàn nhân vật; marker beat lệch dòng được chuẩn hóa;
// gate ném lỗi → kết quả không qua (không kẹt bước); người dẫn khai trong CAST dùng voice.id.
import { describe, expect, it } from 'vitest';
import { checkScript, evaluateGate, registerObjective, stripWrapping } from '../../src/index.js';

const doc = (speaker: string) =>
  `---\nschema_version: 1\nvideo_id: vd_8m2pq7rt\nlanguage: vi\nstatus: draft\n---\n## Mở <!-- sf:beat id=bt_4nd8w1zc -->\n\n<!-- sf:line id=ln_2r7c4kxm speaker=${speaker} -->\nChào.\n`;
const octx = { channelDir: '.', videoId: 'vd_8m2pq7rt', banned: [] };

describe('checkScript speakers_known (036)', () => {
  it('flags speakers that are not narrator or a CAST member, listing the valid ids', () => {
    const known = { ca_cg2658n8: 'Tí', ca_1qjvih0r: 'Ông nội' };
    const bad = checkScript(doc('ca_on4x8d1w'), { ...octx, speakers: known }).find(
      (r) => r.id === 'speakers_known',
    );
    expect(bad).toMatchObject({ pass: false });
    expect(bad!.detail).toContain('ca_on4x8d1w');
    expect(bad!.detail).toContain('ca_cg2658n8 (Tí)');
    expect(
      checkScript(doc('ca_cg2658n8'), { ...octx, speakers: known }).find(
        (r) => r.id === 'speakers_known',
      ),
    ).toMatchObject({ pass: true });
    expect(
      checkScript(doc('narrator'), { ...octx, speakers: known }).find(
        (r) => r.id === 'speakers_known',
      )!.pass,
    ).toBe(true);
    // không truyền danh sách (bản thuyết minh) → không kiểm
    expect(checkScript(doc('ca_on4x8d1w'), octx).some((r) => r.id === 'speakers_known')).toBe(
      false,
    );
  });
});

describe('stripWrapping beat markers (036)', () => {
  it('moves a beat marker written on its own line onto the heading', () => {
    expect(stripWrapping('<!-- sf:beat id=bt_f70mtgsy -->\n## Buổi sáng ở làng\n\nx')).toBe(
      '## Buổi sáng ở làng <!-- sf:beat id=bt_f70mtgsy -->\n\nx\n',
    );
    expect(stripWrapping('## Buổi sáng\n<!-- sf:beat -->\n\nx')).toBe(
      '## Buổi sáng <!-- sf:beat -->\n\nx\n',
    );
  });
});

describe('evaluateGate never throws (036)', () => {
  it('an objective that throws becomes a failing result', async () => {
    registerObjective('test_throws_036', () => {
      throw new Error('line 7: unexpected marker');
    });
    const r = await evaluateGate(
      { kind: 'objective', check: 'test_throws_036' } as never,
      {
        store: {} as never,
        videoId: 'vd_x',
      } as never,
    );
    expect(r).toMatchObject({ pass: false, detail: expect.stringContaining('unexpected marker') });
  });
});

describe('unknown sf markers from the producer (042)', () => {
  it('become plain comments (hint kept, script parses)', () => {
    const out = stripWrapping(
      '## Mở <!-- sf:beat id=bt_4nd8w1zc -->\n\n<!-- sf:visual text="Nền trời tối dần, đĩa đen xuất hiện." -->\n<!-- sf:line id=ln_2r7c4kxm speaker=narrator -->\nChào.\n',
    );
    expect(out).toContain('<!-- visual: Nền trời tối dần, đĩa đen xuất hiện. -->');
    expect(out).toContain('<!-- sf:beat id=bt_4nd8w1zc -->');
    expect(out).toContain('<!-- sf:line id=ln_2r7c4kxm speaker=narrator -->');
    const doc = `---\nschema_version: 1\nvideo_id: vd_8m2pq7rt\nlanguage: vi\nstatus: draft\n---\n${out}`;
    expect(checkScript(doc, octx).find((r) => r.id === 'schema')).toMatchObject({ pass: true });
  });
});
