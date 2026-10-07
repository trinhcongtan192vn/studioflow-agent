import { SfError } from '../errors.js';
import { jsonOf, realFetch, type HttpFetch } from '../publish/http.js';
import { YT_UNITS, type QuotaLedger } from '../publish/quota.js';
import type { ChannelDay, VideoDay, VideoStat } from './metrics-db.js';

/** Client YouTube Analytics API + Data API statistics (054, D4 9.7). Token do bộ OAuth của 053 cấp. */
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';
const DATA = 'https://www.googleapis.com/youtube/v3';

export interface AnalyticsApiDeps {
  fetch?: HttpFetch;
  token: (force?: boolean) => Promise<string>;
  /** Data API `videos.list` tốn quota (1 đơn vị); Analytics API quota riêng không đếm. */
  quota?: QuotaLedger;
}

interface Report {
  columnHeaders?: { name: string }[];
  rows?: (string | number)[][];
}

export class YouTubeAnalytics {
  private readonly f: HttpFetch;
  constructor(private readonly d: AnalyticsApiDeps) {
    this.f = d.fetch ?? realFetch;
  }

  private async get(op: string, url: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let r: Response;
      try {
        r = await this.f(url, {
          headers: { authorization: `Bearer ${await this.d.token(attempt > 0)}` },
        });
      } catch {
        throw new SfError('E_PROVIDER_FAILED', `youtube ${op}: không kết nối được`);
      }
      if (r.status === 401 && attempt === 0) continue;
      if (!r.ok) {
        const j = await jsonOf<{ error?: { message?: string; errors?: { reason?: string }[] } }>(r);
        const why = j?.error?.errors?.[0]?.reason ?? j?.error?.message ?? `HTTP ${r.status}`;
        throw new SfError(
          'E_PROVIDER_FAILED',
          `youtube ${op}: ${r.status} ${String(why).slice(0, 160)}`,
        );
      }
      return r;
    }
  }

  private async report(
    op: string,
    q: { startDate: string; endDate: string; metrics: string[]; filters?: string },
  ): Promise<Record<string, string | number>[]> {
    const params = new URLSearchParams({
      ids: 'channel==MINE',
      startDate: q.startDate,
      endDate: q.endDate,
      dimensions: 'day',
      metrics: q.metrics.join(','),
      sort: 'day',
      ...(q.filters ? { filters: q.filters } : {}),
    });
    const r = await this.get(op, `${ANALYTICS}?${params}`);
    const j = (await jsonOf<Report>(r)) ?? {};
    const names = (j.columnHeaders ?? []).map((h) => h.name);
    return (j.rows ?? []).map((row) => Object.fromEntries(row.map((v, i) => [names[i]!, v])));
  }

  /** Số liệu theo ngày của cả kênh. */
  async channelDays(startDate: string, endDate: string): Promise<ChannelDay[]> {
    const rows = await this.report('analytics.channel', {
      startDate,
      endDate,
      metrics: [
        'views',
        'estimatedMinutesWatched',
        'averageViewDuration',
        'subscribersGained',
        'subscribersLost',
        'likes',
      ],
    });
    return rows.map((r) => ({
      day: String(r.day),
      views: Number(r.views ?? 0),
      minutes_watched: Number(r.estimatedMinutesWatched ?? 0),
      avg_view_duration_s:
        r.averageViewDuration === undefined ? null : Number(r.averageViewDuration),
      subs_gained: Number(r.subscribersGained ?? 0),
      subs_lost: Number(r.subscribersLost ?? 0),
      likes: Number(r.likes ?? 0),
    }));
  }

  /** Số liệu theo ngày của một video. */
  async videoDays(videoId: string, startDate: string, endDate: string): Promise<VideoDay[]> {
    const rows = await this.report('analytics.video', {
      startDate,
      endDate,
      filters: `video==${videoId}`,
      metrics: [
        'views',
        'estimatedMinutesWatched',
        'averageViewDuration',
        'likes',
        'comments',
        'subscribersGained',
      ],
    });
    return rows.map((r) => ({
      video_ref: videoId,
      day: String(r.day),
      views: Number(r.views ?? 0),
      minutes_watched: Number(r.estimatedMinutesWatched ?? 0),
      avg_view_duration_s:
        r.averageViewDuration === undefined ? null : Number(r.averageViewDuration),
      likes: Number(r.likes ?? 0),
      comments: Number(r.comments ?? 0),
      subs_gained: Number(r.subscribersGained ?? 0),
    }));
  }

  /** Ảnh chụp lũy kế (Data API `statistics`), lô ≤ 50 video, 1 đơn vị mỗi lô. */
  async stats(videoIds: string[]): Promise<VideoStat[]> {
    const out: VideoStat[] = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      const ids = videoIds.slice(i, i + 50);
      this.d.quota?.add(YT_UNITS.LIST);
      const r = await this.get(
        'videos.list',
        `${DATA}/videos?part=statistics&id=${ids.map(encodeURIComponent).join(',')}`,
      );
      const j = await jsonOf<{
        items?: {
          id: string;
          statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
        }[];
      }>(r);
      for (const it of j?.items ?? [])
        out.push({
          video_ref: it.id,
          view_count: Number(it.statistics?.viewCount ?? 0),
          like_count: Number(it.statistics?.likeCount ?? 0),
          comment_count: Number(it.statistics?.commentCount ?? 0),
        });
    }
    return out;
  }
}
