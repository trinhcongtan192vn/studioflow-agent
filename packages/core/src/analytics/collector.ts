import { readFileSync } from 'node:fs';
import path from 'node:path';
import { planDates, readPlan } from '../autopilot/plan.js';
import type { YouTubeAuth } from '../publish/oauth.js';
import { quotaDate } from '../publish/quota.js';
import type { Db } from '../store/db.js';
import {
  lastFetchedAt,
  upsertChannelDays,
  upsertVideoDays,
  upsertVideoStats,
} from './metrics-db.js';
import type { YouTubeAnalytics } from './youtube-analytics.js';

/**
 * Thu số liệu hiệu quả YouTube vào `studioflow.db` (054, FR-AP-11): số liệu kênh theo ngày, từng video do app đăng
 * theo ngày, và ảnh chụp lũy kế. Cửa sổ 7 ngày gần nhất mỗi lần (YouTube trễ và chỉnh lại); ghi đè theo khóa nên
 * thu lại là idempotent. Mỗi nguồn độc lập: video lỗi không làm hỏng cả lần thu. Không bao giờ ném lỗi.
 */
export const COLLECT_CONSTANTS = {
  WINDOW_DAYS: 7,
  STALE_MS: 6 * 3_600_000,
  VIDEO_DAYS: 30,
} as const;
const C = COLLECT_CONSTANTS;

export interface CollectorDeps {
  db: Db;
  auth: Pick<YouTubeAuth, 'connected'>;
  api: (channelId: string) => Pick<YouTubeAnalytics, 'channelDays' | 'videoDays' | 'stats'>;
  /** Kênh Autopilot đang bật. */
  channels: () => string[];
  clock?: () => Date;
}

export interface CollectResult {
  collected: boolean;
  reason?: 'not_connected' | 'fresh' | 'error';
  error?: string;
  days?: number;
  videos?: number;
}

const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};

export class MetricsCollector {
  constructor(private readonly d: CollectorDeps) {}

  private now(): Date {
    return this.d.clock?.() ?? new Date();
  }

  /** Video YouTube do app đăng (từ các kế hoạch gần đây của kênh): ID trên nền tảng. */
  videosOf(channel: string): string[] {
    const ids = new Set<string>();
    for (const date of planDates(channel).slice(0, C.VIDEO_DAYS))
      for (const it of readPlan(channel, date)?.items ?? []) {
        const st = it.publish?.youtube;
        if (st?.video_id && ['scheduled', 'private', 'public'].includes(st.status))
          ids.add(st.video_id);
      }
    return [...ids];
  }

  async collect(channel: string, o: { force?: boolean } = {}): Promise<CollectResult> {
    const channelId = (
      JSON.parse(readFileSync(path.join(channel, 'channel.json'), 'utf8')) as { id: string }
    ).id;
    const now = this.now();
    if (!(await this.d.auth.connected(channelId)))
      return { collected: false, reason: 'not_connected' };
    const last = lastFetchedAt(this.d.db, channelId, 'youtube');
    if (!o.force && last && now.getTime() - Date.parse(last) < C.STALE_MS)
      return { collected: false, reason: 'fresh' };
    const end = quotaDate(now); // ngày theo múi giờ báo cáo của YouTube Analytics (Thái Bình Dương)
    const start = addDays(end, -(C.WINDOW_DAYS - 1));
    const fetchedAt = now.toISOString();
    const api = this.d.api(channelId);
    try {
      const days = await api.channelDays(start, end);
      upsertChannelDays(this.d.db, channelId, 'youtube', days, fetchedAt);
      const vids = this.videosOf(channel);
      let videos = 0;
      for (const v of vids) {
        try {
          upsertVideoDays(
            this.d.db,
            channelId,
            'youtube',
            await api.videoDays(v, start, end),
            fetchedAt,
          );
          videos += 1;
        } catch {
          /* một video lỗi (mới đăng, chưa có số liệu…) không làm hỏng cả lần thu */
        }
      }
      if (vids.length) {
        try {
          upsertVideoStats(this.d.db, channelId, 'youtube', end, await api.stats(vids), fetchedAt);
        } catch {
          /* ảnh chụp lũy kế là phụ */
        }
      }
      return { collected: true, days: days.length, videos };
    } catch (e) {
      return { collected: false, reason: 'error', error: String((e as Error).message ?? e) };
    }
  }

  /** Thu cho mọi kênh Autopilot (bỏ qua kênh chưa kết nối / số liệu còn mới). */
  async collectAll(o: { force?: boolean } = {}): Promise<Record<string, CollectResult>> {
    const out: Record<string, CollectResult> = {};
    for (const c of this.d.channels()) out[c] = await this.collect(c, o);
    return out;
  }
}
