// 004 · US5 · FR-017, FR-018 — tool job.* / graph.* và CLI.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type PermissionRequest } from '../../src/index.js';
import { runSf } from '../helpers.js';
import {
  copyChannel,
  fixtureAppData,
  fixtureChannel,
  fixtureVideoId,
  tempDir,
} from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function core() {
  const c = copyChannel();
  const t = tempDir('core-');
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const app = createCore({ appDataDir: t.dir, permissionTimeoutMs: 1000, backoffMs: [10, 20] });
  cleanups.push(() => {
    app.close();
    c.cleanup();
    t.cleanup();
  });
  app.graph.registerBuilder('audio.line', async (ctx) => {
    const file = `audio/lines/${ctx.key}.wav`;
    ctx.store.write(`${ctx.videoRel}/${file}`, Buffer.from('x'), { by: 'test' });
    return {
      outputs: [file],
      meta: { duration_ms: 1000, voice_id: 'vo_c3z8p1mn', file, content_hash: ctx.inputHash },
    };
  });
  const session = {
    session_id: 'ss_test0001' as const,
    kind: 'main' as const,
    channel_dir: c.dir,
    video_id: fixtureVideoId,
  };
  return { app, session, dir: c.dir, appData: t.dir };
}

describe('graph.* / job.* tools (004 US5)', () => {
  it('graph.status/plan/build and job.wait through the Gateway', async () => {
    const { app, session } = core();
    const st = await app.gateway.call(session, 'graph.status', {});
    expect(st).toMatchObject({ ok: true, data: { nodes: expect.any(Array) } });
    const plan = await app.gateway.call(session, 'graph.plan', {});
    expect((plan as { data: { jobs: unknown[] } }).data.jobs.length).toBe(5); // 3 audio + audio_meta + frame_timing
    const build = await app.gateway.call(session, 'graph.build', {});
    expect(build).toMatchObject({ ok: true, job_id: expect.stringMatching(/^jb_/) });
    const id = (build as { job_id: string }).job_id;
    const done = await app.gateway.call(session, 'job.wait', { job_id: id, timeout_ms: 5000 });
    expect(done).toMatchObject({ ok: true, data: { status: 'succeeded', kind: 'graph.build' } });
    expect(await app.gateway.call(session, 'job.list', {})).toMatchObject({
      ok: true,
      data: { jobs: [expect.objectContaining({ id })] },
    });
    expect(await app.gateway.call(session, 'job.status', { job_id: id })).toMatchObject({
      data: { status: 'succeeded' },
    });
    expect(await app.gateway.call(session, 'job.cancel', { job_id: id })).toMatchObject({
      data: { status: 'succeeded' },
    });
    expect(await app.gateway.call({ ...session, kind: 'frame' }, 'graph.build', {})).toMatchObject({
      error: { code: 'E_TOOL_DENIED' },
    });
  });

  it('graph.build asks before generating more than policy.batch.tts_lines lines', async () => {
    const { app, session, appData } = core();
    // policy.batch.tts_lines chỉ đặt được ở tầng app (settings.json)
    const sp = path.join(appData, 'settings.json');
    const settings = JSON.parse(readFileSync(sp, 'utf8'));
    settings.config['policy.batch.tts_lines'] = 2;
    writeFileSync(sp, JSON.stringify(settings));
    const asked: PermissionRequest[] = [];
    app.gateway.permissions.on('permission.requested', (r: PermissionRequest) => {
      asked.push(r);
      app.gateway.permissions.decide({ request_id: r.request_id, allow: false });
    });
    const r = await app.gateway.call(session, 'graph.build', {});
    expect(asked[0]).toMatchObject({ kind: 'batch_gen', tool: 'graph.build' });
    expect(r).toMatchObject({ ok: false, error: { code: 'E_PERMISSION_DECLINED' } });
  });

  it('job.status of an unknown id → E_ID_UNKNOWN', async () => {
    const { app, session } = core();
    expect(await app.gateway.call(session, 'job.status', { job_id: 'jb_00000000' })).toMatchObject({
      error: { code: 'E_ID_UNKNOWN' },
    });
  });
});

describe('sf graph / sf job (004 FR-018)', () => {
  it('graph status and plan', () => {
    const st = runSf(['graph', 'status', '--channel', fixtureChannel, '--video', fixtureVideoId]);
    expect(st.stderr).toBe('');
    const nodes = JSON.parse(st.stdout).nodes as { status: string }[];
    expect(nodes.length).toBeGreaterThan(0);
    const plan = runSf(['graph', 'plan', '--channel', fixtureChannel, '--video', fixtureVideoId]);
    expect(JSON.parse(plan.stdout).jobs.length).toBeGreaterThan(0);
  });

  it('job list and cancel use the app database', () => {
    const t = tempDir('appdata-');
    cleanups.push(t.cleanup);
    const env = { SF_APP_DATA: t.dir };
    const r = runSf(['job', 'list'], { env });
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual({ jobs: [] });
    const c = runSf(['job', 'cancel', 'jb_00000000'], { env });
    expect(c.code).toBe(1);
    expect(JSON.parse(c.stderr).code).toBe('E_ID_UNKNOWN');
  });
});
