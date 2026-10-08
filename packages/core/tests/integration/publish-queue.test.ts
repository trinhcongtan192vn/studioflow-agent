// 074 — màn Duyệt trước khi đăng: video Autopilot đã làm xong, trạng thái đăng từng nền tảng, thông tin đăng.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVideo } from '../../src/domain/video.js';
import { publishQueue } from '../../src/publish/queue-view.js';
import { WriteStore } from '../../src/store/writer.js';
import { copyChannel } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function setup() {
  const c = copyChannel();
  cleanups.push(c.cleanup);
  const store = new WriteStore(c.dir);
  const w = (rel: string, content: string | Buffer) =>
    store.write(rel, content, { by: 'test', validate: false });
  const { video_id } = createVideo(store, { title: 'Lốc xoáy' });
  const v = `videos/${video_id}`;
  w(
    `${v}/publish.md`,
    '---\nschema_version: 1\ntitle: "Lốc xoáy hình thành thế nào"\ntags: ["lốc xoáy","thời tiết"]\nchapters: [{"start_ms":0,"title":"Mở đầu"}]\n---\nMô tả video.\n',
  );
  w(
    `${v}/renders/rd_bbbbbbbb/render.json`,
    JSON.stringify({
      id: 'rd_bbbbbbbb',
      mode: 'release',
      status: 'done',
      file: 'renders/rd_bbbbbbbb/video.mp4',
      output_profile: 'yt-1080p30',
      duration_ms: 150000,
      finished_at: '2026-10-08T02:00:00.000Z',
    }),
  );
  w(`${v}/renders/rd_bbbbbbbb/video.mp4`, Buffer.from('mp4'));
  const item = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    id,
    status,
    candidate_id: 'manual:x',
    title: `Mục ${id}`,
    angle: '',
    source: { kind: 'trend' },
    workflow_id: 'explainer',
    output_profile: 'yt-1080p30',
    publish_at: '2026-10-08T19:00:00+07:00',
    platforms: ['youtube'],
    score: 80,
    reasons: [],
    ...extra,
  });
  w(
    'autopilot/plans/2026-10-08.json',
    JSON.stringify({
      schema_version: 1,
      channel_id: 'ch_x',
      date: '2026-10-08',
      generated_at: '2026-10-08T00:00:00Z',
      capacity: { videos: 2, limiting_factor: 'cap', reasons: [] },
      items: [
        item('pi_aaaaaaaa', 'produced', {
          video_id,
          publish: {
            youtube: {
              status: 'scheduled',
              url: 'https://youtu.be/abc',
              veto_until: '2026-10-08T17:00:00+07:00',
            },
          },
        }),
        item('pi_bbbbbbbb', 'in_production'),
      ],
    }),
  );
  return { dir: c.dir, video: video_id };
}

describe('publishQueue (074)', () => {
  it('lists produced items with platform state, release render and publish metadata', () => {
    const s = setup();
    const q = publishQueue(s.dir, { now: new Date('2026-10-08T08:00:00Z') });
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      date: '2026-10-08',
      item_id: 'pi_aaaaaaaa',
      video_id: s.video,
      publish_at: '2026-10-08T19:00:00+07:00',
      platforms: ['youtube'],
      publish: { youtube: { status: 'scheduled', url: 'https://youtu.be/abc' } },
      stage: 'pending',
      meta: {
        title: 'Lốc xoáy hình thành thế nào',
        description: 'Mô tả video.',
        tags: ['lốc xoáy', 'thời tiết'],
        chapters: 1,
      },
      render: { duration_ms: 150000 },
    });
    expect(q[0]!.render!.file).toMatch(/video\.mp4$/);
    // hết giờ phản đối → đã lên nền tảng (theo lịch)
    expect(publishQueue(s.dir, { now: new Date('2026-10-08T12:00:00Z') })[0]!.stage).toBe(
      'published',
    );
  });

  it('a platform that is not connected does not keep the video in "pending" (078)', () => {
    const s = setup();
    const f = path.join(s.dir, 'autopilot/plans/2026-10-08.json');
    const plan = JSON.parse(readFileSync(f, 'utf8'));
    plan.items[0].platforms = ['youtube', 'tiktok'];
    plan.items[0].publish = {
      youtube: { status: 'public', url: 'https://youtu.be/abc' },
      tiktok: { status: 'pending', error: 'Kênh chưa kết nối TikTok' },
    };
    writeFileSync(f, JSON.stringify(plan));
    expect(publishQueue(s.dir, { now: new Date('2026-10-08T08:00:00Z') })[0]!.stage).toBe(
      'published',
    );
  });

  it('a channel without plans has an empty queue', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    expect(publishQueue(c.dir)).toEqual([]);
  });
});
