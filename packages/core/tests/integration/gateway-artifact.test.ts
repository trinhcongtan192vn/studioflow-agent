// 003 · US1, US2 AC2–4 · FR-005..008, FR-012..016.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '../../src/index.js';
import { fixtureVideoId } from '../domain-helpers.js';
import { gatewayFixture, type GatewayFixture } from '../gateway-helpers.js';

let fx: GatewayFixture;
afterEach(() => fx?.cleanup());
const vpath = (f: string) => path.join(fx.dir, 'videos', fixtureVideoId, f);

describe('artifact.* (003 US1)', () => {
  it('read returns content, hash, schema_version', async () => {
    fx = gatewayFixture();
    const r = await fx.gw.call(fx.session(), 'artifact.read', { path: 'SCRIPT.md' });
    const text = readFileSync(vpath('SCRIPT.md'), 'utf8');
    expect(r).toEqual({ ok: true, data: { content: text, hash: sha256(text), schema_version: 1 } });
  });

  it('read of a binary file returns base64; > 1 MB is refused', async () => {
    fx = gatewayFixture();
    mkdirSync(vpath('audio/lines'), { recursive: true });
    writeFileSync(vpath('audio/lines/a.wav'), Buffer.from([0, 255, 1]));
    const r = await fx.gw.call(fx.session(), 'artifact.read', { path: 'audio/lines/a.wav' });
    expect(r).toMatchObject({ ok: true, data: { content: 'AP8B', encoding: 'base64' } });
    writeFileSync(vpath('big.txt'), 'x'.repeat(1024 * 1024 + 1));
    expect(await fx.gw.call(fx.session(), 'artifact.read', { path: 'big.txt' })).toMatchObject({
      ok: false,
    });
  });

  it('write assigns ids to new storyboard elements', async () => {
    fx = gatewayFixture();
    const sb = readFileSync(vpath('STORYBOARD.md'), 'utf8').replace(
      '{ id: el_q2k7m4zp, kind: text',
      '{ kind: text',
    );
    const r = await fx.gw.call(fx.session(), 'artifact.write', {
      path: 'STORYBOARD.md',
      content: sb,
    });
    expect(r.ok).toBe(true);
    const data = (r as { data: { hash: string; assigned_ids: string[] } }).data;
    expect(data.assigned_ids).toHaveLength(1);
    expect(data.assigned_ids[0]).toMatch(/^el_/);
    const written = readFileSync(vpath('STORYBOARD.md'), 'utf8');
    expect(written).toContain(data.assigned_ids[0]);
    expect(data.hash).toBe(sha256(written));
  });

  it('write rejects schema-invalid content with details', async () => {
    fx = gatewayFixture();
    const r = await fx.gw.call(fx.session(), 'artifact.write', {
      path: 'audio_meta.json',
      content: '{"schema_version":1}',
    });
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'E_SCHEMA_INVALID', retryable: false, details: expect.any(Array) },
    });
  });

  it('write checks base_hash', async () => {
    fx = gatewayFixture();
    const cur = readFileSync(vpath('caption-overrides.json'), 'utf8');
    const ok = await fx.gw.call(fx.session(), 'artifact.write', {
      path: 'caption-overrides.json',
      content: cur,
      base_hash: sha256(cur),
    });
    expect(ok.ok).toBe(true);
    const bad = await fx.gw.call(fx.session(), 'artifact.write', {
      path: 'caption-overrides.json',
      content: cur,
      base_hash: 'f'.repeat(64),
    });
    expect(bad).toMatchObject({ ok: false, error: { code: 'E_BASE_HASH_MISMATCH' } });
  });

  it('write checks config tiers in state.json', async () => {
    fx = gatewayFixture();
    const state = JSON.parse(readFileSync(vpath('state.json'), 'utf8'));
    state.config_overrides['frame_build.parallel'] = 4;
    const r = await fx.gw.call(fx.session(), 'artifact.write', {
      path: 'state.json',
      content: JSON.stringify(state),
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'E_CONFIG_SCOPE' } });
  });

  it('validate runs cross-reference checks with provided content', async () => {
    fx = gatewayFixture();
    const sb = readFileSync(vpath('STORYBOARD.md'), 'utf8').replace(
      'line_ids: [ln_5h8q2m3x]',
      'line_ids: [ln_zzzzzzzz]',
    );
    const r = await fx.gw.call(fx.session(), 'artifact.validate', {
      path: 'STORYBOARD.md',
      content: sb,
    });
    expect(r).toMatchObject({ ok: true, data: { valid: false } });
    const errs = (r as { data: { errors: { code: string }[] } }).data.errors.map((e) => e.code);
    expect(errs).toContain('E_ID_UNKNOWN');
    expect(
      await fx.gw.call(fx.session(), 'artifact.validate', { path: 'SCRIPT.md' }),
    ).toMatchObject({ ok: true, data: { valid: true } });
  });

  it('list matches a glob inside the video and skips .sf', async () => {
    fx = gatewayFixture();
    mkdirSync(vpath('.sf/tmp'), { recursive: true });
    writeFileSync(vpath('.sf/tmp/x.md'), '');
    const r = await fx.gw.call(fx.session(), 'artifact.list', { glob: '*.md' });
    expect((r as { data: { paths: string[] } }).data.paths).toEqual([
      'BRIEF.md',
      'CAST.md',
      'SCRIPT.md',
      'STORY.md',
      'STORYBOARD.md',
      'frame.md',
      'publish.md',
    ]);
    const deep = await fx.gw.call(fx.session(), 'artifact.list', { glob: '**/*.json' });
    expect((deep as { data: { paths: string[] } }).data.paths).toContain(
      'reviews/script/round-1.json',
    );
    expect(await fx.gw.call(fx.session(), 'artifact.list', { glob: '../**' })).toMatchObject({
      ok: false,
      error: { code: 'E_PATH_OUTSIDE' },
    });
  });

  it('read_only_videos can be read with video: prefix but not written', async () => {
    fx = gatewayFixture();
    const other = {
      channel_dir: fx.dir,
      video_id: 'vd_00000000' as const,
      read_only_videos: [fixtureVideoId],
    };
    mkdirSync(path.join(fx.dir, 'videos', 'vd_00000000'), { recursive: true });
    const s = fx.session(other as never);
    expect(
      await fx.gw.call(s, 'artifact.read', { path: `video:${fixtureVideoId}/SCRIPT.md` }),
    ).toMatchObject({ ok: true });
    expect(
      await fx.gw.call(s, 'artifact.write', {
        path: `video:${fixtureVideoId}/notes.md`,
        content: 'x',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'E_SCOPE_DENIED' },
    });
    expect(
      await fx.gw.call(fx.session({ read_only_videos: [] }), 'artifact.read', {
        path: 'video:vd_00000000/x.md',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'E_SCOPE_DENIED' },
    });
  });

  it('channel-level session paths are relative to the channel', async () => {
    fx = gatewayFixture();
    const s = fx.session({ video_id: undefined });
    expect(await fx.gw.call(s, 'artifact.read', { path: 'channel.json' })).toMatchObject({
      ok: true,
    });
  });
});

describe('scope and owner (003 US2)', () => {
  it('frame session may only write allowed_paths', async () => {
    fx = gatewayFixture();
    const s = fx.session({
      kind: 'frame',
      frame_id: 'fr_9x2b7cqe',
      allowed_paths: ['compositions/frames/fr_9x2b7cqe.html'],
    });
    expect(
      await fx.gw.call(s, 'artifact.write', {
        path: 'compositions/frames/fr_9x2b7cqe.html',
        content: '<div data-sf-id="el_t5w8n3ja"></div>',
      }),
    ).toMatchObject({ ok: true });
    expect(await fx.gw.call(s, 'artifact.write', { path: 'notes.md', content: 'x' })).toMatchObject(
      { ok: false, error: { code: 'E_SCOPE_DENIED' } },
    );
  });

  it('producer session without allowed_paths cannot write', async () => {
    fx = gatewayFixture();
    const s = fx.session({ kind: 'producer' });
    expect(await fx.gw.call(s, 'artifact.write', { path: 'notes.md', content: 'x' })).toMatchObject(
      { ok: false, error: { code: 'E_SCOPE_DENIED' } },
    );
  });

  it('scene files are locked while Studio owns the video', async () => {
    fx = gatewayFixture();
    const state = JSON.parse(readFileSync(vpath('state.json'), 'utf8'));
    writeFileSync(
      vpath('state.json'),
      JSON.stringify({ ...state, owner: 'studio', owner_since: '2026-10-03T12:00:00+07:00' }),
    );
    for (const p of [
      'compositions/frames/fr_9x2b7cqe.html',
      'index.html',
      'hyperframes.json',
      'caption-overrides.json',
    ]) {
      expect(
        await fx.gw.call(fx.session(), 'artifact.write', { path: p, content: '{}' }),
        p,
      ).toMatchObject({
        ok: false,
        error: { code: 'E_OWNER_CONFLICT' },
      });
    }
    expect(
      await fx.gw.call(fx.session(), 'artifact.write', { path: 'notes.md', content: 'x' }),
    ).toMatchObject({ ok: true });
  });
});

describe('config.* (003 FR-016)', () => {
  it('resolve and set', async () => {
    fx = gatewayFixture();
    expect(
      await fx.gw.call(fx.session(), 'config.resolve', { key: 'look.id', frame_id: 'fr_9x2b7cqe' }),
    ).toEqual({
      ok: true,
      data: {
        value: 'frame-look',
        source: 'frame',
        path: `videos/${fixtureVideoId}/STORYBOARD.md`,
      },
    });
    expect(
      await fx.gw.call(fx.session(), 'config.set', {
        key: 'caption.max_words',
        value: 5,
        tier: 'video',
      }),
    ).toEqual({ ok: true, data: {} });
    expect(
      await fx.gw.call(fx.session(), 'config.resolve', { key: 'caption.max_words' }),
    ).toMatchObject({ data: { value: 5, source: 'video' } });
    expect(
      await fx.gw.call(fx.session(), 'config.set', {
        key: 'gpu.vram_total_gb',
        value: 5,
        tier: 'channel',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'E_CONFIG_SCOPE' },
    });
  });
});
