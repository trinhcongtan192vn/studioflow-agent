import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { EXTENSIONS_DIR } from '../agent/options.js';
import type { ProviderRegistry } from '../capability/registry.js';
import { defaultAppDataDir } from '../config/resolve.js';
import type { WorkflowManifest } from '../contracts/types.js';
import { validateValue } from '../domain/validate.js';
import { validateManifest, type ManifestError } from './library.js';
import { satisfies } from './semver.js';

/** Phiên bản API của app mà gói khai báo `app_api` (D13). */
export const APP_API = '1.0.0';
/** Giai đoạn hiện tại của app (D6 `skip_if.phase_before`). */
export const APP_PHASE = 'M3';
const PHASES = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M5b'];
export const phaseBefore = (p: string): boolean => PHASES.indexOf(APP_PHASE) < PHASES.indexOf(p);

export interface WorkflowPack {
  dir: string;
  manifest: WorkflowManifest;
  compatible: boolean;
  errors: (ManifestError | { code: string; message: string })[];
}

/** Đọc + kiểm một gói workflow (`sf ext validate`, D13). */
export function loadPack(dir: string, providers?: ProviderRegistry): WorkflowPack {
  const errors: WorkflowPack['errors'] = [];
  const file = path.join(dir, 'workflow.yaml');
  let manifest = {} as WorkflowManifest;
  if (!existsSync(file)) errors.push({ code: 'E_SCHEMA_INVALID', message: `${file} not found` });
  else {
    manifest = parse(readFileSync(file, 'utf8')) as WorkflowManifest;
    for (const e of validateValue('WorkflowManifest', manifest))
      errors.push({ code: 'E_SCHEMA_INVALID', message: `workflow.yaml ${e.message}` });
  }
  if (!existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) {
    errors.push({ code: 'E_SCHEMA_INVALID', message: '.claude-plugin/plugin.json not found' });
  }
  if (errors.length === 0) {
    errors.push(...validateManifest(manifest));
    if (!satisfies(APP_API, manifest.app_api)) {
      errors.push({
        code: 'E_WORKFLOW_INCOMPATIBLE',
        message: `app_api ${manifest.app_api} does not include ${APP_API}`,
      });
    }
    if (providers) {
      for (const cap of manifest.requires) {
        if (providers.forCapability(cap).length === 0) {
          errors.push({
            code: 'E_WORKFLOW_INCOMPATIBLE',
            message: `required capability ${cap} has no provider`,
          });
        }
      }
    }
  }
  return { dir, manifest, compatible: errors.length === 0, errors };
}

/** Thư mục gói: `<app-data>/extensions/workflows` trước `<install>/extensions/workflows` (D5 mục 3.2). */
export function defaultWorkflowDirs(appDataDir = defaultAppDataDir()): string[] {
  const env = process.env.SF_WORKFLOW_DIRS;
  if (env) return env.split(path.delimiter).filter(Boolean);
  return [path.join(appDataDir, 'extensions', 'workflows'), path.join(EXTENSIONS_DIR, 'workflows')];
}

/** Mọi gói (cả không tương thích); gói ở thư mục trước thắng khi trùng id. */
export function loadPacks(dirs: string[], providers?: ProviderRegistry): WorkflowPack[] {
  const seen = new Map<string, WorkflowPack>();
  for (const root of dirs) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const pack = loadPack(path.join(root, d.name), providers);
      const id = pack.manifest.id ?? d.name;
      if (!seen.has(id)) seen.set(id, pack);
    }
  }
  return [...seen.values()];
}
