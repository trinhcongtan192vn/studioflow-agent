import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { EXTENSIONS_DIR } from '../agent/options.js';
import type { SettingsConfig } from '../contracts/types.js';
import { SfError } from '../errors.js';
import { enginePython } from '../providers/omnivoice.js';
import { downloadFile, extractZip, writeAppDataText } from '../store/download.js';
import { WriteStore } from '../store/writer.js';

export type InstallProfile = 'minimal' | 'standard' | 'full';
const RANK: Record<InstallProfile, number> = { minimal: 0, standard: 1, full: 2 };

export interface CatalogFile {
  name: string;
  url?: string;
  sha256?: string;
  size?: number;
  dest: string;
  extract?: string;
  content?: string;
}

export interface CatalogEntry {
  key: string;
  title: string;
  install_profile: InstallProfile;
  satisfied_by_path?: string;
  files?: CatalogFile[];
  python_env?: { engine: string; python: string; steps: string[][]; approx_size: number };
}

export const CATALOG_FILE = path.join(EXTENSIONS_DIR, 'providers', 'models.yaml');

export function loadCatalog(file = CATALOG_FILE): CatalogEntry[] {
  const list = parse(readFileSync(file, 'utf8')) as CatalogEntry[];
  for (const e of list) {
    for (const f of e.files ?? []) {
      if (
        f.content === undefined &&
        (!f.url || !/^[0-9a-f]{64}$/.test(f.sha256 ?? '') || !f.size)
      ) {
        throw new SfError(
          'E_SCHEMA_INVALID',
          `models.yaml ${e.key}/${f.name}: url, sha256 and size are required`,
        );
      }
    }
  }
  return list;
}

/** Lệnh có trên PATH (FFmpeg, uv đã cài sẵn trên máy). */
function onPath(cmd: string): string | undefined {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0]?.trim() || undefined : undefined;
}

/** Tìm file thực thi đã giải nén trong `providers/<dir>` (zip có thể có thư mục con). */
function findExe(dir: string, exe: string, depth = 3): string | undefined {
  if (!existsSync(dir)) return undefined;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === exe) return p;
    if (e.isDirectory() && depth > 0) {
      const f = findExe(p, exe, depth - 1);
      if (f) return f;
    }
  }
  return undefined;
}

/** FFmpeg: `SF_FFMPEG` → bản app tải (`providers/ffmpeg`) → PATH. */
export function ffmpegPath(appDataDir: string, tool: 'ffmpeg' | 'ffprobe' = 'ffmpeg'): string {
  const env = process.env[tool === 'ffmpeg' ? 'SF_FFMPEG' : 'SF_FFPROBE'];
  return env ?? findExe(path.join(appDataDir, 'providers', 'ffmpeg'), `${tool}.exe`) ?? tool;
}

export function uvPath(appDataDir: string): string | undefined {
  return findExe(path.join(appDataDir, 'providers', 'uv'), 'uv.exe', 1) ?? onPath('uv');
}

export interface EntryStatus {
  key: string;
  title: string;
  install_profile: InstallProfile;
  status: 'installed' | 'system' | 'missing' | 'partial';
  /** Byte cần tải (ước tính cho môi trường Python). */
  bytes: number;
}

/** Trạng thái một thành phần (kiểm kích thước file; sha256 kiểm khi cài). */
export function entryStatus(appDataDir: string, e: CatalogEntry): EntryStatus {
  const base = { key: e.key, title: e.title, install_profile: e.install_profile };
  if (e.python_env) {
    const ok = existsSync(enginePython(e.python_env.engine, appDataDir));
    return {
      ...base,
      status: ok ? 'installed' : 'missing',
      bytes: ok ? 0 : e.python_env.approx_size,
    };
  }
  const files = e.files ?? [];
  const have = files.filter((f) => {
    const abs = path.join(appDataDir, f.dest);
    if (f.content !== undefined)
      return existsSync(abs) && readFileSync(abs, 'utf8').trim() === f.content.trim();
    if (f.extract)
      return (
        existsSync(path.join(appDataDir, f.extract)) &&
        readdirSync(path.join(appDataDir, f.extract)).length > 0
      );
    return existsSync(abs) && statSync(abs).size === f.size;
  });
  if (have.length === files.length) return { ...base, status: 'installed', bytes: 0 };
  if (e.satisfied_by_path && onPath(e.satisfied_by_path))
    return { ...base, status: 'system', bytes: 0 };
  const bytes = files.filter((f) => !have.includes(f)).reduce((s, f) => s + (f.size ?? 0), 0);
  return { ...base, status: have.length ? 'partial' : 'missing', bytes };
}

/** Kế hoạch cài theo hồ sơ (D4 mục 10): thành phần + dung lượng cần tải (báo trước khi tải). */
export function installPlan(appDataDir: string, profile: InstallProfile, catalog = loadCatalog()) {
  const entries = catalog
    .filter((e) => RANK[e.install_profile] <= RANK[profile])
    .map((e) => entryStatus(appDataDir, e));
  return { profile, entries, total_bytes: entries.reduce((s, e) => s + e.bytes, 0) };
}

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...(signal ? { signal } : {}) });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString('utf8')).slice(-2000)));
    p.on('error', (e) => reject(new SfError('E_PROVIDER_UNAVAILABLE', `${cmd}: ${e.message}`)));
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new SfError('E_PROVIDER_FAILED', `${path.basename(cmd)} exited ${code}: ${err}`)),
    );
  });
}

export const DEFAULT_SETTINGS: SettingsConfig = {
  schema_version: 1,
  config: {},
  installed: { profile: 'minimal', components: [] },
  provider_fallbacks: {},
  network: { allow: [] },
  pricing: [],
  trace: { capture_content: true, retention_days: 30, phoenix_enabled: false },
  recent_channels: [],
};

/** Ghi `settings.installed` (D3 mục 6.2) qua module ghi của app-data. */
export function recordInstalled(
  appDataDir: string,
  e: CatalogEntry,
  profile?: InstallProfile,
): void {
  const store = new WriteStore(appDataDir);
  const f = store.abs('settings.json');
  const s = existsSync(f)
    ? (JSON.parse(readFileSync(f, 'utf8')) as SettingsConfig)
    : structuredClone(DEFAULT_SETTINGS);
  const comps = s.installed.components.filter((c) => c.id !== e.key);
  comps.push({ id: e.key, version: e.title, installed_at: new Date().toISOString() });
  s.installed = {
    profile: profile && RANK[profile] > RANK[s.installed.profile] ? profile : s.installed.profile,
    components: comps,
  };
  store.write('settings.json', `${JSON.stringify(s, null, 2)}\n`, { by: 'model.install' });
}

/**
 * Cài một thành phần (014): tải từng file (tiếp khi đứt, kiểm sha256), giải nén, file văn bản nhỏ;
 * môi trường Python bằng uv. Thành phần có sẵn trên máy (PATH) → không tải.
 */
export async function installEntry(
  appDataDir: string,
  key: string,
  o: {
    signal?: AbortSignal;
    progress?: (done: number, total: number, message?: string) => void;
    catalog?: CatalogEntry[];
    profile?: InstallProfile;
  } = {},
): Promise<EntryStatus> {
  const e = (o.catalog ?? loadCatalog()).find((x) => x.key === key);
  if (!e) throw new SfError('E_ID_UNKNOWN', `unknown component ${key}`);
  const st = entryStatus(appDataDir, e);
  if (st.status === 'installed' || st.status === 'system') {
    recordInstalled(appDataDir, e, o.profile);
    return st;
  }
  if (e.python_env) {
    const uv = uvPath(appDataDir);
    if (!uv)
      throw new SfError(
        'E_PROVIDER_UNAVAILABLE',
        'uv is required to install Python engines; install component "uv" first',
      );
    const env = path.dirname(path.dirname(enginePython(e.python_env.engine, appDataDir)));
    o.progress?.(0, e.python_env.steps.length + 1, `uv venv ${e.python_env.engine}`);
    if (!existsSync(enginePython(e.python_env.engine, appDataDir)))
      await run(uv, ['venv', env, '--python', e.python_env.python], o.signal);
    for (const [i, pkgs] of e.python_env.steps.entries()) {
      o.progress?.(i + 1, e.python_env.steps.length + 1, `pip install ${pkgs[0]}`);
      await run(
        uv,
        ['pip', 'install', '--python', enginePython(e.python_env.engine, appDataDir), ...pkgs],
        o.signal,
      );
    }
  } else {
    const files = e.files ?? [];
    const total = files.reduce((s, f) => s + (f.size ?? 0), 0);
    let base = 0;
    for (const f of files) {
      const abs = path.join(appDataDir, f.dest);
      if (f.content !== undefined) writeAppDataText(abs, `${f.content}\n`);
      else {
        await downloadFile(f.url!, abs, {
          sha256: f.sha256!,
          size: f.size!,
          ...(o.signal ? { signal: o.signal } : {}),
          progress: (d) => o.progress?.(base + d, total, f.name),
        });
        if (f.extract) await extractZip(abs, path.join(appDataDir, f.extract), o.signal);
      }
      base += f.size ?? 0;
    }
  }
  recordInstalled(appDataDir, e, o.profile);
  return entryStatus(appDataDir, e);
}

/** Thêm thư mục bin của FFmpeg/uv do app tải vào PATH của tiến trình (HyperFrames, FFmpeg dùng chung). */
export function ensureToolPaths(appDataDir: string): void {
  const dirs = [
    findExe(path.join(appDataDir, 'providers', 'ffmpeg'), 'ffmpeg.exe'),
    findExe(path.join(appDataDir, 'providers', 'uv'), 'uv.exe', 1),
  ]
    .filter((x): x is string => Boolean(x))
    .map((x) => path.dirname(x));
  const cur = process.env.PATH ?? '';
  const add = dirs.filter((d) => !cur.split(path.delimiter).includes(d));
  if (add.length) process.env.PATH = [...add, cur].join(path.delimiter);
}
