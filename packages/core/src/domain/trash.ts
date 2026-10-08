import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';

/**
 * 064 — thùng rác video của kênh (constitution 1.1, Điều VI ngoại lệ): xóa video = chuyển `videos/<vd>` vào
 * `.trash/<vd>-<YYYYMMDDHHmmss>/` (kèm `trash.json`); khôi phục được; chỉ nội dung thùng rác mới xóa hẳn —
 * quá `trash.retention_days` ngày hoặc khi người dùng bấm "Dọn thùng rác".
 */
export interface TrashEntry {
  trash_id: string;
  video_id: string;
  title: string;
  deleted_at: string;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);

export function trashVideo(
  store: WriteStore,
  videoId: string,
  o: { title: string; now?: Date },
): { trash_id: string } {
  if (!/^vd_[0-9a-z]{8}$/.test(videoId))
    throw new SfError('E_SCHEMA_INVALID', `bad video id ${videoId}`);
  const now = o.now ?? new Date();
  const trash_id = `${videoId}-${stamp(now)}`;
  store.moveDir(`videos/${videoId}`, `.trash/${trash_id}`, { by: 'video.delete' });
  const meta: TrashEntry = {
    trash_id,
    video_id: videoId,
    title: o.title,
    deleted_at: now.toISOString(),
  };
  store.write(`.trash/${trash_id}/trash.json`, `${JSON.stringify(meta, null, 2)}\n`, {
    by: 'video.delete',
    validate: false,
  });
  return { trash_id };
}

export function listTrash(store: WriteStore): TrashEntry[] {
  const dir = store.abs('.trash');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^vd_[0-9a-z]{8}-\d{14}$/.test(e.name))
    .map((e) => {
      try {
        return JSON.parse(
          readFileSync(store.abs(`.trash/${e.name}/trash.json`), 'utf8'),
        ) as TrashEntry;
      } catch {
        // thiếu trash.json (bị gián đoạn) → suy từ tên thư mục
        const [video_id, ts] = e.name.split('-') as [string, string];
        const iso = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}.000Z`;
        return { trash_id: e.name, video_id, title: video_id, deleted_at: iso };
      }
    })
    .sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

export function restoreVideo(store: WriteStore, trashId: string): { video_id: string } {
  const e = listTrash(store).find((x) => x.trash_id === trashId);
  if (!e) throw new SfError('E_ID_UNKNOWN', `${trashId} is not in the trash`);
  store.moveDir(`.trash/${trashId}`, `videos/${e.video_id}`, { by: 'video.restore' });
  return { video_id: e.video_id };
}

/** Dọn thùng rác: mục quá hạn (`retentionDays`) hoặc tất cả (`all`, người dùng bấm "Dọn thùng rác"). */
export function emptyTrash(
  store: WriteStore,
  o: { all?: boolean; now?: Date; retentionDays?: number },
): { removed: string[] } {
  const now = (o.now ?? new Date()).getTime();
  const keepMs = (o.retentionDays ?? 30) * 86_400_000;
  const removed: string[] = [];
  for (const e of listTrash(store)) {
    if (!o.all && now - Date.parse(e.deleted_at) < keepMs) continue;
    store.purgeTrash(`.trash/${e.trash_id}`);
    removed.push(e.trash_id);
  }
  return { removed: removed.sort() };
}
