import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cacheDir } from '../capability/run.js';
import { resolveConfig } from '../config/resolve.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';
import { listRenders, sizeOf, staleDrafts, staleSnapshots } from './usage.js';

export type CleanTarget = 'cache' | 'drafts' | 'backups' | 'snapshots';

/**
 * `disk.clean` (D4 mục 11, 024): chỉ dữ liệu dẫn xuất, xóa qua `WriteStore.removeDerived`; không bao giờ
 * render phát hành, artifact nguồn, `uploads/`, kho nhạc, thư viện asset.
 */
export function cleanChannel(
  d: { db?: Db; store: WriteStore },
  targets: CleanTarget[],
): { freed_bytes: number; removed: string[] } {
  const removed: string[] = [];
  let freed = 0;
  const drop = (rel: string, opts?: { userRequested?: boolean }) => {
    const abs = d.store.abs(rel);
    if (!existsSync(abs)) return;
    freed += sizeOf(abs);
    d.store.removeDerived(rel, opts);
    removed.push(rel);
  };
  if (targets.includes('cache')) {
    drop('cache/objects');
    d.db?.prepare('DELETE FROM cache_entries WHERE channel = ?').run(d.store.root);
  }
  if (targets.includes('drafts'))
    for (const r of staleDrafts(listRenders(d.store.root))) drop(r.rel);
  if (targets.includes('snapshots')) for (const s of staleSnapshots(d.store.root)) drop(s.rel);
  if (targets.includes('backups')) {
    const videos = d.store.abs('videos');
    if (existsSync(videos))
      for (const vd of readdirSync(videos))
        drop(`videos/${vd}/.sf/backups`, { userRequested: true });
  }
  return { freed_bytes: freed, removed };
}

/** Khóa cache được giữ: provenance của video có render phát hành trong 30 ngày (024 R3). */
function protectedKeys(store: WriteStore, days = 30): Set<string> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const recent = new Set(
    listRenders(store.root)
      .filter((r) => r.mode === 'release' && r.finished_at >= since)
      .map((r) => r.video),
  );
  const keys = new Set<string>();
  const read = (f: string) => {
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as { cache_key?: string; output?: string };
    } catch {
      return {};
    }
  };
  for (const vd of recent) {
    const dir = store.abs(`videos/${vd}/provenance`);
    if (existsSync(dir))
      for (const f of readdirSync(dir)) {
        const k = read(path.join(dir, f)).cache_key;
        if (k) keys.add(k);
      }
  }
  // asset kênh (ảnh sinh) được video đó dùng: provenance kênh có output `assets/files/<as>.*` + bản trong public/
  const chProv = store.abs('provenance');
  if (existsSync(chProv))
    for (const f of readdirSync(chProv)) {
      const p = read(path.join(chProv, f));
      const as = /^assets\/files\/(as_[0-9a-z]{8})\.\w+$/.exec(p.output ?? '')?.[1];
      if (!as || !p.cache_key) continue;
      for (const vd of recent)
        if (existsSync(store.abs(`videos/${vd}/public/${path.basename(p.output!)}`)))
          keys.add(p.cache_key);
    }
  return keys;
}

/**
 * Hạn mức cache kênh (D4 mục 7, FN-024): vượt `budget.cache_gb` → xóa mục ít dùng nhất tới 90 % hạn mức;
 * mục của video có render phát hành gần đây xóa sau cùng.
 */
export function enforceCacheBudget(d: { db: Db; store: WriteStore; appDataDir?: string }): {
  evicted: string[];
  bytes: number;
} {
  const budget =
    Number(
      resolveConfig('budget.cache_gb', { channelDir: d.store.root }, { appDataDir: d.appDataDir })
        .value,
    ) * 1e9;
  const rows = d.db
    .prepare('SELECT key, size, last_used FROM cache_entries WHERE channel = ? ORDER BY last_used')
    .all(d.store.root) as { key: string; size: number; last_used: string }[];
  let total = rows.reduce((s, r) => s + r.size, 0);
  if (!budget || total <= budget) return { evicted: [], bytes: total };
  const keep = protectedKeys(d.store);
  const order = [...rows.filter((r) => !keep.has(r.key)), ...rows.filter((r) => keep.has(r.key))];
  const evicted: string[] = [];
  for (const r of order) {
    if (total <= budget * 0.9) break;
    d.store.removeDerived(cacheDir(r.key));
    d.db
      .prepare('DELETE FROM cache_entries WHERE key = ? AND channel = ?')
      .run(r.key, d.store.root);
    total -= r.size;
    evicted.push(r.key);
  }
  return { evicted, bytes: total };
}
