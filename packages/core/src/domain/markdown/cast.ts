import { newId } from '../ids.js';
import { parseBlocksDoc, serializeBlocksDoc } from './blocks.js';

/**
 * Gán `ca_…` cho nhân vật mới trong khối `sf-cast` của `CAST.md` (D3 mục 2: ID do app gán, 031).
 * Không đổi nhân vật đã có ID; trả văn bản mới + danh sách ID vừa gán.
 */
export function assignCastIds(
  text: string,
  taken: Set<string>,
): { text: string; assigned: string[] } {
  const doc = parseBlocksDoc(text);
  const blk = doc.blocks.find((b) => b.tag === 'sf-cast');
  if (!blk || !Array.isArray(blk.data)) return { text, assigned: [] };
  const assigned: string[] = [];
  const used = new Set(taken);
  const data = (blk.data as Record<string, unknown>[]).map((c) => {
    if (!c || typeof c !== 'object' || c.id) return c;
    const id = newId('ca', used);
    used.add(id);
    assigned.push(id);
    return { id, ...c };
  });
  if (!assigned.length) return { text, assigned };
  blk.data = data;
  return { text: serializeBlocksDoc(doc), assigned };
}
