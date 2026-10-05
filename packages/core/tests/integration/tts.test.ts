// 006 · US1–US3, US5 · FR-003..008 — TTS qua build graph, provider giả (SF_GPU=0), tool voice/tts.
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createCore,
  validateArtifact,
  type Core,
  type PermissionRequest,
  type SessionContext,
} from '../../src/index.js';
import { writeWav } from '../worker-helpers.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function setup(): { core: Core; dir: string; session: SessionContext; v: string } {
  const c = copyChannel();
  const t = tempDir('app-');
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 1000, backoffMs: [10, 20] });
  cleanups.push(() => {
    core.close();
    c.cleanup();
    t.cleanup();
  });
  return {
    core,
    dir: c.dir,
    v: path.join(c.dir, 'videos', fixtureVideoId),
    session: {
      session_id: 'ss_test0001',
      kind: 'main',
      channel_dir: c.dir,
      video_id: fixtureVideoId,
    },
  };
}

async function waitJob(core: Core, session: SessionContext, r: { ok: boolean; job_id?: string }) {
  expect(r).toMatchObject({ ok: true, job_id: expect.any(String) });
  const done = await core.gateway.call(session, 'job.wait', {
    job_id: r.job_id,
    timeout_ms: 20000,
  });
  return (done as { data: { status: string; result: unknown; error?: unknown } }).data;
}

describe('tts.synthesize via build graph (006 US1, US3)', () => {
  it('synthesizes every line with tts.fake, writes audio_meta.json and provenance', async () => {
    const { core, session, v } = setup();
    const job = await waitJob(
      core,
      session,
      (await core.gateway.call(session, 'tts.synthesize', { line_ids: 'all' })) as never,
    );
    expect(job.status).toBe('succeeded');
    for (const ln of ['ln_2r7c4kxm', 'ln_9w3b6tqa', 'ln_5h8q2m3x'])
      expect(existsSync(path.join(v, 'audio/lines', `${ln}.wav`))).toBe(true);
    const meta = readFileSync(path.join(v, 'audio_meta.json'), 'utf8');
    expect(validateArtifact(`videos/${fixtureVideoId}/audio_meta.json`, meta).errors).toEqual([]);
    expect(JSON.parse(meta).lines[1]).toMatchObject({
      line_id: 'ln_9w3b6tqa',
      speaker: 'ca_a7f2k9wd',
      voice_id: 'vo_c3z8p1mn',
    });
    const provs = readdirSync(path.join(v, 'provenance')).map((f) =>
      JSON.parse(readFileSync(path.join(v, 'provenance', f), 'utf8')),
    );
    expect(
      provs.filter((p) => p.provider === 'tts.fake' && p.output.startsWith('audio/lines/')),
    ).toHaveLength(3);
  });

  it('editing one line regenerates only that line (FR-VO-04)', async () => {
    const { core, session, v } = setup();
    await waitJob(
      core,
      session,
      (await core.gateway.call(session, 'tts.synthesize', { line_ids: 'all' })) as never,
    );
    const before = readdirSync(path.join(v, 'provenance')).length;
    const p = path.join(v, 'SCRIPT.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace('Bệ hạ…', 'Tâu bệ hạ…'));
    const job = await waitJob(
      core,
      session,
      (await core.gateway.call(session, 'tts.synthesize', { line_ids: 'all' })) as never,
    );
    const built = Object.entries(
      (job.result as { nodes: Record<string, { status: string }> }).nodes,
    )
      .filter(([, n]) => n.status === 'built')
      .map(([id]) => id);
    expect(built.filter((id) => id.startsWith('audio.line:'))).toEqual(['audio.line:ln_9w3b6tqa']);
    expect(readdirSync(path.join(v, 'provenance')).length).toBe(before + 1);
  });

  it('a line without a voice fails with a clear error', async () => {
    const { core, session, dir } = setup();
    const ch = JSON.parse(readFileSync(path.join(dir, 'channel.json'), 'utf8'));
    delete ch.config['voice.id'];
    writeFileSync(path.join(dir, 'channel.json'), JSON.stringify(ch));
    const job = await waitJob(
      core,
      session,
      (await core.gateway.call(session, 'tts.synthesize', { line_ids: ['ln_2r7c4kxm'] })) as never,
    );
    // narrator mất giọng; line của nhân vật vẫn dùng voice_id của cast → partial
    expect(job.status).toBe('partial');
    const nodes = (
      job.result as { nodes: Record<string, { status: string; error?: { message: string } }> }
    ).nodes;
    expect(nodes['audio.line:ln_2r7c4kxm']).toMatchObject({
      status: 'failed',
      error: { message: expect.stringContaining('no voice') },
    });
    expect(nodes['audio.line:ln_9w3b6tqa']!.status).toBe('built');
  });

  it('asks before a batch above policy.batch.tts_lines', async () => {
    const { core, session } = setup();
    const sp = path.join(core.appDataDir, 'settings.json');
    const s = JSON.parse(readFileSync(sp, 'utf8'));
    s.config['policy.batch.tts_lines'] = 1;
    writeFileSync(sp, JSON.stringify(s));
    const asked: PermissionRequest[] = [];
    core.gateway.permissions.on('permission.requested', (r: PermissionRequest) => {
      asked.push(r);
      core.gateway.permissions.decide({ request_id: r.request_id, allow: false });
    });
    expect(await core.gateway.call(session, 'tts.synthesize', { line_ids: 'all' })).toMatchObject({
      ok: false,
      error: { code: 'E_PERMISSION_DECLINED' },
    });
    expect(asked[0]).toMatchObject({ tool: 'tts.synthesize', kind: 'batch_gen' });
  });
});

describe('voice tools (006 US2)', () => {
  it('voice.profile_create clones from an upload and writes voices/<vo>/', async () => {
    const { core, session, dir, v } = setup();
    writeWav(path.join(v, 'uploads', 'ref.wav'), 5000);
    const job = await waitJob(
      core,
      session,
      (await core.gateway.call(session, 'voice.profile_create', {
        name: 'Người dẫn',
        ref_audio: 'uploads/ref.wav',
        language: 'vi',
      })) as never,
    );
    expect(job.status).toBe('succeeded');
    const voiceId = (job.result as { voice_id: string }).voice_id;
    expect(voiceId).toMatch(/^vo_[0-9a-z]{8}$/);
    for (const f of ['voice.pt', 'ref.wav', 'profile.json'])
      expect(existsSync(path.join(dir, 'voices', voiceId, f))).toBe(true);
    expect(
      JSON.parse(readFileSync(path.join(dir, 'voices', voiceId, 'profile.json'), 'utf8')),
    ).toMatchObject({
      voice_id: voiceId,
      name: 'Người dẫn',
      language: 'vi',
      provider: 'tts.fake',
    });
  });

  it('voice.profile_create rejects a too-short sample', async () => {
    const { core, session, v } = setup();
    writeWav(path.join(v, 'uploads', 'short.wav'), 1000);
    const job = await waitJob(
      core,
      session,
      (await core.gateway.call(session, 'voice.profile_create', {
        name: 'x',
        ref_audio: 'uploads/short.wav',
        language: 'vi',
      })) as never,
    );
    expect(job).toMatchObject({ status: 'failed', error: { code: 'E_AUDIO_UNSUPPORTED' } });
  });

  it('voice.design creates a suggested voice usable for TTS (033 SC-001)', async () => {
    const { core, session, dir } = setup();
    const design = async (seed?: number) =>
      waitJob(
        core,
        session,
        (await core.gateway.call(session, 'voice.design', {
          name: 'Giọng nữ trẻ',
          gender: 'female',
          age: 'young adult',
          pitch: 'moderate',
          for: 'narrator',
          ...(seed !== undefined ? { seed } : {}),
        })) as never,
      );
    const job = await design();
    expect(job.status).toBe('succeeded');
    const r = job.result as { voice_id: string; preview: string; for: string; design: unknown };
    expect(r).toMatchObject({
      for: 'narrator',
      preview: `voices/${r.voice_id}/ref.wav`,
      design: { instruct: 'female, young adult, moderate pitch' },
    });
    for (const f of ['voice.pt', 'ref.wav', 'profile.json'])
      expect(existsSync(path.join(dir, 'voices', r.voice_id, f))).toBe(true);
    expect(
      JSON.parse(readFileSync(path.join(dir, 'voices', r.voice_id, 'profile.json'), 'utf8')),
    ).toMatchObject({
      name: 'Giọng nữ trẻ',
      language: 'vi',
      design: { instruct: 'female, young adult, moderate pitch' },
      suggested_for: 'narrator',
    });
    // khác seed → giọng khác (file voice.pt khác)
    const other = (await design(7)).result as { voice_id: string };
    expect(other.voice_id).not.toBe(r.voice_id);
    expect(readFileSync(path.join(dir, 'voices', other.voice_id, 'voice.pt'), 'utf8')).not.toBe(
      readFileSync(path.join(dir, 'voices', r.voice_id, 'voice.pt'), 'utf8'),
    );
    // dùng được để đọc thử
    const pv = await waitJob(
      core,
      session,
      (await core.gateway.call(session, 'voice.preview', {
        voice_id: r.voice_id,
        text: 'Thử giọng',
      })) as never,
    );
    expect(pv.status).toBe('succeeded');
  });

  it('voice.design rejects an accent for a non-English channel', async () => {
    const { core, session } = setup();
    const r = (await core.gateway.call(session, 'voice.design', {
      name: 'x',
      gender: 'male',
      age: 'elderly',
      pitch: 'low',
      accent: 'british',
    })) as { ok: boolean; error?: { code: string } };
    expect(r).toMatchObject({ ok: false, error: { code: 'E_SCHEMA_INVALID' } });
  });

  it('voice.preview renders a preview file', async () => {
    const { core, session, v } = setup();
    const job = await waitJob(
      core,
      session,
      (await core.gateway.call(session, 'voice.preview', {
        voice_id: 'vo_c3z8p1mn',
        text: 'Thử giọng',
      })) as never,
    );
    const file = (job.result as { file: string }).file;
    expect(file).toMatch(/^\.sf\/preview\/tts-[0-9a-f]{12}\.wav$/);
    expect(existsSync(path.join(v, file))).toBe(true);
  });

  it('voice/tts tools are main-only', async () => {
    const { core, session } = setup();
    expect(
      await core.gateway.call({ ...session, kind: 'frame' }, 'tts.synthesize', { line_ids: 'all' }),
    ).toMatchObject({ error: { code: 'E_TOOL_DENIED' } });
  });
});
