import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from 'node:fs';
import path from 'node:path';

/** Ngưỡng FN-024 mục 3 (024 research R1). */
export const DISK_WARN_BYTES = 15e9;
export const DISK_MIN_BYTES = 5e9;
export const KEEP_DRAFTS = 5;
export const KEEP_SNAPSHOTS = 10;

/** Tổng byte của file/thư mục (không theo liên kết). */
export function sizeOf(p: string): number {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  return readdirSync(p).reduce((s, n) => s + sizeOf(path.join(p, n)), 0);
}

/** Dung lượng trống/tổng của ổ chứa `p`. */
export function diskSpace(p: string): { free_bytes: number; total_bytes: number } {
  let dir = p;
  while (!existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  const s = statfsSync(dir);
  return {
    free_bytes: Number(s.bavail) * Number(s.bsize),
    total_bytes: Number(s.blocks) * Number(s.bsize),
  };
}

export interface RenderDir {
  /** Đường dẫn tương đối kênh: `videos/<vd>/renders/<rd>`. */
  rel: string;
  video: string;
  mode: string;
  finished_at: string;
  bytes: number;
}

/** Render của mọi video trong kênh (phân loại theo `render.json.mode`, D3 5.14). */
export function listRenders(channelDir: string): RenderDir[] {
  const videos = path.join(channelDir, 'videos');
  if (!existsSync(videos)) return [];
  const out: RenderDir[] = [];
  for (const vd of readdirSync(videos)) {
    const rdir = path.join(videos, vd, 'renders');
    if (!existsSync(rdir)) continue;
    for (const rd of readdirSync(rdir)) {
      const abs = path.join(rdir, rd);
      if (!/^rd_[0-9a-z]{8}$/.test(rd) || !statSync(abs).isDirectory()) continue;
      let rec: { mode?: string; finished_at?: string; started_at?: string } = {};
      try {
        rec = JSON.parse(readFileSync(path.join(abs, 'render.json'), 'utf8'));
      } catch {
        /* render dở dang: coi là nháp */
      }
      out.push({
        rel: `videos/${vd}/renders/${rd}`,
        video: vd,
        mode: rec.mode ?? 'draft',
        finished_at: rec.finished_at ?? rec.started_at ?? '',
        bytes: sizeOf(abs),
      });
    }
  }
  return out;
}

/** Render nháp ngoài `KEEP_DRAFTS` bản mới nhất mỗi video (FN-024). */
export function staleDrafts(renders: RenderDir[]): RenderDir[] {
  const byVideo = new Map<string, RenderDir[]>();
  for (const r of renders.filter((x) => x.mode !== 'release'))
    byVideo.set(r.video, [...(byVideo.get(r.video) ?? []), r]);
  return [...byVideo.values()].flatMap((list) =>
    list.sort((a, b) => b.finished_at.localeCompare(a.finished_at)).slice(KEEP_DRAFTS),
  );
}

/** File `.sf/snapshots/` ngoài `KEEP_SNAPSHOTS` mới nhất mỗi video. */
export function staleSnapshots(channelDir: string): { rel: string; bytes: number }[] {
  const videos = path.join(channelDir, 'videos');
  if (!existsSync(videos)) return [];
  return readdirSync(videos).flatMap((vd) => {
    const dir = path.join(videos, vd, '.sf', 'snapshots');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((f) => ({ rel: `videos/${vd}/.sf/snapshots/${f}`, abs: path.join(dir, f) }))
      .map((x) => ({ ...x, mtime: statSync(x.abs).mtimeMs, bytes: sizeOf(x.abs) }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(KEEP_SNAPSHOTS)
      .map(({ rel, bytes }) => ({ rel, bytes }));
  });
}

export interface ChannelUsage {
  cache_bytes: number;
  renders: { draft_bytes: number; release_bytes: number };
  backups_bytes: number;
  /** `.sf/` của video trừ sao lưu. */
  derived_bytes: number;
  /** Byte giải phóng nếu dọn từng mục (`disk.clean`). */
  reclaimable: { cache: number; drafts: number; backups: number; snapshots: number };
}

export function channelUsage(channelDir: string): ChannelUsage {
  const renders = listRenders(channelDir);
  const videos = path.join(channelDir, 'videos');
  let backups = 0;
  let derived = 0;
  if (existsSync(videos))
    for (const vd of readdirSync(videos)) {
      const sf = path.join(videos, vd, '.sf');
      const b = sizeOf(path.join(sf, 'backups'));
      backups += b;
      derived += sizeOf(sf) - b;
    }
  const cache = sizeOf(path.join(channelDir, 'cache'));
  return {
    cache_bytes: cache,
    renders: {
      draft_bytes: renders.filter((r) => r.mode !== 'release').reduce((s, r) => s + r.bytes, 0),
      release_bytes: renders.filter((r) => r.mode === 'release').reduce((s, r) => s + r.bytes, 0),
    },
    backups_bytes: backups,
    derived_bytes: derived,
    reclaimable: {
      cache,
      drafts: staleDrafts(renders).reduce((s, r) => s + r.bytes, 0),
      backups,
      snapshots: staleSnapshots(channelDir).reduce((s, r) => s + r.bytes, 0),
    },
  };
}

export interface DiskUsage {
  disk: { free_bytes: number; total_bytes: number; level: 'ok' | 'warn' | 'low' };
  app: { models_bytes: number; providers_bytes: number };
  channel?: ChannelUsage;
}

/** `disk.usage` (D10 UI-10, 024). */
export function diskUsage(o: { appDataDir: string; channelDir?: string }): DiskUsage {
  const space = diskSpace(o.channelDir ?? o.appDataDir);
  const level =
    space.free_bytes < DISK_MIN_BYTES ? 'low' : space.free_bytes < DISK_WARN_BYTES ? 'warn' : 'ok';
  return {
    disk: { ...space, level },
    app: {
      models_bytes: sizeOf(path.join(o.appDataDir, 'models')),
      providers_bytes: sizeOf(path.join(o.appDataDir, 'providers')),
    },
    ...(o.channelDir ? { channel: channelUsage(o.channelDir) } : {}),
  };
}
