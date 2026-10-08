// 085 · FR-WF-85-01 — tính năng nâng cao: mặc định tắt, kênh → video ghi đè, `null` bỏ ghi đè.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { advancedFlags, setAdvanced, WriteStore } from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

describe('advanced flags (085)', () => {
  it('off by default; channel turns on, video overrides, null inherits again', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const store = new WriteStore(c.dir);
    const flags = (v?: string) => advancedFlags(c.dir, v, fixtureAppData);
    expect(flags(fixtureVideoId)['advanced.refine']).toEqual({
      value: false,
      source: 'default',
      inherited: false,
    });
    setAdvanced(store, 'advanced.music', true);
    expect(flags()['advanced.music']).toMatchObject({ value: true, source: 'channel' });
    expect(flags(fixtureVideoId)['advanced.music']).toEqual({
      value: true,
      source: 'channel',
      inherited: true,
    });
    setAdvanced(store, 'advanced.music', false, fixtureVideoId);
    expect(flags(fixtureVideoId)['advanced.music']).toEqual({
      value: false,
      source: 'video',
      inherited: true,
    });
    setAdvanced(store, 'advanced.music', null, fixtureVideoId);
    expect(flags(fixtureVideoId)['advanced.music'].source).toBe('channel');
    const st = JSON.parse(
      readFileSync(store.abs(`videos/${fixtureVideoId}/state.json`), 'utf8'),
    ) as { config_overrides: Record<string, unknown> };
    expect('advanced.music' in st.config_overrides).toBe(false);
    setAdvanced(store, 'advanced.music', null);
    expect(flags()['advanced.music'].source).toBe('default');
  });

  it('rejects other keys and non-boolean values', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const store = new WriteStore(c.dir);
    expect(() => setAdvanced(store, 'voice.id', true)).toThrow(
      expect.objectContaining({ code: 'E_CONFIG_SCOPE' }),
    );
    expect(() => setAdvanced(store, 'advanced.refine', 'yes' as never)).toThrow(
      expect.objectContaining({ code: 'E_SCHEMA_INVALID' }),
    );
  });
});
