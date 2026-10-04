import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SfError } from '../errors.js';
import { parseStoryboard, toStoryboardDoc } from '../domain/markdown/storyboard.js';
import type { WriteStore } from '../store/writer.js';
import { DEFAULTS, PATTERN_DEFAULTS } from './defaults.js';
import {
  checkConfigTier,
  configKeySpec,
  patternArg,
  requireKey,
  workflowTierAllowed,
  type ConfigTier,
} from './keys.js';
import { parse } from 'yaml';
import { readdirSync, statSync } from 'node:fs';
import { EXTENSIONS_DIR } from '../paths.js';

const wfCache = new Map<
  string,
  { mtime: number; id?: string; defaults?: Record<string, unknown> }
>();

/** `config_defaults` của workflow theo id (thư mục gói: app-data trước, rồi gói đi kèm app, D5 3.2). */
function workflowManifestFile(
  id: string,
  appDataDir?: string,
): { file: string; defaults?: Record<string, unknown> } | undefined {
  const env = process.env.SF_WORKFLOW_DIRS;
  const dirs = env
    ? env.split(path.delimiter).filter(Boolean)
    : [
        path.join(appDataDir ?? defaultAppDataDir(), 'extensions', 'workflows'),
        path.join(EXTENSIONS_DIR, 'workflows'),
      ];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d)) {
      const f = path.join(d, name, 'workflow.yaml');
      if (!existsSync(f)) continue;
      const mtime = statSync(f).mtimeMs;
      let c = wfCache.get(f);
      if (!c || c.mtime !== mtime) {
        try {
          const y = parse(readFileSync(f, 'utf8')) as {
            id?: string;
            config_defaults?: Record<string, unknown>;
          };
          c = { mtime, id: y?.id, defaults: y?.config_defaults };
        } catch {
          c = { mtime };
        }
        wfCache.set(f, c);
      }
      if (c.id === id) return { file: f, defaults: c.defaults };
    }
  }
  return undefined;
}

export interface ResolvedValue<T = unknown> {
  value: T;
  source: 'default' | ConfigTier;
  path: string;
}

export interface ConfigScope {
  channelDir: string;
  videoId?: string;
  sceneId?: string;
  frameId?: string;
}

export interface ResolveOptions {
  /** `%APPDATA%\StudioFlow` (D3 mục 1); mặc định theo biến môi trường APPDATA. */
  appDataDir?: string;
}

export function defaultAppDataDir(): string {
  if (process.env.SF_APP_DATA) return process.env.SF_APP_DATA;
  return path.join(
    process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming'),
    'StudioFlow',
  );
}

function readJson(file: string): Record<string, unknown> | undefined {
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)
    : undefined;
}

function defaultValue(key: string): unknown {
  if (key in DEFAULTS) return DEFAULTS[key];
  const spec = configKeySpec(key)!;
  const arg = patternArg(key);
  return (arg !== undefined ? PATTERN_DEFAULTS[spec.key]?.[arg] : undefined) ?? null;
}

/** Khóa chỉ có tầng app (ví dụ `gpu.*`): mặc định → `settings.json`.config, không cần kênh. */
export function resolveAppConfig<T = unknown>(key: string, opts: ResolveOptions = {}): T {
  requireKey(key);
  const settings = readJson(path.join(opts.appDataDir ?? defaultAppDataDir(), 'settings.json'));
  const cfg = settings?.config as Record<string, unknown> | undefined;
  return (cfg && key in cfg ? cfg[key] : defaultValue(key)) as T;
}

/** `resolveConfig` (D3 mục 7.3): app → channel → video → scene → frame, tầng sau thắng. */
export function resolveConfig<T = unknown>(
  key: string,
  scope: ConfigScope,
  opts: ResolveOptions = {},
): ResolvedValue<T> {
  const spec = requireKey(key);
  let result: ResolvedValue = {
    value: defaultValue(key),
    source: 'default',
    path: 'tech-defaults',
  };
  const take = (tier: ConfigTier, map: unknown, where: string) => {
    if (!spec.tiers.includes(tier) || !map || typeof map !== 'object') return;
    if (key in (map as object))
      result = { value: (map as Record<string, unknown>)[key], source: tier, path: where };
  };

  const settings = readJson(path.join(opts.appDataDir ?? defaultAppDataDir(), 'settings.json'));
  take('app', settings?.config, 'settings.json');

  const channel = readJson(path.join(scope.channelDir, 'channel.json'));
  if (!channel)
    throw new SfError('E_SCHEMA_INVALID', `${scope.channelDir} is not a channel (no channel.json)`);
  take('channel', channel.config, 'channel.json');

  if (scope.videoId) {
    const vRel = `videos/${scope.videoId}`;
    const state = readJson(path.join(scope.channelDir, 'videos', scope.videoId, 'state.json'));
    // tầng workflow (D3 7.1, 029): `config_defaults` của workflow đã chọn
    const wf = (state?.workflow as { id?: string } | null | undefined)?.id;
    if (wf && workflowTierAllowed(spec)) {
      const m = workflowManifestFile(wf, opts.appDataDir);
      if (m && m.defaults && key in m.defaults)
        result = { value: m.defaults[key], source: 'workflow', path: m.file };
    }
    if (state) {
      take('video', state.config_overrides, `${vRel}/state.json`);
      if (key === 'output.profile' && state.output_profile) {
        result = { value: state.output_profile, source: 'video', path: `${vRel}/state.json` };
      }
    }
    const sbPath = path.join(scope.channelDir, 'videos', scope.videoId, 'STORYBOARD.md');
    if ((scope.sceneId || scope.frameId) && existsSync(sbPath)) {
      const sb = toStoryboardDoc(parseStoryboard(readFileSync(sbPath, 'utf8')), { loose: true });
      const frame = scope.frameId ? sb.frames.find((f) => f.id === scope.frameId) : undefined;
      const sceneId = scope.sceneId ?? frame?.scene_id;
      const scene = sb.scenes.find((s) => s.id === sceneId);
      take('scene', scene?.config, `${vRel}/STORYBOARD.md`);
      take('frame', frame?.config, `${vRel}/STORYBOARD.md`);
    }
  }
  return result as ResolvedValue<T>;
}

/** Đặt khóa ở tầng channel/video qua module ghi (nền cho tool `config.set`, D4 mục 2.4). */
export function setConfig(
  store: WriteStore,
  key: string,
  value: unknown,
  target: { tier: 'channel' | 'video'; videoId?: string },
): void {
  checkConfigTier({ [key]: value }, target.tier);
  if (target.tier === 'channel') {
    const channel = JSON.parse(readFileSync(store.abs('channel.json'), 'utf8')) as {
      config: Record<string, unknown>;
    };
    channel.config = { ...channel.config, [key]: value };
    store.write('channel.json', `${JSON.stringify(channel, null, 2)}\n`, { by: 'config.set' });
    return;
  }
  if (!target.videoId) throw new SfError('E_CONFIG_SCOPE', 'video tier requires videoId');
  const rel = `videos/${target.videoId}/state.json`;
  const state = JSON.parse(readFileSync(store.abs(rel), 'utf8')) as Record<string, unknown> & {
    config_overrides: Record<string, unknown>;
  };
  if (key === 'output.profile') state.output_profile = value;
  else state.config_overrides = { ...state.config_overrides, [key]: value };
  state.updated_at = new Date().toISOString();
  store.write(rel, `${JSON.stringify(state, null, 2)}\n`, { by: 'config.set' });
}
