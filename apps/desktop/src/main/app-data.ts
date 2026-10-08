import { existsSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

/** 069: tên thư mục dữ liệu của app — riêng, không trùng app StudioFlow cũ. */
export const APP_DIR_NAME = 'StudioFlow Agent';
const LEGACY_DIR_NAME = 'StudioFlow';

/** `settings.json` do app này viết (D3 mục 7: `schema_version` + `config`/`installed`/kênh). */
function isOurs(settingsFile: string): boolean {
  try {
    const s = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>;
    return (
      s.schema_version === 1 &&
      ['config', 'installed', 'recent_channels', 'managed_channels'].some((k) => k in s)
    );
  } catch {
    return false;
  }
}

/**
 * Thư mục dữ liệu app (`userData` của Electron = app-data của core): `SF_APP_DATA` nếu có, không thì
 * `%APPDATA%\StudioFlow Agent`. Bản trước dùng `%APPDATA%\StudioFlow` → đổi tên một lần (cùng ổ, tức thì),
 * chỉ khi đó là dữ liệu của app này; không đổi được (đang bị khóa) → dùng tạm thư mục cũ lần này.
 */
export function resolveAppDataDir(
  env: Record<string, string | undefined>,
  rename: (from: string, to: string) => void = renameSync,
): { dir: string; migrated?: boolean; error?: string } {
  if (env.SF_APP_DATA) return { dir: env.SF_APP_DATA };
  const roaming = env.APPDATA ?? path.join(env.USERPROFILE ?? '.', 'AppData', 'Roaming');
  const dir = path.join(roaming, APP_DIR_NAME);
  const legacy = path.join(roaming, LEGACY_DIR_NAME);
  if (existsSync(dir) || !isOurs(path.join(legacy, 'settings.json'))) return { dir };
  try {
    rename(legacy, dir);
    return { dir, migrated: true };
  } catch (e) {
    return { dir: legacy, migrated: false, error: String((e as Error).message) };
  }
}
