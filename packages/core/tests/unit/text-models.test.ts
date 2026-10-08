// 009 · US2 · FR-002 — chọn model producer/critic/aux (D4 4.3).
import { describe, expect, it } from 'vitest';
import { assertDifferentModels, parseModelRef, resolveTextModels } from '../../src/index.js';
import { fixtureAppData, fixtureChannel, fixtureVideoId } from '../domain-helpers.js';

const scope = { channelDir: fixtureChannel, videoId: fixtureVideoId };

describe('text models (009 US2)', () => {
  it('085: cheap Claude tiers without external keys', () => {
    expect(
      resolveTextModels(scope, { appDataDir: fixtureAppData, getSecret: () => undefined }),
    ).toEqual({
      producer: { provider: 'claude', model: 'claude-sonnet-5-5' },
      critic: { provider: 'claude', model: 'claude-haiku-4-5' },
      aux: { provider: 'claude', model: 'claude-haiku-4-5' },
    });
  });

  it('085: DeepSeek writes and helps when its key exists; Claude Sonnet reviews', () => {
    const m = resolveTextModels(scope, {
      appDataDir: fixtureAppData,
      getSecret: (n) => (n === 'deepseek' || n === 'openai' ? 'sk-x' : undefined),
    });
    expect(m).toEqual({
      producer: { provider: 'deepseek', model: 'deepseek-chat' },
      critic: { provider: 'claude', model: 'claude-sonnet-5-5' },
      aux: { provider: 'deepseek', model: 'deepseek-chat' },
    });
  });

  it('085: advanced.reasoning picks Opus to write and Sonnet to review', () => {
    const m = resolveTextModels(scope, {
      appDataDir: fixtureAppData,
      getSecret: () => undefined,
      reasoning: true,
    });
    expect(m.producer).toEqual({ provider: 'claude', model: 'claude-opus-5-5' });
    expect(m.critic).toEqual({ provider: 'claude', model: 'claude-sonnet-5-5' });
  });

  it('config keys override defaults', () => {
    expect(parseModelRef('deepseek/deepseek-chat')).toEqual({
      provider: 'deepseek',
      model: 'deepseek-chat',
    });
    expect(() => parseModelRef('bogus')).toThrow(
      expect.objectContaining({ code: 'E_SCHEMA_INVALID' }),
    );
  });

  it('producer and critic must differ', () => {
    expect(() =>
      assertDifferentModels({ provider: 'claude', model: 'm' }, { provider: 'claude', model: 'm' }),
    ).toThrow(expect.objectContaining({ code: 'E_REFINE_SAME_MODEL' }));
    expect(
      assertDifferentModels({ provider: 'claude', model: 'a' }, { provider: 'claude', model: 'b' }),
    ).toEqual({ sameVendor: true });
    expect(
      assertDifferentModels({ provider: 'openai', model: 'a' }, { provider: 'claude', model: 'b' }),
    ).toEqual({ sameVendor: false });
  });
});
