import { resolveConfig } from '../config/resolve.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';
import { cacheDir } from './run.js';

export interface EvictedEntry {
  key: string;
  size: number;
}

/**
 * Dọn cache kênh theo LRU tới dưới hạn mức (D4 mục 7). Mặc định hạn mức = `budget.cache_gb` của
 * kênh. Chỉ xóa trong `cache/` (dữ liệu dẫn xuất).
 */
export function evictCache(store: WriteStore, db: Db, budgetBytes?: number): EvictedEntry[] {
  const budget =
    budgetBytes ??
    Number(resolveConfig<number>('budget.cache_gb', { channelDir: store.root }).value) * 1024 ** 3;
  const rows = db
    .prepare(
      'SELECT key, size FROM cache_entries WHERE channel = ? ORDER BY last_used ASC, rowid ASC',
    )
    .all(store.root) as unknown as EvictedEntry[];
  let total = rows.reduce((s, r) => s + r.size, 0);
  const removed: EvictedEntry[] = [];
  for (const r of rows) {
    if (total <= budget) break;
    store.removeDerived(cacheDir(r.key));
    db.prepare('DELETE FROM cache_entries WHERE key = ? AND channel = ?').run(r.key, store.root);
    total -= r.size;
    removed.push(r);
  }
  return removed;
}
