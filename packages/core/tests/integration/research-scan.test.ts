// 049 · FR-AP-04 — quét nghiên cứu một kênh: hai đối thủ + trending + Google Trends + Google News (fetch
// giả phục vụ fixture) → `research/<ngày>.json` hợp lệ schema; quét lại trong ngày ghi đè; nguồn lỗi được
// ghi lại mà lần quét vẫn xong; tool `research.scan` / `research.get` qua Gateway.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setChannelAutopilot } from '../../src/autopilot/index.js';
import type { ResearchDoc } from '../../src/contracts/types.js';
import { validateArtifact } from '../../src/domain/validate.js';
import { createGateway } from '../../src/gateway/index.js';
import { JobQueue } from '../../src/jobs/queue.js';
import {
  defineResearchJob,
  readResearch,
  researchDate,
  researchTools,
  scanChannel,
} from '../../src/research/index.js';
import { openDb } from '../../src/store/db.js';
import { WriteStore } from '../../src/store/writer.js';
import { coreDir } from '../helpers.js';
import { copyChannel, fixtureAppData, fixtureVideoId } from '../domain-helpers.js';

const FX = path.join(coreDir, 'tests/fixtures/research');
const yt = JSON.parse(readFileSync(path.join(FX, 'youtube-api.json'), 'utf8')) as {
  competitors: { A: string; B: string };
  channels: Record<string, unknown>;
  playlists: Record<string, { items: unknown[]; nextPageToken?: string }[]>;
  videos: Record<string, unknown>;
  trending: Record<string, string[]>;
};
const NOW = new Date('2026-10-07T03:00:00Z'); // 10:00 giờ Việt Nam
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const xml = (n: string) => new Response(readFileSync(path.join(FX, n), 'utf8'), { status: 200 });

/** Fetch giả: YouTube Data API v3 + RSS Google Trends / News; `broken` làm hỏng một nguồn. */
function fakeFetch(broken: { trends?: boolean; news?: string[]; missing?: string[] } = {}) {
  const calls: string[] = [];
  const fn = async (u: string) => {
    calls.push(u);
    const url = new URL(u);
    const p = Object.fromEntries(url.searchParams);
    if (url.hostname === 'www.googleapis.com') {
      const res = url.pathname.split('/').pop();
      if (res === 'channels')
        return json({
          items: broken.missing?.includes(p.id!) || !yt.channels[p.id!] ? [] : [yt.channels[p.id!]],
        });
      if (res === 'playlistItems') {
        const pages = yt.playlists[p.playlistId!] ?? [];
        return json(pages[p.pageToken === 'P2' ? 1 : 0] ?? { items: [] });
      }
      if (res === 'videos') {
        const ids =
          p.chart === 'mostPopular' ? (yt.trending[p.regionCode!] ?? []) : p.id!.split(',');
        return json({ items: ids.map((id) => yt.videos[id]).filter(Boolean) });
      }
      return json({ error: { message: 'unknown' } }, 404);
    }
    if (url.hostname === 'trends.google.com') {
      if (broken.trends) throw new Error('getaddrinfo ENOTFOUND trends.google.com');
      expect(p.geo).toBe('VN');
      return xml('trends-vn.xml');
    }
    if (url.hostname === 'news.google.com') {
      expect(p).toMatchObject({ hl: 'vi', gl: 'VN', ceid: 'VN:vi' });
      if (broken.news?.includes(p.q!)) return new Response('Service Unavailable', { status: 503 });
      return p.q === 'lịch sử Việt Nam'
        ? xml('news-lich-su.xml')
        : new Response('<rss><channel></channel></rss>', { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { fn, calls };
}

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function channel() {
  const c = copyChannel();
  cleanups.push(c.cleanup);
  const store = new WriteStore(c.dir);
  setChannelAutopilot(store, 'autopilot.competitors', [yt.competitors.A, yt.competitors.B]);
  setChannelAutopilot(store, 'autopilot.pillars', ['lịch sử Việt Nam', 'nhà Trần']);
  return { dir: c.dir, store };
}

const kinds = (d: ResearchDoc) => Object.fromEntries(d.candidates.map((c) => [c.id, c.kind]));

describe('research scan (049 FR-AP-04)', () => {
  it('date follows publish.timezone', () => {
    expect(researchDate(new Date('2026-10-06T18:30:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10-07');
    expect(researchDate(new Date('2026-10-06T18:30:00Z'), 'Europe/Berlin')).toBe('2026-10-06');
  });

  it('scans competitors, trending, trends and news → research/<date>.json (schema-valid, scored)', async () => {
    const { dir, store } = channel();
    const f = fakeFetch({ news: ['nhà Trần'] });
    const r = await scanChannel(store, {
      apiKey: 'k',
      fetch: f.fn,
      now: NOW,
      appDataDir: fixtureAppData,
    });
    expect(r.path).toBe('research/2026-10-07.json');
    const text = readFileSync(path.join(dir, 'research', '2026-10-07.json'), 'utf8');
    expect(validateArtifact(r.path, text)).toMatchObject({ valid: true, kind: 'research' });
    const doc = JSON.parse(text) as ResearchDoc;
    expect(doc).toEqual(r.doc);
    expect(doc).toMatchObject({
      schema_version: 1,
      channel_id: 'ch_k3v9q2xa',
      date: '2026-10-07',
      generated_at: NOW.toISOString(),
      // A: channels 1 + 1 trang + 1 lô; B: 1 + 2 trang + 1 lô; trending 1
      quota_units: 8,
      sources: {
        competitors: [
          { channel_id: yt.competitors.A, title: 'Sử Kể Mẫu', videos: 8 },
          { channel_id: yt.competitors.B, title: 'Chuyện Xưa Mẫu', videos: 3 },
        ],
        own_videos: 1,
        trending: { region: 'VN', videos: 3 },
        trends: { geo: 'VN', items: 2 },
        news: [
          { pillar: 'lịch sử Việt Nam', items: 2 },
          { pillar: 'nhà Trần', items: 0, error: { code: 'E_PROVIDER_FAILED' } },
        ],
      },
    });
    // không dùng search.list (100 đơn vị)
    expect(f.calls.some((u) => u.includes('/youtube/v3/search'))).toBe(false);
    const k = kinds(doc);
    expect(k['yt:aaaaaaaaa01']).toBe('competitor'); // cũng trending → giữ bản điểm cao hơn
    expect(k['yt:aaaaaaaaa07']).toBe('competitor_evergreen');
    expect(k['yt:aaaaaaaaa08']).toBe('competitor');
    expect(k['yt:bbbbbbbbb01']).toBe('competitor');
    expect(k['yt:ttttttttt02']).toBe('trending');
    expect(k['trend:tran hung dao']).toBe('trend');
    expect(k['yt:ttttttttt01']).toBeUndefined(); // trending không khớp chủ đề trụ cột
    expect(k['trend:gia vang hom nay']).toBeUndefined();
    expect(doc.candidates.filter((c) => c.kind === 'news')).toHaveLength(1); // tin 20 ngày bị bỏ
    expect(doc.candidates.filter((c) => c.id === 'yt:aaaaaaaaa01')).toHaveLength(1);
    const scores = doc.candidates.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    for (const c of doc.candidates) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
      expect(c.reasons.length).toBeGreaterThan(0);
    }
    const dup = doc.candidates.find((c) => c.id === 'yt:aaaaaaaaa08')!;
    expect(dup.reasons.join(' ')).toMatch(/Gần trùng video đã làm/);
    // video mới vượt trội của đối thủ, đúng chủ đề trụ cột, chưa làm → đứng đầu
    expect(
      doc.candidates
        .slice(0, 2)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['yt:aaaaaaaaa01', 'yt:bbbbbbbbb01']);
    expect(readResearch(dir)).toEqual(doc);
    expect(readResearch(dir, '2026-10-07')).toEqual(doc);
    expect(readResearch(dir, '2026-10-06')).toBeUndefined();
  });

  it('re-running the same day overwrites the file (idempotent)', async () => {
    const { dir, store } = channel();
    const f = fakeFetch();
    await scanChannel(store, { apiKey: 'k', fetch: f.fn, now: NOW, appDataDir: fixtureAppData });
    const later = new Date('2026-10-07T09:00:00Z');
    const r = await scanChannel(store, {
      apiKey: 'k',
      fetch: f.fn,
      now: later,
      appDataDir: fixtureAppData,
    });
    expect(readdirSync(path.join(dir, 'research'))).toEqual(['2026-10-07.json']);
    expect(r.doc.generated_at).toBe(later.toISOString());
    expect(readResearch(dir)!.generated_at).toBe(later.toISOString());
    expect(r.doc.sources.news.every((n) => !n.error)).toBe(true);
  });

  it('a broken source is recorded without failing the scan', async () => {
    const { store } = channel();
    const f = fakeFetch({ trends: true, missing: [yt.competitors.B] });
    const { doc } = await scanChannel(store, {
      apiKey: 'k',
      fetch: f.fn,
      now: NOW,
      appDataDir: fixtureAppData,
    });
    expect(doc.sources.trends).toMatchObject({
      geo: 'VN',
      items: 0,
      error: { code: 'E_PROVIDER_FAILED', message: expect.stringMatching(/ENOTFOUND/) },
    });
    expect(doc.sources.competitors[1]).toMatchObject({
      channel_id: yt.competitors.B,
      videos: 0,
      error: { code: 'E_FILE_NOT_FOUND' },
    });
    expect(kinds(doc)['yt:aaaaaaaaa01']).toBe('competitor');
    expect(Object.values(kinds(doc))).not.toContain('trend');
  });

  it('no YouTube key → only RSS sources, quota 0, errors recorded', async () => {
    const { store } = channel();
    const f = fakeFetch();
    const { doc } = await scanChannel(store, { fetch: f.fn, now: NOW, appDataDir: fixtureAppData });
    expect(doc.quota_units).toBe(0);
    expect(doc.sources.trending.error?.code).toBe('E_PROVIDER_UNAVAILABLE');
    expect(doc.sources.competitors.map((c) => c.error?.code)).toEqual([
      'E_PROVIDER_UNAVAILABLE',
      'E_PROVIDER_UNAVAILABLE',
    ]);
    expect(f.calls.some((u) => u.includes('googleapis.com'))).toBe(false);
    expect(new Set(Object.values(kinds(doc)))).toEqual(new Set(['trend', 'news']));
  });

  it('Gateway tools: research.scan (job) then research.get; main sessions only', async () => {
    const { dir } = channel();
    const db = openDb(':memory:');
    const queue = new JobQueue({ db });
    const gw = createGateway({ appDataDir: fixtureAppData });
    cleanups.unshift(() => {
      queue.stop();
      db.close();
    });
    const f = fakeFetch();
    const deps = {
      queue,
      storeFor: (d: string) => gw.storeFor(d),
      apiKey: () => 'k',
      fetch: f.fn,
      now: () => NOW,
      appDataDir: fixtureAppData,
    };
    defineResearchJob(deps);
    for (const t of researchTools(deps)) gw.register(t);
    queue.start();
    const session = {
      session_id: 'ss_test0001',
      kind: 'main',
      channel_dir: dir,
      video_id: fixtureVideoId,
    } as const;
    const none = await gw.call(session, 'research.get', {});
    expect(none).toMatchObject({ ok: false, error: { code: 'E_FILE_NOT_FOUND' } });
    const started = await gw.call(session, 'research.scan', {});
    expect(started.ok).toBe(true);
    const jobId = (started as { job_id?: string }).job_id!;
    const done = await queue.wait(jobId, 10_000);
    expect(done.status).toBe('succeeded');
    expect(done.result).toMatchObject({
      path: 'research/2026-10-07.json',
      date: '2026-10-07',
      quota_units: 8,
      errors: [],
    });
    expect(existsSync(path.join(dir, 'research', '2026-10-07.json'))).toBe(true);
    const got = await gw.call(session, 'research.get', { date: '2026-10-07' });
    expect(got).toMatchObject({
      ok: true,
      data: { date: '2026-10-07', channel_id: 'ch_k3v9q2xa' },
    });
    expect(await gw.call(session, 'research.get', { date: '07/10/2026' })).toMatchObject({
      ok: false,
      error: { code: 'E_SCHEMA_INVALID' },
    });
    const frame = await gw.call({ ...session, kind: 'frame' }, 'research.scan', {});
    expect(frame.ok).toBe(false);
  });
});
