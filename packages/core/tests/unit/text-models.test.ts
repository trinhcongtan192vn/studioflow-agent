// 009 · US2 · FR-002 — chọn model producer/critic/aux (D4 4.3).
import { describe, expect, it } from 'vitest';
import { assertDifferentModels, parseModelRef, resolveTextModels } from '../../src/index.js';
import { fixtureAppData, fixtureChannel, fixtureVideoId } from '../domain-helpers.js';

const scope = { channelDir: fixtureChannel, videoId: fixtureVideoId };

describe('text models (009 US2)', () => {
  it('defaults to Claude tiers without external keys', () => {
    expect(
      resolveTextModels(scope, { appDataDir: fixtureAppData, getSecret: () => undefined }),
    ).toEqual({
      producer: { provider: 'claude', model: 'claude-sonnet-5-5' },
      critic: { provider: 'claude', model: 'claude-opus-5-5' },
      aux: { provider: 'claude', model: 'claude-haiku-4-5' },
    });
  });

  it('prefers OpenAI as producer when an OpenAI key exists', () => {
    const m = resolveTextModels(scope, {
      appDataDir: fixtureAppData,
      getSecret: (n) => (n === 'openai' ? 'sk-x' : undefined),
    });
    expect(m.producer).toEqual({ provider: 'openai', model: 'gpt-5' });
    expect(m.critic.provider).toBe('claude');
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
