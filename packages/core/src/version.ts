export interface VersionInfo {
  name: 'studioflow';
  version: string;
}

/**
 * Phiên bản `@studioflow/core`. Hằng số (không đọc package.json lúc chạy) để vẫn đúng khi core được
 * bundle vào Electron main; `tests/unit/version.test.ts` và `scripts/check-structure.mjs` giữ nó
 * khớp với mọi package.json/pyproject của repo.
 */
export const CORE_VERSION = '0.1.0';

export function getVersion(): VersionInfo {
  return { name: 'studioflow', version: CORE_VERSION };
}
