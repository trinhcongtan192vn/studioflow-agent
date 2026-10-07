import type { Db } from '../store/db.js';

/** Bảng số liệu hiệu quả trong `studioflow.db` (D11 3.1, 054). Ghi `INSERT OR REPLACE` nên thu lại cùng ngày idempotent. */
export interface ChannelDay {
  day: string;
  views: number;
  minutes_watched: number;
  avg_view_duration_s: number | null;
  subs_gained: number;
  subs_lost: number;
  likes: number;
}
export interface VideoDay {
  video_ref: string;
  day: string;
  views: number;
  minutes_watched: number;
  avg_view_duration_s: number | null;
  likes: number;
  comments: number;
  subs_gained: number;
}
export interface VideoStat {
  video_ref: string;
  view_count: number;
  like_count: number;
  comment_count: number;
}

export function upsertChannelDays(
  db: Db,
  channelId: string,
  platform: string,
  rows: ChannelDay[],
  fetchedAt: string,
): void {
  const st = db.prepare(
    'INSERT OR REPLACE INTO channel_metrics (channel_id, platform, day, views, minutes_watched, avg_view_duration_s, subs_gained, subs_lost, likes, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  for (const r of rows)
    st.run(
      channelId,
      platform,
      r.day,
      r.views,
      r.minutes_watched,
      r.avg_view_duration_s,
      r.subs_gained,
      r.subs_lost,
      r.likes,
      fetchedAt,
    );
}

export function upsertVideoDays(
  db: Db,
  channelId: string,
  platform: string,
  rows: VideoDay[],
  fetchedAt: string,
): void {
  const st = db.prepare(
    'INSERT OR REPLACE INTO video_metrics (channel_id, platform, video_ref, day, views, minutes_watched, avg_view_duration_s, likes, comments, subs_gained, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  );
  for (const r of rows)
    st.run(
      channelId,
      platform,
      r.video_ref,
      r.day,
      r.views,
      r.minutes_watched,
      r.avg_view_duration_s,
      r.likes,
      r.comments,
      r.subs_gained,
      fetchedAt,
    );
}

export function upsertVideoStats(
  db: Db,
  channelId: string,
  platform: string,
  day: string,
  rows: VideoStat[],
  fetchedAt: string,
): void {
  const st = db.prepare(
    'INSERT OR REPLACE INTO video_stats (channel_id, platform, video_ref, day, view_count, like_count, comment_count, fetched_at) VALUES (?,?,?,?,?,?,?,?)',
  );
  for (const r of rows)
    st.run(
      channelId,
      platform,
      r.video_ref,
      day,
      r.view_count,
      r.like_count,
      r.comment_count,
      fetchedAt,
    );
}

/** Các ngày của kênh trong [from, to] (gồm hai đầu), cũ trước. */
export function channelDays(
  db: Db,
  channelId: string,
  platform: string,
  from: string,
  to: string,
): ChannelDay[] {
  return db
    .prepare(
      'SELECT day, views, minutes_watched, avg_view_duration_s, subs_gained, subs_lost, likes FROM channel_metrics WHERE channel_id = ? AND platform = ? AND day >= ? AND day <= ? ORDER BY day',
    )
    .all(channelId, platform, from, to) as unknown as ChannelDay[];
}

/** Ngày mới nhất đã có số liệu kênh (≤ `upTo`). */
export function latestChannelDay(
  db: Db,
  channelId: string,
  platform: string,
  upTo: string,
): string | undefined {
  const r = db
    .prepare(
      'SELECT MAX(day) AS d FROM channel_metrics WHERE channel_id = ? AND platform = ? AND day <= ?',
    )
    .get(channelId, platform, upTo) as { d: string | null };
  return r.d ?? undefined;
}

/** Tổng lượt xem theo video trong [from, to], nhiều nhất trước. */
export function videoViews(
  db: Db,
  channelId: string,
  platform: string,
  from: string,
  to: string,
): { video_ref: string; views: number }[] {
  return db
    .prepare(
      'SELECT video_ref, SUM(views) AS views FROM video_metrics WHERE channel_id = ? AND platform = ? AND day >= ? AND day <= ? GROUP BY video_ref ORDER BY views DESC, video_ref',
    )
    .all(channelId, platform, from, to) as unknown as { video_ref: string; views: number }[];
}

/** Lần thu gần nhất của kênh (ISO) — để biết số liệu cũ hay mới. */
export function lastFetchedAt(db: Db, channelId: string, platform: string): string | undefined {
  const r = db
    .prepare(
      'SELECT MAX(fetched_at) AS t FROM channel_metrics WHERE channel_id = ? AND platform = ?',
    )
    .get(channelId, platform) as { t: string | null };
  return r.t ?? undefined;
}

/** Lượt xem lũy kế mới nhất của mỗi video (Data API). */
export function latestVideoStats(db: Db, channelId: string, platform: string): VideoStat[] {
  return db
    .prepare(
      `SELECT s.video_ref, s.view_count, s.like_count, s.comment_count FROM video_stats s
       WHERE s.channel_id = ? AND s.platform = ? AND s.day = (SELECT MAX(day) FROM video_stats WHERE channel_id = s.channel_id AND platform = s.platform AND video_ref = s.video_ref)`,
    )
    .all(channelId, platform) as unknown as VideoStat[];
}
