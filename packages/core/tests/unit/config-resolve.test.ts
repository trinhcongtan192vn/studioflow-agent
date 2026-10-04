// 002 · US4 · FR-013..015 — cấu hình theo tầng (D3 mục 7).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkConfigTier,
  configKeySpec,
  resolveConfig,
  setConfig,
  WriteStore,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureChannel, fixtureVideoId } from '../domain-helpers.js';

const opts = { appDataDir: fixtureAppData };
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

describe('resolveConfig (002 US4)', () => {
  it('default when no tier sets the key', () => {
    expect(resolveConfig('caption.style', { channelDir: fixtureChannel }, opts)).toEqual({
      value: 'caption-highlight',
      source: 'default',
      path: 'tech-defaults',
    });
  });

  it('each tier overrides the previous', () => {
    const at = (scope: object) =>
      resolveConfig('look.id', { channelDir: fixtureChannel, ...scope }, opts);
    expect(at({})).toMatchObject({
      value: 'warm-archive',
      source: 'channel',
      path: 'channel.json',
    });
    expect(at({ videoId: fixtureVideoId })).toMatchObject({
      value: 'cold-steel',
      source: 'video',
      path: `videos/${fixtureVideoId}/state.json`,
    });
    expect(at({ videoId: fixtureVideoId, sceneId: 'sc_p0q2m5ka' })).toMatchObject({
      value: 'scene-look',
      source: 'scene',
      path: `videos/${fixtureVideoId}/STORYBOARD.md`,
    });
    expect(at({ videoId: fixtureVideoId, frameId: 'fr_9x2b7cqe' })).toMatchObject({
      value: 'frame-look',
      source: 'frame',
    });
    expect(at({ videoId: fixtureVideoId, frameId: 'fr_3m8k1w7d' })).toMatchObject({
      value: 'scene-look',
      source: 'scene',
    });
  });

  it('app tier from settings.json', () => {
    expect(
      resolveConfig('frame_build.parallel', { channelDir: fixtureChannel }, opts),
    ).toMatchObject({ value: 3, source: 'app' });
  });

  it('output.profile at video tier comes from state.json', () => {
    expect(
      resolveConfig(
        'output.profile',
        { channelDir: fixtureChannel, videoId: fixtureVideoId },
        opts,
      ),
    ).toMatchObject({
      value: 'yt-1080p30',
      source: 'video',
    });
  });

  it('pattern keys resolve with sub-table defaults', () => {
    expect(resolveConfig('asr.wer_threshold.vi', { channelDir: fixtureChannel }, opts).value).toBe(
      0.15,
    );
    expect(
      resolveConfig('gpu.vram_budget_gb.comfyui', { channelDir: fixtureChannel }, opts).value,
    ).toBe(14);
    expect(
      resolveConfig('provider.tts.synthesize', { channelDir: fixtureChannel }, opts).value,
    ).toBe('tts.omnivoice');
    expect(
      resolveConfig('provider.unknown.cap', { channelDir: fixtureChannel }, opts).value,
    ).toBeNull();
  });

  it('channel overrides a channel-tier key', () => {
    expect(resolveConfig('caption.max_words', { channelDir: fixtureChannel }, opts)).toMatchObject({
      value: 6,
      source: 'channel',
    });
  });

  it('unknown key → E_CONFIG_UNKNOWN_KEY', () => {
    expect(() => resolveConfig('nope.key', { channelDir: fixtureChannel }, opts)).toThrow(
      expect.objectContaining({ code: 'E_CONFIG_UNKNOWN_KEY' }),
    );
  });

  it('key spec exposes type and tiers', () => {
    expect(configKeySpec('frame.min_duration_ms')).toMatchObject({
      type: 'number',
      tiers: ['channel', 'video', 'scene', 'frame'],
    });
    expect(configKeySpec('look.id')!.tiers).toEqual(['app', 'channel', 'video', 'scene', 'frame']);
    expect(configKeySpec('asr.wer_threshold.vi')).toMatchObject({
      key: 'asr.wer_threshold.<lang>',
    });
  });

  it('tier check: disallowed tier → E_CONFIG_SCOPE; wrong type → E_SCHEMA_INVALID', () => {
    expect(() => checkConfigTier({ 'frame_build.parallel': 2 }, 'channel')).toThrow(
      expect.objectContaining({ code: 'E_CONFIG_SCOPE' }),
    );
    expect(() => checkConfigTier({ 'caption.max_words': 'seven' }, 'video')).toThrow(
      expect.objectContaining({ code: 'E_SCHEMA_INVALID' }),
    );
    expect(() => checkConfigTier({ 'voice.id': 'bob' }, 'channel')).toThrow(
      expect.objectContaining({ code: 'E_SCHEMA_INVALID' }),
    );
    expect(() =>
      checkConfigTier({ 'overlay.rules': ['a'], 'lipsync.enabled': true }, 'channel'),
    ).not.toThrow();
  });
});

describe('setConfig (002 FR-015)', () => {
  it('sets a channel key through the write module', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const store = new WriteStore(c.dir);
    setConfig(store, 'caption.max_words', 8, { tier: 'channel' });
    expect(
      JSON.parse(readFileSync(path.join(c.dir, 'channel.json'), 'utf8')).config[
        'caption.max_words'
      ],
    ).toBe(8);
    setConfig(store, 'look.id', 'night', { tier: 'video', videoId: fixtureVideoId });
    expect(
      resolveConfig('look.id', { channelDir: c.dir, videoId: fixtureVideoId }, opts).value,
    ).toBe('night');
    setConfig(store, 'output.profile', 'yt-shorts-1080x1920', {
      tier: 'video',
      videoId: fixtureVideoId,
    });
    expect(
      JSON.parse(readFileSync(path.join(c.dir, 'videos', fixtureVideoId, 'state.json'), 'utf8'))
        .output_profile,
    ).toBe('yt-shorts-1080x1920');
    expect(store.log().map((e) => e.by)).toEqual(['config.set', 'config.set', 'config.set']);
  });

  it('rejects tier violations', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const store = new WriteStore(c.dir);
    expect(() =>
      setConfig(store, 'policy.auto_approve.paid_api', true, { tier: 'channel' }),
    ).toThrow(expect.objectContaining({ code: 'E_CONFIG_SCOPE' }));
    expect(() => setConfig(store, 'x.y', 1, { tier: 'channel' })).toThrow(
      expect.objectContaining({ code: 'E_CONFIG_UNKNOWN_KEY' }),
    );
  });
});
