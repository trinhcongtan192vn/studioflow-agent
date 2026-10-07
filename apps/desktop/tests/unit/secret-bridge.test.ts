// 055 · D5 5.4 — cầu bí mật main ↔ core: tên hợp lệ, trả lời đúng id, lỗi không lộ giá trị.
import { describe, expect, it } from 'vitest';
import {
  handleSecretRequest,
  isAllowedSecretName,
  type SecretBackend,
} from '../../src/main/secret-bridge';

const mem = (): SecretBackend & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return {
    m,
    get: (n) => m.get(n),
    set: (n, v) => void m.set(n, v),
    delete: (n) => m.delete(n),
  };
};

describe('isAllowedSecretName', () => {
  it('static names and the oauth: prefix only', () => {
    for (const n of [
      'telegram_bot_token',
      'youtube_oauth_client_id',
      'youtube_api_key',
      'oauth:youtube:UCabcdefghijklmnopqrstuv',
      'oauth:tiktok:ch_k3v9q2xa',
    ])
      expect(isAllowedSecretName(n)).toBe(true);
  });
  it('rejects unknown names and anything shell-ish', () => {
    for (const n of [
      '',
      'oauth:',
      "oauth:x'; calc",
      'oauth:a b',
      'random',
      'telegram_bot_token\n',
      '../x',
      'oauth:' + 'a'.repeat(200),
    ])
      expect(isAllowedSecretName(n)).toBe(false);
    expect(isAllowedSecretName(5)).toBe(false);
  });
});

describe('handleSecretRequest', () => {
  it('get / set / delete answer with the same id', () => {
    const b = mem();
    expect(
      handleSecretRequest(
        { type: 'secret.set', id: 1, name: 'oauth:youtube:UC1', value: 'rt-123' },
        b,
      ),
    ).toEqual({ type: 'secret.result', id: 1, ok: true });
    expect(
      handleSecretRequest({ type: 'secret.get', id: 2, name: 'oauth:youtube:UC1' }, b),
    ).toEqual({ type: 'secret.result', id: 2, ok: true, value: 'rt-123' });
    expect(
      handleSecretRequest({ type: 'secret.delete', id: 3, name: 'oauth:youtube:UC1' }, b),
    ).toEqual({ type: 'secret.result', id: 3, ok: true });
    expect(
      handleSecretRequest({ type: 'secret.get', id: 4, name: 'oauth:youtube:UC1' }, b),
    ).toEqual({ type: 'secret.result', id: 4, ok: true });
  });
  it('refuses disallowed names without touching the backend', () => {
    const b = mem();
    const r = handleSecretRequest({ type: 'secret.set', id: 9, name: 'evil', value: 'x' }, b);
    expect(r).toMatchObject({ id: 9, ok: false });
    expect(b.m.size).toBe(0);
  });
  it('ignores messages that are not secret requests; empty values are refused', () => {
    const b = mem();
    expect(handleSecretRequest({ type: 'something' }, b)).toBeUndefined();
    expect(handleSecretRequest({ type: 'secret.result', id: 1 }, b)).toBeUndefined();
    expect(handleSecretRequest(undefined, b)).toBeUndefined();
    expect(
      handleSecretRequest({ type: 'secret.set', id: 1, name: 'telegram_bot_token', value: '' }, b),
    ).toMatchObject({ ok: false });
  });
  it('a failing backend yields an error reply, never a throw', () => {
    const b: SecretBackend = {
      get: () => {
        throw new Error('Credential Manager is only available on Windows');
      },
      set: () => {},
      delete: () => {},
    };
    expect(
      handleSecretRequest({ type: 'secret.get', id: 5, name: 'telegram_bot_token' }, b),
    ).toMatchObject({ ok: false, id: 5, error: expect.stringContaining('Windows') });
  });
});
