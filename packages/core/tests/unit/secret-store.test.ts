// 055 · D5 5.4 — cổng bí mật: tên hợp lệ, kho bộ nhớ, kho qua thông điệp tới `main`.
import { describe, expect, it } from 'vitest';
import {
  assertSecretName,
  createMessageSecretStore,
  MemorySecretStore,
  type SecretRequest,
  type SecretResult,
} from '../../src/secrets/store.js';
import { credTarget } from '../../src/secrets/credman.js';

describe('secret names', () => {
  it('accepts provider keys and dynamic oauth names; rejects shell-ish ones', () => {
    for (const n of [
      'openai',
      'telegram_bot_token',
      'oauth:youtube:UCabcdefghijklmnopqrstuv',
      'a.b-c:d_e',
    ])
      expect(() => assertSecretName(n)).not.toThrow();
    for (const n of ['', ' x', "a'b", 'a b', '$(calc)', 'a;b', '..\\x', 'x'.repeat(200)])
      expect(() => assertSecretName(n)).toThrow(/invalid secret name/);
    expect(credTarget('oauth:youtube:UC1')).toBe('StudioFlow/oauth:youtube:UC1');
    expect(() => credTarget("x'; calc")).toThrow();
  });
});

describe('MemorySecretStore', () => {
  it('get / set / delete', async () => {
    const s = new MemorySecretStore({ a: '1' });
    expect(await s.get('a')).toBe('1');
    await s.set('oauth:x:1', 'rt');
    expect(await s.get('oauth:x:1')).toBe('rt');
    await s.delete('a');
    expect(await s.get('a')).toBeUndefined();
    await expect(s.set('b', '')).rejects.toThrow(/empty/);
  });
});

describe('message secret store (core ↔ main)', () => {
  function wire(answer: (r: SecretRequest) => SecretResult | undefined) {
    const sent: SecretRequest[] = [];
    let deliver: (m: unknown) => void = () => {};
    const store = createMessageSecretStore({
      send: (m) => {
        sent.push(m);
        const r = answer(m);
        if (r) queueMicrotask(() => deliver(r));
      },
      subscribe: (fn) => (deliver = fn),
      timeoutMs: 40,
    });
    return { store, sent };
  }
  it('sends secret.* with increasing ids and resolves on the matching result', async () => {
    const mem = new Map<string, string>();
    const { store, sent } = wire((r) => {
      if (r.type === 'secret.set') mem.set(r.name, r.value);
      if (r.type === 'secret.delete') mem.delete(r.name);
      return {
        type: 'secret.result',
        id: r.id,
        ok: true,
        ...(r.type === 'secret.get' && mem.has(r.name) ? { value: mem.get(r.name)! } : {}),
      };
    });
    await store.set('telegram_bot_token', '123:abc');
    expect(await store.get('telegram_bot_token')).toBe('123:abc');
    await store.delete('telegram_bot_token');
    expect(await store.get('telegram_bot_token')).toBeUndefined();
    expect(sent.map((m) => [m.type, m.id])).toEqual([
      ['secret.set', 1],
      ['secret.get', 2],
      ['secret.delete', 3],
      ['secret.get', 4],
    ]);
  });
  it('an error reply becomes E_PROVIDER_FAILED; no reply becomes E_PROVIDER_UNAVAILABLE; ignores unrelated messages', async () => {
    const bad = wire((r) => ({
      type: 'secret.result',
      id: r.id,
      ok: false,
      error: 'Credential Manager is only available on Windows',
    }));
    await expect(bad.store.get('openai')).rejects.toMatchObject({ code: 'E_PROVIDER_FAILED' });
    const mute = wire(() => undefined);
    await expect(mute.store.get('openai')).rejects.toMatchObject({
      code: 'E_PROVIDER_UNAVAILABLE',
    });
  });
  it('validates names before sending anything', async () => {
    const { store, sent } = wire(() => undefined);
    await expect(store.get("x'; calc")).rejects.toThrow(/invalid secret name/);
    expect(sent).toHaveLength(0);
  });
});
