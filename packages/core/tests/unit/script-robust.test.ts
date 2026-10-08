// 036 — kịch bản: người nói phải thuộc dàn nhân vật; marker beat lệch dòng được chuẩn hóa;
// gate ném lỗi → kết quả không qua (không kẹt bước); người dẫn khai trong CAST dùng voice.id.
import { describe, expect, it } from 'vitest';
import {
  assignScriptIds,
  checkScript,
  evaluateGate,
  registerObjective,
  stripWrapping,
} from '../../src/index.js';

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

describe('revise output clean-up (080, vd_rbxtpyp5)', () => {
  it('a line id invented by the model (ln_xxx_b) is replaced with a valid one', () => {
    const t = `---\nschema_version: 1\nvideo_id: vd_8m2pq7rt\nlanguage: vi\nstatus: draft\n---\n## Mở <!-- sf:beat id=bt_4nd8w1zc -->\n\n<!-- sf:line id=ln_j5u9imcg speaker=narrator -->\nMột.\n\n<!-- sf:line id=ln_j5u9imcg_b speaker=narrator -->\nHai.\n`;
    const r = assignScriptIds(t, new Set(), { seed: 'x' });
    expect(r.assigned).toHaveLength(1);
    expect(r.assigned[0]).toMatch(/^ln_[0-9a-z]{8}$/);
    expect(r.text).not.toContain('ln_j5u9imcg_b');
    expect(r.text).toContain('id=ln_j5u9imcg ');
    expect(checkScript(r.text, octx).find((x) => x.id === 'schema')).toMatchObject({ pass: true });
  });

  it('an echoed revise prompt (# Brief … # Bản nháp … # Vấn đề cần sửa) keeps only the draft', () => {
    const out = stripWrapping(
      '# Brief\nTiêu đề tạm: X\n## Nguồn\n- a\n\n# Bản nháp\n## Mở <!-- sf:beat id=bt_4nd8w1zc -->\n\n<!-- sf:line id=ln_2r7c4kxm speaker=narrator -->\nChào.\n\n# Vấn đề cần sửa\n- hook yếu\n',
    );
    expect(out).not.toMatch(/Brief|Tiêu đề tạm|Bản nháp|Vấn đề cần sửa|hook yếu/);
    expect(out.startsWith('## Mở <!-- sf:beat id=bt_4nd8w1zc -->')).toBe(true);
    expect(out).toContain('Chào.');
  });
});
