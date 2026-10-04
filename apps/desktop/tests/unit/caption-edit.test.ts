// 026 · FR-ST-05 — thao tác bảng caption: kéo mép (bước 10 ms, bám từ ±40 ms, không chồng), tách/gộp,
// sửa chữ, hoàn tác.
import { describe, expect, it } from 'vitest';
import {
  canSplit,
  dragEdge,
  groupAt,
  History,
  mergeNext,
  newGroupId,
  setText,
  split,
  type Line,
  type PanelState,
} from '../../src/renderer/caption-edit';

const line: Line = {
  line_id: 'ln_2r7c4kxm',
  start_ms: 300,
  duration_ms: 1300,
  words: ['Năm', '1428,', 'Lê', 'Lợi', 'lên', 'ngôi.'].map((text, i) => ({
    text,
    start_ms: i * 200,
    end_ms: i * 200 + 150,
  })),
};
const base = (): PanelState => ({
  groups: [
    {
      id: 'cg_aaaaaaaa',
      line_id: line.line_id,
      word_range: [0, 1],
      text: 'Năm 1428,',
      start_ms: 300,
      end_ms: 650,
    },
    {
      id: 'cg_bbbbbbbb',
      line_id: line.line_id,
      word_range: [2, 5],
      text: 'Lê Lợi lên ngôi.',
      start_ms: 700,
      end_ms: 1450,
      emphasis: [2, 3],
    },
  ],
  overrides: { schema_version: 1, video_id: 'vd_8m2pq7rt', groups: {}, splits: [], merges: [] },
});

describe('caption panel edits (026)', () => {
  it('drag: 10 ms steps, snaps to word edges within 40 ms, blocked by the neighbour and line audio', () => {
    const s = base();
    expect(dragEdge(s, [line], 'cg_aaaaaaaa', 'end', 583).groups[0]!.end_ms).toBe(580);
    // bám mốc từ gần nhất trong ±40 ms: cuối '1428,' = 650, đầu 'Lê' = 700 (cũng là đầu cụm kề)
    expect(dragEdge(s, [line], 'cg_aaaaaaaa', 'end', 668).groups[0]!.end_ms).toBe(650);
    expect(dragEdge(s, [line], 'cg_aaaaaaaa', 'end', 690).groups[0]!.end_ms).toBe(700);
    expect(dragEdge(s, [line], 'cg_aaaaaaaa', 'end', 900).groups[0]!.end_ms).toBe(700);
    expect(dragEdge(s, [line], 'cg_aaaaaaaa', 'start', 0).groups[0]!.start_ms).toBe(300);
    expect(dragEdge(s, [line], 'cg_bbbbbbbb', 'end', 5000).groups[1]!.end_ms).toBe(1600);
    expect(dragEdge(s, [line], 'cg_bbbbbbbb', 'start', 2000).groups[1]!.start_ms).toBe(1440);
    const d = dragEdge(s, [line], 'cg_bbbbbbbb', 'start', 763);
    expect(d.groups[1]!.start_ms).toBe(760);
    expect(d.overrides.groups).toEqual({ cg_bbbbbbbb: { start_ms: 760 } });
    expect(s.groups[1]!.start_ms).toBe(700); // không đổi trạng thái cũ
  });

  it('split at a word, then merge back; overrides record splits/merges and explicit edges', () => {
    const s = split(base(), [line], 'cg_bbbbbbbb', 4, 'cg_cccccccc');
    expect(s.groups.map((g) => [g.id, g.text, g.start_ms, g.end_ms])).toEqual([
      ['cg_aaaaaaaa', 'Năm 1428,', 300, 650],
      ['cg_bbbbbbbb', 'Lê Lợi', 700, 1050],
      ['cg_cccccccc', 'lên ngôi.', 1100, 1450],
    ]);
    expect(s.groups[1]!.emphasis).toEqual([2, 3]);
    expect(s.overrides.splits).toEqual([
      { group_id: 'cg_bbbbbbbb', at_word: 4, new_id: 'cg_cccccccc' },
    ]);
    expect(canSplit(s, 'cg_bbbbbbbb', 2)).toBe(false);
    const m = mergeNext(s, 'cg_bbbbbbbb', 'cg_dddddddd');
    expect(m.groups[1]).toMatchObject({
      id: 'cg_dddddddd',
      text: 'Lê Lợi lên ngôi.',
      start_ms: 700,
      end_ms: 1450,
      word_range: [2, 5],
    });
    expect(m.overrides.merges).toEqual([
      { group_ids: ['cg_bbbbbbbb', 'cg_cccccccc'], new_id: 'cg_dddddddd' },
    ]);
    expect(m.overrides.groups).toEqual({ cg_dddddddd: { start_ms: 700, end_ms: 1450 } });
    // cụm gộp không tách lại được (tách áp trước gộp)
    expect(canSplit(m, 'cg_dddddddd', 4)).toBe(false);
  });

  it('text edit only changes display text; history undo/redo; ids and playhead lookup', () => {
    const h = new History(base());
    h.push(setText(h.current, 'cg_aaaaaaaa', 'NĂM 1428'));
    expect(h.current.overrides.groups).toEqual({ cg_aaaaaaaa: { text: 'NĂM 1428' } });
    expect(h.undo().groups[0]!.text).toBe('Năm 1428,');
    expect(h.redo().groups[0]!.text).toBe('NĂM 1428');
    expect(newGroupId(new Set(['cg_00000000']), () => 0.99)).toBe('cg_zzzzzzzz');
    expect(groupAt(base().groups, 680)?.id).toBe('cg_aaaaaaaa');
    expect(groupAt(base().groups, 800)?.id).toBe('cg_bbbbbbbb');
  });
});
