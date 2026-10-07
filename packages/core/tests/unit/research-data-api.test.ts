// 049 · FR-AP-04 — YouTube Data API trực tiếp cho quét nghiên cứu: playlist uploads, video mới (phân
// trang), số liệu theo lô ≤ 50, trending theo vùng; đếm đơn vị quota; lỗi chuẩn hoá (D4 9.5).
import { describe, expect, it } from 'vitest';
import {
  channelUploads,
  playlistVideoIds,
  regionForLanguage,
  trendingVideos,
  videoStats,
  type Quota,
} from '../../src/youtube/data-api.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const params = (u: string) => Object.fromEntries(new URL(u).searchParams);

const videoItem = (id: string) => ({
  id,
  snippet: {
    title: `Video ${id}`,
    channelId: 'UCaaaaaaaaaaaaaaaaaaaaa1',
    channelTitle: 'Sử Kể Mẫu',
    publishedAt: '2026-10-01T00:00:00Z',
    tags: ['lịch sử'],
  },
  contentDetails: { duration: 'PT1M5S' },
  statistics: { viewCount: '1200', likeCount: '50' },
});

describe('YouTube Data API for research (049)', () => {
  it('region from channel language', () => {
    expect(regionForLanguage('vi')).toBe('VN');
    expect(regionForLanguage('de')).toBe('DE');
    expect(regionForLanguage('en')).toBe('US');
  });

  it('uploads playlist via channels.list contentDetails (1 unit)', async () => {
    const calls: string[] = [];
    const quota: Quota = { units: 0 };
    const r = await channelUploads('UCaaaaaaaaaaaaaaaaaaaaa1', {
      apiKey: 'k',
      quota,
      fetch: async (u) => {
        calls.push(u);
        return json({
          items: [
            {
              id: 'UCaaaaaaaaaaaaaaaaaaaaa1',
              snippet: { title: 'Sử Kể Mẫu' },
              contentDetails: { relatedPlaylists: { uploads: 'UUaaaaaaaaaaaaaaaaaaaaa1' } },
            },
          ],
        });
      },
    });
    expect(r).toEqual({ playlist_id: 'UUaaaaaaaaaaaaaaaaaaaaa1', title: 'Sử Kể Mẫu' });
    expect(calls[0]).toContain('/youtube/v3/channels?');
    expect(params(calls[0]!)).toMatchObject({
      part: 'snippet,contentDetails',
      id: 'UCaaaaaaaaaaaaaaaaaaaaa1',
      key: 'k',
    });
    expect(quota.units).toBe(1);
    await expect(
      channelUploads('UCzzzzzzzzzzzzzzzzzzzzz9', { apiKey: 'k', fetch: async () => json({}) }),
    ).rejects.toMatchObject({ code: 'E_FILE_NOT_FOUND' });
  });

  it('playlistItems pages until max (1 unit / page)', async () => {
    const quota: Quota = { units: 0 };
    const seen: Record<string, string>[] = [];
    const ids = await playlistVideoIds('UUx', {
      apiKey: 'k',
      quota,
      max: 3,
      fetch: async (u) => {
        const p = params(u);
        seen.push(p);
        return p.pageToken === 'P2'
          ? json({
              items: [{ contentDetails: { videoId: 'v3' } }, { contentDetails: { videoId: 'v4' } }],
            })
          : json({
              items: [{ contentDetails: { videoId: 'v1' } }, { contentDetails: { videoId: 'v2' } }],
              nextPageToken: 'P2',
            });
      },
    });
    expect(ids).toEqual(['v1', 'v2', 'v3']);
    expect(seen[0]).toMatchObject({ part: 'contentDetails', playlistId: 'UUx', maxResults: '3' });
    expect(quota.units).toBe(2);
  });

  it('video stats in batches of ≤ 50 ids (1 unit each)', async () => {
    const quota: Quota = { units: 0 };
    const batches: string[][] = [];
    const ids = Array.from({ length: 73 }, (_, i) => `v${String(i).padStart(10, '0')}`);
    const r = await videoStats(ids, {
      apiKey: 'k',
      quota,
      fetch: async (u) => {
        const p = params(u);
        expect(p.part).toBe('snippet,statistics,contentDetails');
        const b = p.id!.split(',');
        batches.push(b);
        return json({ items: b.map(videoItem) });
      },
    });
    expect(batches.map((b) => b.length)).toEqual([50, 23]);
    expect(quota.units).toBe(2);
    expect(r).toHaveLength(73);
    expect(r[0]).toEqual({
      video_id: ids[0],
      title: `Video ${ids[0]}`,
      tags: ['lịch sử'],
      channel_id: 'UCaaaaaaaaaaaaaaaaaaaaa1',
      channel_title: 'Sử Kể Mẫu',
      published_at: '2026-10-01T00:00:00Z',
      views: 1200,
      likes: 50,
      duration_s: 65,
    });
    expect(await videoStats([], { apiKey: 'k', quota })).toEqual([]);
    expect(quota.units).toBe(2);
  });

  it('trending via chart=mostPopular (1 unit)', async () => {
    const quota: Quota = { units: 0 };
    let p: Record<string, string> = {};
    const r = await trendingVideos('VN', {
      apiKey: 'k',
      quota,
      fetch: async (u) => {
        p = params(u);
        return json({ items: [videoItem('t1')] });
      },
    });
    expect(p).toMatchObject({ chart: 'mostPopular', regionCode: 'VN', maxResults: '50' });
    expect(r.map((v) => v.video_id)).toEqual(['t1']);
    expect(quota.units).toBe(1);
  });

  it('errors: no key → E_PROVIDER_UNAVAILABLE; HTTP error → E_PROVIDER_FAILED', async () => {
    await expect(trendingVideos('VN', { apiKey: undefined })).rejects.toMatchObject({
      code: 'E_PROVIDER_UNAVAILABLE',
    });
    await expect(
      trendingVideos('VN', {
        apiKey: 'k',
        fetch: async () => json({ error: { message: 'quotaExceeded' } }, 403),
      }),
    ).rejects.toMatchObject({
      code: 'E_PROVIDER_FAILED',
      message: expect.stringMatching(/403.*quotaExceeded/),
    });
    await expect(
      videoStats(['a'], {
        apiKey: 'k',
        fetch: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toMatchObject({ code: 'E_PROVIDER_FAILED' });
  });
});
