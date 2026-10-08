// 069 — thư mục dữ liệu riêng `%APPDATA%\StudioFlow Agent` (độc lập với app StudioFlow cũ); chuyển một lần
// từ `%APPDATA%\StudioFlow` khi đó là dữ liệu của app này.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAppDataDir } from '../../src/main/app-data';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const roaming = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'sf-roaming-'));
  dirs.push(d);
  return d;
};
const ours = JSON.stringify({ schema_version: 1, config: {}, installed: { components: [] } });

describe('app data dir (069)', () => {
  it('SF_APP_DATA wins', () => {
    expect(resolveAppDataDir({ SF_APP_DATA: 'X:/a', APPDATA: roaming() })).toEqual({ dir: 'X:/a' });
  });

  it('fresh install uses StudioFlow Agent', () => {
    const r = roaming();
    expect(resolveAppDataDir({ APPDATA: r })).toEqual({ dir: path.join(r, 'StudioFlow Agent') });
  });

  it('moves this app’s old StudioFlow folder once, keeping its content', () => {
    const r = roaming();
    mkdirSync(path.join(r, 'StudioFlow', 'models'), { recursive: true });
    writeFileSync(path.join(r, 'StudioFlow', 'settings.json'), ours);
    const res = resolveAppDataDir({ APPDATA: r });
    expect(res).toEqual({ dir: path.join(r, 'StudioFlow Agent'), migrated: true });
    expect(existsSync(path.join(r, 'StudioFlow'))).toBe(false);
    expect(readFileSync(path.join(r, 'StudioFlow Agent', 'settings.json'), 'utf8')).toBe(ours);
    expect(existsSync(path.join(r, 'StudioFlow Agent', 'models'))).toBe(true);
    // lần sau: thư mục mới đã có → không làm gì
    expect(resolveAppDataDir({ APPDATA: r })).toEqual({ dir: path.join(r, 'StudioFlow Agent') });
  });

  it('leaves a StudioFlow folder that is not ours alone', () => {
    const r = roaming();
    mkdirSync(path.join(r, 'StudioFlow'), { recursive: true });
    writeFileSync(path.join(r, 'StudioFlow', 'settings.json'), '{"theme":"x"}');
    expect(resolveAppDataDir({ APPDATA: r })).toEqual({ dir: path.join(r, 'StudioFlow Agent') });
    expect(existsSync(path.join(r, 'StudioFlow', 'settings.json'))).toBe(true);
  });

  it('keeps using the old folder for this run when it cannot be moved', () => {
    const r = roaming();
    mkdirSync(path.join(r, 'StudioFlow'), { recursive: true });
    writeFileSync(path.join(r, 'StudioFlow', 'settings.json'), ours);
    const res = resolveAppDataDir({ APPDATA: r }, () => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    });
    expect(res).toMatchObject({ dir: path.join(r, 'StudioFlow'), migrated: false });
  });
});
