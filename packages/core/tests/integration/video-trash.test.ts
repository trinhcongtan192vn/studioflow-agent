// 064 — xóa video vào thùng rác của kênh (constitution 1.1, Điều VI ngoại lệ): chuyển, khôi phục, dọn sau
// trash.retention_days ngày hoặc khi người dùng bấm "Dọn thùng rác"; module ghi chỉ xóa hẳn trong .trash/.
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyTrash, listTrash, restoreVideo, trashVideo } from '../../src/domain/trash.js';
import { createVideo, listVideoIds } from '../../src/domain/video.js';
import { WriteStore } from '../../src/store/writer.js';
import { copyChannel } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function channel() {
  const c = copyChannel();
  cleanups.push(c.cleanup);
  const store = new WriteStore(c.dir);
  const { video_id } = createVideo(store, { title: 'Video thử' });
  return { dir: c.dir, store, video: video_id };
}

describe('video trash (064)', () => {
  it('moves a video into .trash/, lists it, restores it', () => {
    const { dir, store, video } = channel();
    const t = trashVideo(store, video, {
      title: 'Video thử',
      now: new Date('2026-10-07T10:00:00Z'),
    });
    expect(t.trash_id).toMatch(new RegExp(`^${video}-20261007100000$`));
    expect(listVideoIds(dir)).not.toContain(video);
    expect(existsSync(store.abs(`.trash/${t.trash_id}/state.json`))).toBe(true);
    expect(listTrash(store)).toEqual([
      {
        trash_id: t.trash_id,
        video_id: video,
        title: 'Video thử',
        deleted_at: '2026-10-07T10:00:00.000Z',
      },
    ]);
    restoreVideo(store, t.trash_id);
    expect(listVideoIds(dir)).toContain(video);
    expect(listTrash(store)).toEqual([]);
    expect(JSON.parse(readFileSync(store.abs(`videos/${video}/state.json`), 'utf8')).video_id).toBe(
      video,
    );
  });

  it('restore refuses when a video with the same id exists again', () => {
    const { store, video } = channel();
    const t = trashVideo(store, video, { title: 'x' });
    store.write(`videos/${video}/state.json`, '{}', { by: 'test', validate: false });
    expect(() => restoreVideo(store, t.trash_id)).toThrowError(
      expect.objectContaining({ code: 'E_ID_DUPLICATE' }),
    );
  });

  it('empties entries older than the retention, or everything on request', () => {
    const { store, video } = channel();
    const old = trashVideo(store, video, { title: 'cũ', now: new Date('2026-09-01T00:00:00Z') });
    const { video_id: v2 } = createVideo(store, { title: 'mới' });
    const fresh = trashVideo(store, v2, { title: 'mới', now: new Date('2026-10-06T00:00:00Z') });
    const r = emptyTrash(store, { now: new Date('2026-10-07T00:00:00Z'), retentionDays: 30 });
    expect(r.removed).toEqual([old.trash_id]);
    expect(listTrash(store).map((x) => x.trash_id)).toEqual([fresh.trash_id]);
    expect(emptyTrash(store, { all: true }).removed).toEqual([fresh.trash_id]);
    expect(listTrash(store)).toEqual([]);
  });

  it('the write module only purges inside .trash/', () => {
    const { store, video } = channel();
    expect(() => store.purgeTrash(`videos/${video}`)).toThrowError(
      expect.objectContaining({ code: 'E_PATH_OUTSIDE' }),
    );
    expect(() => store.purgeTrash('.trash/../videos')).toThrow();
  });
});
