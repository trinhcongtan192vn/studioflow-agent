// 053 · FR-AP-09 — tải lên YouTube có thể tiếp tục: khúc 8 MiB, tiếp tục sau khúc lỗi, tiếp tục từ phiên đã lưu,
// quota đếm trước khi gọi, ánh xạ lỗi Google, 401 làm mới token một lần.
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { QuotaLedger, quotaDate, readQuotaUsed, YT_UNITS } from '../../src/publish/quota.js';
import { UPLOAD_CONSTANTS, YouTubeApi } from '../../src/publish/youtube-api.js';
import { buildVideoMetadata } from '../../src/publish/youtube-meta.js';
import { fakeGoogle, googleError } from '../publish-helpers.js';

const MiB = 1024 * 1024;
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup(sizeMiB = 20) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'yt-'));
  dirs.push(dir);
  const file = path.join(dir, 'video.mp4');
  writeFileSync(file, '');
  truncateSync(file, sizeMiB * MiB);
  const g = fakeGoogle();
  const sleeps: number[] = [];
  const tokens: boolean[] = [];
  const now = new Date('2026-10-07T05:00:00Z');
  const quota = new QuotaLedger(dir, () => now);
  const api = new YouTubeApi({
    fetch: g.fetch,
    token: async (force) => (tokens.push(Boolean(force)), force ? 'fresh-token' : 'token'),
    quota,
    sleep: async (ms) => void sleeps.push(ms),
  });
  const metadata = buildVideoMetadata({
    title: 'T',
    description: 'D',
    tags: [],
    language: 'vi',
    audited: false,
  });
  return { dir, file, g, api, quota, sleeps, tokens, metadata, now };
}
const ranges = (g: ReturnType<typeof fakeGoogle>) =>
  g.to(/upload\.fake/).map((c) => c.headers['content-range']);

describe('resumable upload', () => {
  it('init request carries metadata + upload headers; 20 MiB goes in 8 MiB chunks; quota 1600 charged once', async () => {
    const s = setup(20);
    const sessions: string[] = [];
    const r = await s.api.insertVideo({
      file: s.file,
      metadata: s.metadata,
      onSession: (u) => sessions.push(u),
    });
    expect(r).toEqual({ id: 'yt_vid_001' });
    expect(UPLOAD_CONSTANTS.CHUNK).toBe(8 * MiB);
    const init = s.g.to(/uploadType=resumable/)[0]!;
    expect(init.method).toBe('POST');
    expect(init.url).toContain('part=snippet,status');
    expect(init.headers['x-upload-content-length']).toBe(String(20 * MiB));
    expect(init.headers['x-upload-content-type']).toBe('video/mp4');
    expect(init.headers.authorization).toBe('Bearer token');
    expect(init.body).toEqual(s.metadata);
    expect(sessions).toEqual(['https://upload.fake/session/abc']);
    expect(ranges(s.g)).toEqual([
      `bytes 0-${8 * MiB - 1}/${20 * MiB}`,
      `bytes ${8 * MiB}-${16 * MiB - 1}/${20 * MiB}`,
      `bytes ${16 * MiB}-${20 * MiB - 1}/${20 * MiB}`,
    ]);
    expect(s.quota.usedToday()).toBe(YT_UNITS.INSERT);
    expect(readQuotaUsed(s.dir, s.now)).toBe(1600);
  });

  it('a 503 on a chunk: back off, ask what was received, resend from there (no duplicate init)', async () => {
    const s = setup(20);
    let failed = false;
    s.g.inject = (c) => {
      // chỉ lỗi đúng lần đầu của khúc 2
      if (!failed && c.headers['content-range']?.startsWith(`bytes ${8 * MiB}-`)) {
        failed = true;
        return googleError(503, 'backendError');
      }
      return undefined;
    };
    const r = await s.api.insertVideo({ file: s.file, metadata: s.metadata });
    expect(r.id).toBe('yt_vid_001');
    expect(s.g.to(/uploadType=resumable/)).toHaveLength(1);
    expect(s.sleeps).toEqual([1000]);
    const rs = ranges(s.g);
    expect(rs).toEqual([
      `bytes 0-${8 * MiB - 1}/${20 * MiB}`,
      `bytes ${8 * MiB}-${16 * MiB - 1}/${20 * MiB}`, // lỗi 503
      `bytes */${20 * MiB}`, // hỏi vị trí
      `bytes ${8 * MiB}-${16 * MiB - 1}/${20 * MiB}`, // gửi lại
      `bytes ${16 * MiB}-${20 * MiB - 1}/${20 * MiB}`,
    ]);
    expect(s.quota.usedToday()).toBe(1600);
  });

  it('a network error mid-chunk after the server kept part of it: continues from the server offset', async () => {
    const s = setup(20);
    s.g.received.bytes = 0;
    let failedOnce = false;
    s.g.inject = (c) => {
      if (!failedOnce && c.headers['content-range']?.startsWith(`bytes ${8 * MiB}-`)) {
        failedOnce = true;
        s.g.received.bytes = 8 * MiB; // máy chủ vẫn giữ 8 MiB đầu
        return new Error('ECONNRESET');
      }
      return undefined;
    };
    await expect(s.api.insertVideo({ file: s.file, metadata: s.metadata })).resolves.toEqual({
      id: 'yt_vid_001',
    });
    expect(s.sleeps).toEqual([1000]);
    expect(s.g.received.bytes).toBe(20 * MiB);
  });

  it('gives up after 5 consecutive chunk failures', async () => {
    const s = setup(10);
    s.g.inject = (c) =>
      c.headers['content-range']?.startsWith('bytes 0-')
        ? googleError(500, 'backendError')
        : undefined;
    await expect(s.api.insertVideo({ file: s.file, metadata: s.metadata })).rejects.toMatchObject({
      code: 'E_PROVIDER_FAILED',
      message: expect.stringContaining('lỗi liên tục'),
    });
    expect(s.sleeps).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it('resumes from a saved session URI without a new init and without charging 1600 again', async () => {
    const s = setup(20);
    s.g.received.bytes = 8 * MiB; // phiên cũ đã nhận 8 MiB
    const r = await s.api.insertVideo({
      file: s.file,
      metadata: s.metadata,
      sessionUri: 'https://upload.fake/session/abc',
    });
    expect(r.id).toBe('yt_vid_001');
    expect(s.g.to(/uploadType=resumable/)).toHaveLength(0);
    expect(ranges(s.g)[0]).toBe(`bytes */${20 * MiB}`);
    expect(ranges(s.g)[1]).toBe(`bytes ${8 * MiB}-${16 * MiB - 1}/${20 * MiB}`);
    expect(s.quota.usedToday()).toBe(0);
  });

  it('an expired session (404) falls back to a fresh upload', async () => {
    const s = setup(5);
    s.g.inject = (c) =>
      c.headers['content-range']?.startsWith('bytes */')
        ? new Response('gone', { status: 404 })
        : undefined;
    const r = await s.api.insertVideo({
      file: s.file,
      metadata: s.metadata,
      sessionUri: 'https://upload.fake/session/old',
    });
    expect(r.id).toBe('yt_vid_001');
    expect(s.g.to(/uploadType=resumable/)).toHaveLength(1);
    expect(s.quota.usedToday()).toBe(1600);
  });

  it('an already-finished upload found while probing returns the video id', async () => {
    const s = setup(5);
    s.g.inject = (c) =>
      c.headers['content-range']?.startsWith('bytes */')
        ? new Response(JSON.stringify({ id: 'done_id' }), { status: 200 })
        : undefined;
    expect(
      await s.api.insertVideo({
        file: s.file,
        metadata: s.metadata,
        sessionUri: 'https://upload.fake/session/abc',
      }),
    ).toEqual({ id: 'done_id' });
  });

  it('quotaExceeded on init is explained; the quota was still counted (Google charges failed calls)', async () => {
    const s = setup(5);
    s.g.inject = (c) =>
      c.url.includes('uploadType=resumable')
        ? googleError(403, 'quotaExceeded', 'The request cannot be completed')
        : undefined;
    const e = (await s.api
      .insertVideo({ file: s.file, metadata: s.metadata })
      .catch((x: Error) => x)) as Error & { code: string };
    expect(e.code).toBe('E_PROVIDER_FAILED');
    expect(e.message).toContain('hết quota YouTube hôm nay');
    expect(s.quota.usedToday()).toBe(1600);
  });

  it('401 refreshes the token once and retries; a second 401 is an error', async () => {
    const s = setup(5);
    let n = 0;
    s.g.inject = (c) =>
      c.url.includes('channels?') && n++ === 0 ? googleError(401, 'authError') : undefined;
    expect(await s.api.channelsMine()).toEqual({
      id: 'UCaaaaaaaaaaaaaaaaaaaaa1',
      title: 'Sử Kể Mẫu',
    });
    expect(s.tokens).toEqual([false, true]);
    expect(s.g.to(/channels\?/)[1]!.headers.authorization).toBe('Bearer fresh-token');
    s.g.inject = () => googleError(401, 'authError');
    await expect(s.api.channelsMine()).rejects.toMatchObject({ code: 'E_PROVIDER_FAILED' });
  });
});

describe('other calls and quota', () => {
  it('videos.update (50), captions.insert (400), thumbnails.set (50), channels/videos.list (1 each)', async () => {
    const s = setup(1);
    await s.api.updateStatus('vid', { privacyStatus: 'public' });
    const upd = s.g.to(/videos\?part=status$/)[0]!;
    expect(upd.method).toBe('PUT');
    expect(upd.body).toEqual({
      id: 'vid',
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
      },
    });
    await s.api.insertCaption('vid', {
      language: 'vi',
      name: 'vi',
      srt: '1\n00:00:00,000 --> 00:00:01,000\nXin chào\n',
    });
    const cap = s.g.to(/captions/)[0]!;
    expect(cap.headers['content-type']).toMatch(/^multipart\/related; boundary=/);
    expect(String(cap.body)).toContain('"videoId":"vid"');
    expect(String(cap.body)).toContain('Xin chào');
    await s.api.setThumbnail('vid', new Uint8Array([1, 2, 3]), 'image/jpeg');
    expect(s.g.to(/thumbnails/)[0]!.headers['content-type']).toBe('image/jpeg');
    await s.api.channelsMine();
    expect(await s.api.videoStatus('vid')).toMatchObject({ privacyStatus: 'public' });
    expect(s.quota.usedToday()).toBe(50 + 400 + 50 + 1 + 1);
  });

  it('the quota ledger rolls over at midnight Pacific time and survives restarts', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'yt-'));
    dirs.push(dir);
    let now = new Date('2026-10-08T06:30:00Z'); // 23:30 ngày 7 giờ Thái Bình Dương (PDT)
    const l = new QuotaLedger(dir, () => now);
    expect(quotaDate(now)).toBe('2026-10-07');
    l.add(1600);
    l.add(400);
    expect(new QuotaLedger(dir, () => now).usedToday()).toBe(2000);
    now = new Date('2026-10-08T07:10:00Z'); // 00:10 ngày 8
    expect(l.usedToday()).toBe(0);
    l.add(1);
    expect(l.usedToday()).toBe(1);
    expect(l.left()).toBe(9999);
  });
});
