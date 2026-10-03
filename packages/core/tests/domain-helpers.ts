import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coreDir } from './helpers.js';

export const fixturesDir = path.join(coreDir, 'tests', 'fixtures', 'domain');
export const fixtureChannel = path.join(fixturesDir, 'channel');
export const fixtureVideoId = 'vd_8m2pq7rt';
export const fixtureVideo = path.join(fixtureChannel, 'videos', fixtureVideoId);
export const fixtureAppData = path.join(fixturesDir, 'appdata');

/** Bản sao kênh mẫu trong thư mục tạm (đường dẫn có khoảng trắng + Unicode). */
export function copyChannel(): { dir: string; cleanup: () => void } {
  const base = mkdtempSync(path.join(os.tmpdir(), 'kênh mẫu '));
  const dir = path.join(base, 'channel');
  cpSync(fixtureChannel, dir, { recursive: true });
  return { dir, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

export function tempDir(prefix = 'sf-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
