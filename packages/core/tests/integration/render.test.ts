// 013 · US1–US3 · FR-RD-01..03, AC-M1-05, SC-001/002 — render thật bằng HyperFrames + FFmpeg trên
// video mẫu (frame hợp lệ dựng sẵn, giọng/caption giả SF_GPU=0).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BuildGraph,
  buildFramePacket,
  createCore,
  designSystemExecutor,
  loadVideoModel,
  measureLoudness,
  validateArtifact,
  type Core,
  type SessionContext,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';
import { sampleFrame } from '../frame-helpers.js';

const c = copyChannel();
const t = tempDir('app-');
const v = path.join(c.dir, 'videos', fixtureVideoId);
let core: Core;
let session: SessionContext;
let canceledAt = 0;

async function job(tool: string, input: unknown, cancelAfterMs?: number) {
  const r = (await core.gateway.call(session, tool, input)) as {
    ok: boolean;
    job_id: string;
    data: { render_id: string };
  };
  expect(r.ok).toBe(true);
  if (cancelAfterMs !== undefined) {
    // chờ tới khi đang render (tiến độ > 10%) rồi hủy
    const t0 = Date.now();
    for (;;) {
      const s = (await core.gateway.call(session, 'job.status', { job_id: r.job_id })) as {
        data: { progress: { done: number } };
      };
      if (s.data.progress.done > 12 || Date.now() - t0 > 60_000) break;
      await new Promise((res) => setTimeout(res, 200));
    }
    canceledAt = Date.now();
    await core.gateway.call(session, 'job.cancel', { job_id: r.job_id });
  }
  const done = (await core.gateway.call(session, 'job.wait', {
    job_id: r.job_id,
    timeout_ms: 600_000,
  })) as {
    data: {
      status: string;
      result: {
        id: string;
        file: string;
        status: string;
        gate_results: { gate: string; pass: boolean }[];
      };
      error?: { code: string; message: string };
    };
  };
  return {
    ...done.data,
    render_id: r.data.render_id,
    stoppedMs: canceledAt ? Date.now() - canceledAt : 0,
  };
}

beforeAll(async () => {
  process.env.SF_GPU = '0';
  writeFileSync(
    path.join(t.dir, 'settings.json'),
    readFileSync(path.join(fixtureAppData, 'settings.json')),
  );
  core = createCore({
    appDataDir: t.dir,
    dbFile: path.join(t.dir, 'jobs.db'),
    permissionTimeoutMs: 1000,
    backoffMs: [10, 20],
  });
  session = {
    session_id: 'ss_test0001',
    kind: 'main',
    channel_dir: c.dir,
    video_id: fixtureVideoId,
  };
  const store = core.gateway.storeFor(c.dir);
  const step = { id: 'ds', uses: 'design-system', title: 'DS' };
  await designSystemExecutor()({
    store,
    channelDir: c.dir,
    videoId: fixtureVideoId,
    step,
    manifest: { id: 't', steps: [step] },
    signal: new AbortController().signal,
    appDataDir: t.dir,
  } as never);
  const g = new BuildGraph({ store, appDataDir: t.dir, builders: core.graph });
  await g.build(fixtureVideoId, { targets: ['frame_timing', 'captions'] });
  const timing = JSON.parse(readFileSync(path.join(v, '.sf', 'graph.json'), 'utf8')).nodes
    .frame_timing.meta;
  const model = loadVideoModel(c.dir, fixtureVideoId);
  for (const f of model.frames)
    store.write(
      `videos/${fixtureVideoId}/compositions/frames/${f.id}.html`,
      sampleFrame(buildFramePacket({ model, timing, frameId: f.id, assets: [] })),
      { by: 'test', validate: false },
    );
}, 300_000);
afterAll(() => {
  core?.close();
  c.cleanup();
  t.cleanup();
});

const probe = (f: string) =>
  spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_name,width,height,r_frame_rate,sample_rate',
      '-of',
      'json',
      f,
    ],
    { encoding: 'utf8' },
  ).stdout;

describe('render (013)', () => {
  it('draft: MP4 per output profile, loudness normalized, record valid, data-sf-id untouched', async () => {
    const frame = path.join(v, 'compositions', 'frames', 'fr_9x2b7cqe.html');
    const r = await job('render.video', { mode: 'draft' });
    expect(r.status).toBe('succeeded');
    expect(readFileSync(frame, 'utf8')).toContain('data-sf-id="el_t5w8n3ja"');
    const rec = readFileSync(path.join(v, 'renders', r.render_id, 'render.json'), 'utf8');
    expect(
      validateArtifact(`videos/${fixtureVideoId}/renders/${r.render_id}/render.json`, rec).errors,
    ).toEqual([]);
    expect(JSON.parse(rec)).toMatchObject({
      status: 'done',
      mode: 'draft',
      output_profile: 'yt-1080p30',
      file: `renders/${r.render_id}/video.mp4`,
    });
    const mp4 = path.join(v, 'renders', r.render_id, 'video.mp4');
    const streams = JSON.parse(probe(mp4)).streams;
    expect(streams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          r_frame_rate: '30/1',
        }),
        expect.objectContaining({ codec_name: 'aac', sample_rate: '48000' }),
      ]),
    );
    const lufs = Number((await measureLoudness(mp4, -14)).input_i);
    expect(Math.abs(lufs + 14)).toBeLessThanOrEqual(1);
    expect(existsSync(path.join(v, 'renders', r.render_id, 'CREDITS.txt'))).toBe(false);
  }, 600_000);

  it('release: failing gates stop the render; once approved it renders with description.txt', async () => {
    const stPath = path.join(v, 'state.json');
    const st = JSON.parse(readFileSync(stPath, 'utf8'));
    st.phase = 'workflow';
    st.approvals = [
      {
        id: 'ap_aaaaaaaa',
        step_id: 'script',
        status: 'pending',
        requested_at: '2026-10-04T00:00:00Z',
        artifact_hashes: {},
      },
    ];
    writeFileSync(stPath, JSON.stringify(st, null, 2));
    const bad = await job('render.video', { mode: 'release' });
    expect(bad.status).toBe('failed');
    expect(bad.error).toMatchObject({
      code: 'E_GATE_FAILED',
      message: expect.stringContaining('approvals'),
    });
    expect(
      JSON.parse(readFileSync(path.join(v, 'renders', bad.render_id, 'render.json'), 'utf8'))
        .status,
    ).toBe('failed');
    st.approvals[0].status = 'approved';
    writeFileSync(stPath, JSON.stringify(st, null, 2));
    const ok = await job('render.video', { mode: 'release' });
    expect(ok.status).toBe('succeeded');
    expect(ok.result.gate_results.every((g) => g.pass)).toBe(true);
    expect(
      readFileSync(path.join(v, 'renders', ok.render_id, 'description.txt'), 'utf8').length,
    ).toBeGreaterThan(0);
  }, 900_000);

  it('cancel stops the render within 5 s and marks it canceled', async () => {
    const r = await job('render.video', { mode: 'draft' }, 0);
    expect(r.status).toBe('canceled');
    expect(r.stoppedMs).toBeLessThanOrEqual(5000);
    expect(
      JSON.parse(readFileSync(path.join(v, 'renders', r.render_id, 'render.json'), 'utf8')).status,
    ).toBe('canceled');
  }, 300_000);

  it('AC-M1-05: a render interrupted by closing the app is marked failed on reopen', async () => {
    // giả lập tắt app giữa lúc render: job `running` trong DB, render.json `running`
    core.queue.stop();
    const r = (await core.gateway.call(session, 'render.video', { mode: 'draft' })) as {
      job_id: string;
      data: { render_id: string };
    };
    core.db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(r.job_id);
    const rd = r.data.render_id;
    const recFile = path.join(v, 'renders', rd, 'render.json');
    const rec = existsSync(recFile)
      ? JSON.parse(readFileSync(recFile, 'utf8'))
      : {
          schema_version: 1,
          id: rd,
          mode: 'draft',
          output_profile: 'yt-1080p30',
          started_at: '2026-10-04T00:00:00Z',
          gate_results: [],
          index_hash: '0'.repeat(64),
        };
    mkdirSync(path.dirname(recFile), { recursive: true });
    writeFileSync(recFile, JSON.stringify({ ...rec, status: 'running' }));
    core.close();
    core = createCore({
      appDataDir: t.dir,
      dbFile: path.join(t.dir, 'jobs.db'),
      permissionTimeoutMs: 1000,
    });
    const info = (await core.gateway.call(session, 'job.status', { job_id: r.job_id })) as {
      data: { status: string; error: { code: string } };
    };
    expect(info.data).toMatchObject({ status: 'failed', error: { code: 'E_JOB_INTERRUPTED' } });
    expect(JSON.parse(readFileSync(recFile, 'utf8')).status).toBe('failed');
  }, 300_000);
});
