#!/usr/bin/env node
// 001 FR-001/002a — đúng 3 project; extensions/ chỉ là dữ liệu; phiên bản thống nhất.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROJECTS = ['apps/desktop', 'packages/core', 'workers/gpu'];
const MANIFESTS = ['package.json', 'pyproject.toml'];
const SKIP = new Set([
  'node_modules',
  '.git',
  '.venv',
  'dist',
  'out',
  'release',
  'coverage',
  '.specify',
  '.claude',
  'test-results',
]);

function findManifests(root, rel = '') {
  const found = [];
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name) && !(rel === '' && entry.name === 'scripts')) {
        found.push(...findManifests(root, path.posix.join(rel, entry.name)));
      }
    } else if (rel !== '' && MANIFESTS.includes(entry.name)) {
      found.push(rel);
    }
  }
  return found;
}

function readVersion(root, project) {
  const pkg = path.join(root, project, 'package.json');
  if (existsSync(pkg)) return JSON.parse(readFileSync(pkg, 'utf8')).version;
  const py = readFileSync(path.join(root, project, 'pyproject.toml'), 'utf8');
  return /^version\s*=\s*"([^"]+)"/m.exec(py)?.[1];
}

/** Trả về danh sách lỗi (rỗng = hợp lệ). */
export function checkStructure(root) {
  const errors = [];
  const projects = [...new Set(findManifests(root))].sort();
  for (const p of projects) {
    if (!PROJECTS.includes(p)) {
      errors.push(
        p.startsWith('extensions/')
          ? `extensions/ must contain data/scripts only, found project manifest in ${p} (constitution VIII)`
          : `unexpected project ${p}: only ${PROJECTS.join(', ')} are allowed (constitution VIII)`,
      );
    }
  }
  for (const p of PROJECTS) {
    if (!projects.includes(p)) errors.push(`missing project ${p}`);
  }
  const rootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const p of PROJECTS.filter((x) => projects.includes(x))) {
    const v = readVersion(root, p);
    if (v !== rootPkg.version)
      errors.push(`${p} version ${v} differs from repo version ${rootPkg.version}`);
  }
  const coreVersion = path.join(root, 'packages/core/src/version.ts');
  if (existsSync(coreVersion)) {
    const v = /CORE_VERSION = '([^']+)'/.exec(readFileSync(coreVersion, 'utf8'))?.[1];
    if (v !== rootPkg.version)
      errors.push(`CORE_VERSION ${v} differs from repo version ${rootPkg.version}`);
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const errors = checkStructure(root);
  for (const e of errors) console.error(`check-structure: ${e}`);
  process.exitCode = errors.length ? 1 : 0;
}
