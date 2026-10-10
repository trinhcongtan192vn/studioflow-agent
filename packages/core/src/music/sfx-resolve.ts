import { readFileSync } from 'node:fs';
import { isMap } from 'yaml';
import { parseStoryboard, serializeStoryboard } from '../domain/markdown/storyboard.js';
import type { WriteStore } from '../store/writer.js';
import type { TextEmbedder } from './clap.js';
import { findMusicSemantic } from './find.js';

/** Độ giống mô tả (CLAP) tối thiểu để dùng một SFX trong kho; không có CLAP → phải khớp từ khóa. */
export const SFX_MIN_COSINE = 0.3;

/** Kết quả tìm thật sự khớp mô tả (điểm tổng có phần nền theo độ mới → không dùng làm ngưỡng). */
export function sfxMatches(reasons: string[]): boolean {
  const cos = /khớp mô tả ([\d.]+)/.exec(reasons.join(' '))?.[1];
  if (cos !== undefined) return Number(cos) >= SFX_MIN_COSINE;
  return reasons.some((r) => r.startsWith('khớp: '));
}

export interface SfxPlanItem {
  query: string;
  at_ms: number;
  volume_db: number;
}

/**
 * Gắn hiệu ứng âm thanh (2026-10-10): `config.sfx_plan` của mỗi frame (đạo diễn) → tìm âm hợp nhất trong kho
 * SFX của kênh + app (CLAP theo mô tả) → `sfx[]` của frame (`track_id`, `at_ms`, `volume_db`). Không có âm hợp →
 * `generate` (nếu có) tạo mới, không thì bỏ qua và đếm vào `missing`.
 */
export async function resolveSfx(
  d: {
    store: WriteStore;
    appDataDir: string;
    embedder?: TextEmbedder;
    generate?: (query: string) => Promise<string | undefined>;
  },
  videoId: string,
): Promise<{ placed: number; generated: number; missing: string[] }> {
  const rel = `videos/${videoId}/STORYBOARD.md`;
  const sb = parseStoryboard(readFileSync(d.store.abs(rel), 'utf8'));
  const memo = new Map<string, string | undefined>();
  let placed = 0;
  let generated = 0;
  const missing: string[] = [];
  const find = async (query: string): Promise<string | undefined> => {
    if (memo.has(query)) return memo.get(query);
    const r = await findMusicSemantic(
      {
        channel: d.store,
        appDataDir: d.appDataDir,
        ...(d.embedder ? { embedder: d.embedder } : {}),
      },
      { query, limit: 1 },
      'sfx',
    ).catch(() => ({ results: [] as { track_id: string; score: number; reasons: string[] }[] }));
    const top = r.results[0];
    let id: string | undefined = top && sfxMatches(top.reasons) ? top.track_id : undefined;
    if (!id && d.generate) {
      id = await d.generate(query).catch(() => undefined);
      if (id) generated++;
    }
    memo.set(query, id);
    return id;
  };
  for (const b of sb.blocks) {
    if (b.tag !== 'sf-frame' || !isMap(b.doc.contents)) continue;
    const root = b.doc.contents;
    const plan = (root.toJSON() as { config?: { sfx_plan?: SfxPlanItem[] } }).config?.sfx_plan;
    if (!Array.isArray(plan) || !plan.length) continue;
    const sfx: { track_id: string; at_ms: number; volume_db: number }[] = [];
    for (const p of plan) {
      if (!p?.query) continue;
      const id = await find(p.query);
      if (id) {
        sfx.push({ track_id: id, at_ms: p.at_ms ?? 0, volume_db: p.volume_db ?? -12 });
        placed++;
      } else missing.push(p.query);
    }
    const before = JSON.stringify(root.toJSON().sfx ?? []);
    if (JSON.stringify(sfx) === before) continue;
    if (sfx.length) root.set('sfx', sfx);
    else root.delete('sfx');
    b.docDirty = true;
    b.data = b.doc.toJS();
  }
  if (sb.blocks.some((b) => b.docDirty))
    d.store.write(rel, serializeStoryboard(sb), { by: 'media.sfx' });
  return { placed, generated, missing };
}
