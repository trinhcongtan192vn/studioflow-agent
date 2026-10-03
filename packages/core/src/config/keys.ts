import { configKeyTable } from '../contracts/config-keys.js';
import { SfError } from '../errors.js';
import { isId } from '../domain/ids.js';

export type ConfigTier = 'app' | 'channel' | 'video' | 'scene' | 'frame';
export type ConfigValueType = 'string' | 'number' | 'boolean' | 'string[]' | 'VoiceId';

export interface ConfigKeySpec {
  key: string;
  pattern: boolean;
  type: ConfigValueType;
  tiers: ConfigTier[];
}

const specs = configKeyTable.keys as unknown as ConfigKeySpec[];
const exact = new Map(specs.filter((s) => !s.pattern).map((s) => [s.key, s]));
const patterns = specs
  .filter((s) => s.pattern)
  .map((s) => ({
    spec: s,
    re: new RegExp(`^${s.key.replace(/\./g, '\\.').replace(/<[^>]+>/g, '(.+)')}$`),
  }));

/** Dòng trong bảng D3 mục 7.2 ứng với khóa (khóa mẫu `<…>` khớp theo mẫu). */
export function configKeySpec(key: string): ConfigKeySpec | undefined {
  return exact.get(key) ?? patterns.find((p) => p.re.test(key))?.spec;
}

/** Phần thay cho `<…>` của khóa mẫu (ví dụ `script.wpm.de` → `de`). */
export function patternArg(key: string): string | undefined {
  return patterns.find((p) => p.re.test(key))?.re.exec(key)?.[1];
}

export function requireKey(key: string): ConfigKeySpec {
  const spec = configKeySpec(key);
  if (!spec) throw new SfError('E_CONFIG_UNKNOWN_KEY', `unknown config key "${key}" (D3 7.2)`);
  return spec;
}

export function typeMatches(type: ConfigValueType, v: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'string[]':
      return Array.isArray(v) && v.every((x) => typeof x === 'string');
    case 'VoiceId':
      return isId('vo', v);
  }
}

/** Kiểm một map cấu hình ở một tầng: khóa có trong bảng, tầng cho phép, đúng kiểu. */
export function checkConfigTier(config: Record<string, unknown>, tier: ConfigTier): void {
  for (const [key, value] of Object.entries(config)) {
    const spec = requireKey(key);
    if (!spec.tiers.includes(tier)) {
      throw new SfError(
        'E_CONFIG_SCOPE',
        `config key "${key}" is not allowed at tier "${tier}" (allowed: ${spec.tiers.join(', ')})`,
      );
    }
    if (!typeMatches(spec.type, value)) {
      throw new SfError(
        'E_SCHEMA_INVALID',
        `config key "${key}" must be ${spec.type}, got ${JSON.stringify(value)}`,
      );
    }
  }
}
