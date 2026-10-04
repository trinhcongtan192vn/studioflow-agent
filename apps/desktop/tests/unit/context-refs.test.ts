// 028 · FR-CH-04 — ngữ cảnh chat từ xem trước: kho chung + chuyển kết quả studio_inspect.
import { describe, expect, it } from 'vitest';
import {
  addContextRef,
  clearContextRefs,
  contextLabel,
  onContextRefs,
  removeContextRef,
  type ContextRef,
} from '../../src/renderer/context-refs';
import { selectionRef } from '../../src/renderer/studio-bridge';

describe('context refs (028)', () => {
  it('dedupes, removes, clears and notifies', () => {
    let seen: ContextRef[] = [];
    const off = onContextRefs((r) => (seen = r));
    addContextRef({ kind: 'time', time_ms: 1500 });
    addContextRef({ kind: 'time', time_ms: 1500 });
    addContextRef({ kind: 'caption_group', id: 'cg_aaaaaaaa' });
    expect(seen.map(contextLabel)).toEqual(['Mốc 1.50 s', 'Cụm phụ đề cg_aaaaaaaa']);
    removeContextRef({ kind: 'time', time_ms: 1500 });
    expect(seen).toHaveLength(1);
    clearContextRefs();
    expect(seen).toEqual([]);
    off();
  });

  it('maps a Studio selection to an element (data-sf-id) or its frame', () => {
    expect(selectionRef({ dataAttributes: { 'data-sf-id': 'el_t5w8n3ja' } })).toEqual({
      kind: 'element',
      id: 'el_t5w8n3ja',
    });
    expect(
      selectionRef({ sourceFile: 'compositions/frames/fr_9x2b7cqe.html', dataAttributes: {} }),
    ).toEqual({
      kind: 'frame',
      id: 'fr_9x2b7cqe',
    });
  });
});
