import { requireKey, typeMatches } from '../config/keys.js';
import { SfError } from '../errors.js';

/** Khóa cấu hình Telegram tầng app (D3 7.2, 055). */
export const TELEGRAM_KEYS = [
  'telegram.enabled',
  'telegram.chat_id',
  'telegram.allowed_user_ids',
] as const;

const invalid = (key: string, why: string) => new SfError('E_SCHEMA_INVALID', `${key}: ${why}`);

/** Kiểm kiểu (bảng D3) và dạng giá trị: `chat_id` là số nguyên (nhóm có thể âm) hoặc `@kênh`; ID người dùng là số. */
export function checkTelegramValue(key: string, value: unknown): void {
  const spec = requireKey(key);
  if (!typeMatches(spec.type, value)) throw invalid(key, `must be ${spec.type}`);
  if (key === 'telegram.chat_id') {
    const v = (value as string).trim();
    if (v && !/^-?\d{1,20}$/.test(v) && !/^@[A-Za-z][\w]{3,31}$/.test(v))
      throw invalid(key, 'use a numeric chat id (e.g. -1001234567890) or @channelusername');
  }
  if (key === 'telegram.allowed_user_ids') {
    const bad = (value as string[]).filter((x) => !/^\d{1,20}$/.test(x.trim()));
    if (bad.length) throw invalid(key, `Telegram user ids are numbers: ${bad.join(', ')}`);
  }
}
