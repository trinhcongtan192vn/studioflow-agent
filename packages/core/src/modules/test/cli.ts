import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';

export const TEST_TYPES = ['contract', 'integration', 'e2e', 'gpu', 'ui', 'unit'] as const;
export type TestType = (typeof TEST_TYPES)[number];

interface Runner {
  project: string;
  cwd: string;
  cmd: string;
  args: string[];
}

/** Tìm gốc repo (package.json có `workspaces`) đi ngược từ `start`. */
export function findRepoRoot(start: string): string | undefined {
  let dir = start;
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg) && 'workspaces' in (JSON.parse(readFileSync(pkg, 'utf8')) as object)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Lệnh chạy một loại test ở mỗi project có loại đó (D12 mục 1). */
export function runnersFor(type: TestType, root: string): Runner[] {
  const node = process.execPath;
  const vitest = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  const runners: Runner[] = [];
  const core = path.join(root, 'packages', 'core');
  if (existsSync(path.join(core, 'tests', type))) {
    runners.push({
      project: 'packages/core',
      cwd: core,
      cmd: node,
      args: [vitest, 'run', `tests/${type}`],
    });
  }
  const desktop = path.join(root, 'apps', 'desktop');
  if (type === 'ui' && existsSync(path.join(desktop, 'tests', 'ui'))) {
    const pw = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
    runners.push({ project: 'apps/desktop', cwd: desktop, cmd: node, args: [pw, 'test'] });
  } else if (existsSync(path.join(desktop, 'tests', type))) {
    runners.push({
      project: 'apps/desktop',
      cwd: desktop,
      cmd: node,
      args: [vitest, 'run', `tests/${type}`],
    });
  }
  const worker = path.join(root, 'workers', 'gpu');
  if (existsSync(path.join(worker, 'tests', type))) {
    runners.push({
      project: 'workers/gpu',
      cwd: worker,
      cmd: 'uv',
      args: ['run', 'pytest', `tests/${type}`, '-q'],
    });
  }
  return runners;
}

function runType(type: TestType): CliCommand['run'] {
  return async (_input, ctx) => {
    const root =
      findRepoRoot(ctx.cwd) ?? findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
    if (!root) throw new CliError('E_TEST_NO_REPO', 'sf test must run inside the source repo');
    // Đầu ra của runner đi stderr để stdout chỉ có JSON (D4 mục 12).
    const projects = runnersFor(type, root).map((r) => {
      const res = spawnSync(r.cmd, r.args, { cwd: r.cwd, stdio: ['ignore', 2, 2], env: ctx.env });
      return { name: r.project, status: res.status === 0 ? 'pass' : 'fail' };
    });
    const failed = projects.filter((p) => p.status === 'fail').map((p) => p.name);
    if (failed.length) {
      throw new CliError('E_TEST_FAILED', `${type} tests failed in ${failed.join(', ')}`);
    }
    return { type, projects };
  };
}

/** `sf test <type>` (D4 mục 12, D12 mục 1). */
export const commands: CliCommand[] = TEST_TYPES.map((type) => ({
  module: 'test',
  name: type,
  summary: `Run ${type} tests across projects`,
  run: runType(type),
}));
