// 055 · D5 mục 5.4 — `core` (utility process) hỏi bí mật qua thông điệp; chỉ `main` đọc/ghi Credential Manager.
// Tách khỏi index.ts (không import electron) để kiểm thử đơn vị được.

/** Tên bí mật tĩnh `core` được hỏi; tên động theo tiền tố (ví dụ `oauth:youtube:<channel_id>`). */
export const STATIC_SECRETS = [
  'openai',
  'deepseek',
  'anthropic',
  'dashscope_api_key',
  'youtube_api_key',
  'telegram_bot_token',
  'youtube_oauth_client_id',
  'youtube_oauth_client_secret',
];
export const SECRET_PREFIXES = ['oauth:'];
/** Chữ, số, `_ . : -` — không ký tự có nghĩa với PowerShell/shell. */
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;

export function isAllowedSecretName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    NAME.test(name) &&
    (STATIC_SECRETS.includes(name) ||
      SECRET_PREFIXES.some((p) => name.startsWith(p) && name.length > p.length))
  );
}

export interface SecretBackend {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): unknown;
}

export interface SecretReply {
  type: 'secret.result';
  id: number;
  ok: boolean;
  value?: string;
  error?: string;
}

/** Thông điệp `secret.*` từ core → câu trả lời; thông điệp khác → `undefined` (không phải của bridge). */
export function handleSecretRequest(msg: unknown, backend: SecretBackend): SecretReply | undefined {
  const m = msg as { type?: unknown; id?: unknown; name?: unknown; value?: unknown } | null;
  if (
    !m ||
    typeof m.type !== 'string' ||
    !m.type.startsWith('secret.') ||
    m.type === 'secret.result'
  )
    return undefined;
  const id = typeof m.id === 'number' ? m.id : -1;
  if (!isAllowedSecretName(m.name))
    return { type: 'secret.result', id, ok: false, error: 'secret name not allowed' };
  try {
    switch (m.type) {
      case 'secret.get':
        return {
          type: 'secret.result',
          id,
          ok: true,
          ...(backend.get(m.name) ? { value: backend.get(m.name)! } : {}),
        };
      case 'secret.set':
        if (typeof m.value !== 'string' || !m.value)
          return { type: 'secret.result', id, ok: false, error: 'empty secret value' };
        backend.set(m.name, m.value);
        return { type: 'secret.result', id, ok: true };
      case 'secret.delete':
        backend.delete(m.name);
        return { type: 'secret.result', id, ok: true };
      default:
        return { type: 'secret.result', id, ok: false, error: 'unknown secret request' };
    }
  } catch (e) {
    // thông báo lỗi của backend không chứa giá trị bí mật
    return {
      type: 'secret.result',
      id,
      ok: false,
      error: String((e as Error).message).slice(0, 200),
    };
  }
}
