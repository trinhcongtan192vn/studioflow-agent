import { SfError } from '../errors.js';

/**
 * Cổng bí mật của `core` (D5 mục 5.4, 055): `core` không tự đọc Credential Manager — trong app, `main` làm
 * việc đó và `core` hỏi qua thông điệp; test dùng kho bộ nhớ. Giá trị không bao giờ vào file, log, trace.
 */
export interface SecretStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

/** Tên bí mật hợp lệ: chữ, số, `_ . : -` (ví dụ `telegram_bot_token`, `oauth:youtube:UC…`) — không ký tự shell/PowerShell. */
export const SECRET_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;

export function assertSecretName(name: string): void {
  if (typeof name !== 'string' || !SECRET_NAME.test(name))
    throw new SfError('E_SCHEMA_INVALID', `invalid secret name "${String(name).slice(0, 40)}"`);
}

/** Kho trong bộ nhớ (test, và mặc định khi app không nối `main`). */
export class MemorySecretStore implements SecretStore {
  private readonly m = new Map<string, string>();
  constructor(init: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(init)) this.m.set(k, v);
  }
  async get(name: string): Promise<string | undefined> {
    assertSecretName(name);
    return this.m.get(name);
  }
  async set(name: string, value: string): Promise<void> {
    assertSecretName(name);
    if (!value) throw new SfError('E_SCHEMA_INVALID', 'secret is empty');
    this.m.set(name, value);
  }
  async delete(name: string): Promise<void> {
    assertSecretName(name);
    this.m.delete(name);
  }
  /** Chỉ cho test: tên đang có. */
  names(): string[] {
    return [...this.m.keys()];
  }
}

export type SecretRequest =
  | { type: 'secret.get'; id: number; name: string }
  | { type: 'secret.set'; id: number; name: string; value: string }
  | { type: 'secret.delete'; id: number; name: string };

export interface SecretResult {
  type: 'secret.result';
  id: number;
  ok: boolean;
  value?: string;
  error?: string;
}

/**
 * Kho bí mật qua thông điệp tới `main` (tiến trình utility của app): gửi `secret.*`, chờ `secret.result` cùng `id`.
 * Quá hạn → `E_PROVIDER_UNAVAILABLE` (main không trả lời).
 */
export function createMessageSecretStore(io: {
  send(m: SecretRequest): void;
  subscribe(fn: (m: unknown) => void): void;
  timeoutMs?: number;
}): SecretStore {
  let seq = 0;
  const pending = new Map<number, { ok: (v: SecretResult) => void; timer: NodeJS.Timeout }>();
  io.subscribe((m) => {
    const r = m as Partial<SecretResult> | undefined;
    if (r?.type !== 'secret.result' || typeof r.id !== 'number') return;
    const p = pending.get(r.id);
    if (!p) return;
    pending.delete(r.id);
    clearTimeout(p.timer);
    p.ok(r as SecretResult);
  });
  type Body = SecretRequest extends infer R
    ? R extends SecretRequest
      ? Omit<R, 'id'>
      : never
    : never;
  const call = (req: Body): Promise<SecretResult> => {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new SfError('E_PROVIDER_UNAVAILABLE', 'secret store did not answer'));
      }, io.timeoutMs ?? 15_000);
      timer.unref?.();
      pending.set(id, { ok: resolve, timer });
      io.send({ ...req, id } as SecretRequest);
    });
  };
  const check = (r: SecretResult) => {
    if (!r.ok) throw new SfError('E_PROVIDER_FAILED', r.error ?? 'secret store error');
    return r;
  };
  return {
    async get(name) {
      assertSecretName(name);
      return check(await call({ type: 'secret.get', name })).value || undefined;
    },
    async set(name, value) {
      assertSecretName(name);
      check(await call({ type: 'secret.set', name, value }));
    },
    async delete(name) {
      assertSecretName(name);
      check(await call({ type: 'secret.delete', name }));
    },
  };
}
