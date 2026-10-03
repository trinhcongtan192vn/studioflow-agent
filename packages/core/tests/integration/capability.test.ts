// 004 · US2 · FR-008..012 · SC-002 (FR-OP-03, FR-OB-02).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cacheKey,
  evictCache,
  openDb,
  ProviderRegistry,
  runCapability,
  validateArtifact,
  WriteStore,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';
import { fakeTts } from '../provider-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function setup() {
  const c = copyChannel();
  const t = tempDir('db-');
  const db = openDb(path.join(t.dir, 'studioflow.db'));
  cleanups.push(() => {
    db.close();
    c.cleanup();
    t.cleanup();
  });
  return { dir: c.dir, store: new WriteStore(c.dir), db };
}
const V = `videos/${fixtureVideoId}`;

describe('runCapability (004 US2)', () => {
  it('first run executes, writes output, cache object and provenance; second run hits cache', async () => {
    const { dir, store, db } = setup();
    const { adapter, state } = fakeTts();
    const args = {
      store,
      db,
      adapter,
      capability: 'tts.synthesize',
      videoId: fixtureVideoId,
      input: { text: 'Xin chào', voice_id: 'vo_c3z8p1mn', language: 'vi' },
      outputs: { file: `${V}/audio/lines/ln_2r7c4kxm.wav` },
    };
    const first = await runCapability(args);
    expect(state.calls).toBe(1);
    expect(first).toMatchObject({
      from_cache: false,
      output: { file: `${V}/audio/lines/ln_2r7c4kxm.wav`, duration_ms: 480 },
    });
    expect(readFileSync(path.join(dir, V, 'audio/lines/ln_2r7c4kxm.wav'), 'utf8')).toBe(
      'RIFF:Xin chào',
    );
    expect(
      existsSync(
        path.join(
          dir,
          'cache',
          'objects',
          first.cache_key.slice(0, 2),
          first.cache_key,
          'meta.json',
        ),
      ),
    ).toBe(true);
    const provFile = path.join(dir, first.provenance[0]!);
    const prov = JSON.parse(readFileSync(provFile, 'utf8'));
    expect(prov).toMatchObject({
      output: 'audio/lines/ln_2r7c4kxm.wav',
      capability: 'tts.synthesize',
      provider: 'tts.test',
      from_cache: false,
      cache_key: first.cache_key,
    });
    expect(validateArtifact(first.provenance[0]!, readFileSync(provFile, 'utf8')).valid).toBe(true);
    expect(path.basename(provFile)).toBe(`${prov.output_hash.slice(0, 12)}.json`);

    const second = await runCapability({ ...args, outputs: { file: `${V}/audio/lines/copy.wav` } });
    expect(state.calls).toBe(1);
    expect(second).toMatchObject({
      from_cache: true,
      cache_key: first.cache_key,
      output: { duration_ms: 480 },
    });
    expect(readFileSync(path.join(dir, V, 'audio/lines/copy.wav'), 'utf8')).toBe('RIFF:Xin chào');
    expect(JSON.parse(readFileSync(path.join(dir, second.provenance[0]!), 'utf8')).from_cache).toBe(
      true,
    );
  });

  it('a different cache key part, seed or provider version runs again', async () => {
    const { store, db } = setup();
    const { adapter, state } = fakeTts();
    const base = {
      store,
      db,
      adapter,
      capability: 'tts.synthesize',
      videoId: fixtureVideoId,
      outputs: { file: `${V}/a.wav` },
    };
    await runCapability({ ...base, input: { text: 'a', voice_id: 'vo_c3z8p1mn', language: 'vi' } });
    await runCapability({ ...base, input: { text: 'b', voice_id: 'vo_c3z8p1mn', language: 'vi' } });
    await runCapability({
      ...base,
      input: { text: 'b', voice_id: 'vo_c3z8p1mn', language: 'vi' },
      seed: 7,
    });
    adapter.manifest.version = '1.0.1';
    await runCapability({
      ...base,
      input: { text: 'b', voice_id: 'vo_c3z8p1mn', language: 'vi' },
      seed: 7,
    });
    expect(state.calls).toBe(4);
  });

  it('cache key ignores parts outside cacheKeyParts and normalizes key order', () => {
    const k = (input: unknown) =>
      cacheKey({
        capability: 'x',
        contract_version: '1',
        provider_id: 'p',
        provider_version: '1',
        model_file_hash: null,
        input,
        seed: null,
      });
    expect(k({ a: 1, b: 2 })).toBe(k({ b: 2, a: 1 }));
    expect(k({ a: 1 })).not.toBe(k({ a: 2 }));
  });

  it('text.* (temperature ≠ 0) and render.video are never cached', async () => {
    const { store, db } = setup();
    const { adapter, state } = fakeTts();
    for (const capability of ['text.generate', 'render.video']) {
      for (let i = 0; i < 2; i++) {
        await runCapability({
          store,
          db,
          adapter,
          capability,
          videoId: fixtureVideoId,
          input: { text: 'x', voice_id: 'v', language: 'vi', temperature: 0.7 } as never,
          outputs: { file: `${V}/t.wav` },
        });
      }
    }
    expect(state.calls).toBe(4);
    await runCapability({
      store,
      db,
      adapter,
      capability: 'text.generate',
      videoId: fixtureVideoId,
      input: { text: 'y', voice_id: 'v', language: 'vi', temperature: 0 } as never,
      outputs: { file: `${V}/t.wav` },
    });
    await runCapability({
      store,
      db,
      adapter,
      capability: 'text.generate',
      videoId: fixtureVideoId,
      input: { text: 'y', voice_id: 'v', language: 'vi', temperature: 0 } as never,
      outputs: { file: `${V}/t.wav` },
    });
    expect(state.calls).toBe(5);
  });
});

describe('provider routing (004 FR-008, D4 4.4)', () => {
  it('uses the configured provider, falls back when unhealthy, checks language', async () => {
    const { dir } = setup();
    const reg = new ProviderRegistry();
    const omni = fakeTts('tts.omnivoice', { healthy: false });
    const vbee = fakeTts('tts.vbee', { languages: ['vi'] });
    reg.register(omni.adapter);
    reg.register(vbee.adapter);
    const scope = { channelDir: dir, videoId: fixtureVideoId, appDataDir: fixtureAppData };
    expect((await reg.resolve('tts.synthesize', { ...scope, language: 'vi' })).manifest.id).toBe(
      'tts.vbee',
    );
    await expect(reg.resolve('tts.synthesize', { ...scope, language: 'de' })).rejects.toMatchObject(
      { code: 'E_PROVIDER_UNAVAILABLE' },
    );
    await expect(reg.resolve('image.generate', scope)).rejects.toMatchObject({
      code: 'E_PROVIDER_UNAVAILABLE',
    });
  });

  it('prefers the configured provider when healthy', async () => {
    const { dir } = setup();
    const reg = new ProviderRegistry();
    reg.register(fakeTts('tts.omnivoice').adapter);
    reg.register(fakeTts('tts.vbee').adapter);
    expect(
      (
        await reg.resolve('tts.synthesize', {
          channelDir: dir,
          appDataDir: fixtureAppData,
          language: 'vi',
        })
      ).manifest.id,
    ).toBe('tts.omnivoice');
  });
});

describe('cache eviction (004 FR-012)', () => {
  it('evicts least recently used entries until under budget, only inside cache/', async () => {
    const { dir, store, db } = setup();
    const { adapter } = fakeTts();
    const keys: string[] = [];
    for (const text of ['one', 'two', 'three']) {
      const r = await runCapability({
        store,
        db,
        adapter,
        capability: 'tts.synthesize',
        videoId: fixtureVideoId,
        input: { text, voice_id: 'v', language: 'vi' },
        outputs: { file: `${V}/${text}.wav` },
      });
      keys.push(r.cache_key);
      await new Promise((res) => setTimeout(res, 5));
    }
    // dùng lại "one" → mới nhất
    await runCapability({
      store,
      db,
      adapter,
      capability: 'tts.synthesize',
      videoId: fixtureVideoId,
      input: { text: 'one', voice_id: 'v', language: 'vi' },
      outputs: { file: `${V}/one.wav` },
    });
    const removed = evictCache(store, db, 1); // ngân sách 1 byte → chỉ giữ được 0 mục
    expect(removed.map((r) => r.key)).toEqual([keys[1], keys[2], keys[0]]);
    expect(
      readdirSync(path.join(dir, 'cache', 'objects')).flatMap((d) =>
        readdirSync(path.join(dir, 'cache', 'objects', d)),
      ),
    ).toEqual([]);
    expect(existsSync(path.join(dir, V, 'one.wav'))).toBe(true);
  });
});
