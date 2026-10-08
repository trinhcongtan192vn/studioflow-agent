// 070 — thẻ video ở sidebar: loại (dọc/ngang), trạng thái, tiến độ bước, bước hiện tại, ảnh đại diện.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { videoCard, videoStatus } from '../../src/domain/video-card.js';
import { createVideo } from '../../src/domain/video.js';
import { WriteStore } from '../../src/store/writer.js';
import { copyChannel } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

type Steps = Record<string, { status: string; attempt: number }>;
const s = (...st: string[]): Steps =>
  Object.fromEntries(st.map((x, i) => [`s${i}`, { status: x, attempt: 1 }]));

describe('videoStatus (070)', () => {
  it('picks failed > waiting > running > done > paused; briefing before a workflow', () => {
    expect(videoStatus('briefing', {})).toBe('briefing');
    expect(videoStatus('workflow', s('done', 'failed', 'waiting_approval'))).toBe('failed');
    expect(videoStatus('workflow', s('done', 'waiting_approval', 'running'))).toBe('waiting');
    expect(videoStatus('workflow', s('done', 'running', 'pending'))).toBe('running');
    expect(videoStatus('workflow', s('done', 'skipped'))).toBe('done');
    expect(videoStatus('workflow', s('done', 'pending'))).toBe('paused');
    expect(videoStatus('workflow', s('done', 'stale'))).toBe('paused');
  });
});

describe('videoCard (070)', () => {
  it('summarises a video in workflow', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const store = new WriteStore(c.dir);
    const { video_id } = createVideo(store, { title: 'Shorts thử' });
    const f = store.abs(`videos/${video_id}/state.json`);
    const st = JSON.parse(readFileSync(f, 'utf8'));
    st.phase = 'workflow';
    st.workflow = { id: 'shorts', version: '1.0.0' };
    st.output_profile = 'yt-shorts-1080x1920';
    st.steps = {
      design: { status: 'done', attempt: 1 },
      script: { status: 'failed', attempt: 1 },
      voice: { status: 'pending', attempt: 0 },
    };
    writeFileSync(f, JSON.stringify(st));
    store.write(`videos/${video_id}/thumbnail.jpg`, Buffer.from('x'), {
      by: 'test',
      validate: false,
    });
    const card = videoCard(c.dir, video_id, () => ({ script: 'Kịch bản' }))!;
    expect(card).toMatchObject({
      id: video_id,
      title: 'Shorts thử',
      format: 'vertical',
      status: 'failed',
      steps: { done: 1, total: 3 },
      current: { id: 'script', title: 'Kịch bản' },
      thumbnail: path.join(c.dir, 'videos', video_id, 'thumbnail.jpg'),
    });
  });

  it('a new video is briefing, no format, no thumbnail', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const { video_id } = createVideo(new WriteStore(c.dir), {});
    const card = videoCard(c.dir, video_id, () => undefined)!;
    expect(card).toMatchObject({ title: video_id, status: 'briefing', format: null });
    expect(card.steps).toEqual({ done: 0, total: 0 });
    expect(card.thumbnail).toBeUndefined();
    expect(card.current).toBeUndefined();
  });
});
