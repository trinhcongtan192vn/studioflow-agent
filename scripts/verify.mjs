#!/usr/bin/env node
// 001 FR-004 — build + lint + test cho cả 3 project, báo cáo theo project (contracts/verify-report.md).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const bin = (p) => path.join(root, 'node_modules', p);

/** Kế hoạch mặc định: [project, step, cwd, cmd, args]. */
export function defaultPlan() {
  const core = path.join(root, 'packages/core');
  const desktop = path.join(root, 'apps/desktop');
  const worker = path.join(root, 'workers/gpu');
  return [
    {
      project: 'repo',
      step: 'lint',
      cwd: root,
      cmd: node,
      args: [bin('eslint/bin/eslint.js'), '.'],
    },
    {
      project: 'repo',
      step: 'format',
      cwd: root,
      cmd: node,
      args: [bin('prettier/bin/prettier.cjs'), '--check', '.'],
    },
    {
      project: 'repo',
      step: 'contracts',
      cwd: root,
      cmd: node,
      args: ['scripts/gen-contracts.mjs', '--check'],
    },
    {
      project: 'repo',
      step: 'structure',
      cwd: root,
      cmd: node,
      args: ['scripts/check-structure.mjs'],
    },
    {
      project: 'repo',
      step: 'test',
      cwd: root,
      cmd: node,
      args: ['--test', 'scripts/tests/*.test.mjs'],
    },
    {
      project: 'packages/core',
      step: 'build',
      cwd: core,
      cmd: node,
      args: [bin('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
    },
    {
      project: 'packages/core',
      step: 'typecheck',
      cwd: core,
      cmd: node,
      args: [bin('typescript/bin/tsc'), '-p', 'tsconfig.json', '--noEmit'],
    },
    {
      project: 'packages/core',
      step: 'test',
      cwd: core,
      cmd: node,
      // không đo coverage trong verify (chậm ~20–30%): `npm run test:coverage` trong packages/core
      args: [bin('vitest/vitest.mjs'), 'run'],
    },
    {
      project: 'apps/desktop',
      step: 'build',
      cwd: desktop,
      cmd: node,
      args: [bin('electron-vite/bin/electron-vite.js'), 'build'],
    },
    {
      project: 'apps/desktop',
      step: 'typecheck',
      cwd: desktop,
      cmd: node,
      args: [bin('typescript/bin/tsc'), '-p', 'tsconfig.json', '--noEmit'],
    },
    {
      project: 'apps/desktop',
      step: 'test',
      cwd: desktop,
      cmd: node,
      args: [bin('vitest/vitest.mjs'), 'run'],
    },
    {
      project: 'apps/desktop',
      step: 'test:ui',
      cwd: desktop,
      cmd: node,
      args: [bin('@playwright/test/cli.js'), 'test'],
    },
    {
      project: 'workers/gpu',
      step: 'lint',
      cwd: worker,
      cmd: 'uv',
      args: ['run', 'ruff', 'check', '.'],
    },
    {
      project: 'workers/gpu',
      step: 'format',
      cwd: worker,
      cmd: 'uv',
      args: ['run', 'ruff', 'format', '--check', '.'],
    },
    { project: 'workers/gpu', step: 'test', cwd: worker, cmd: 'uv', args: ['run', 'pytest', '-q'] },
  ];
}

const tail = (s, n = 4096) => (s.length > n ? s.slice(-n) : s);

/** Chạy kế hoạch; bước hỏng không dừng các bước khác (để báo cáo đủ). */
export function runPlan(plan, { env = process.env, log = (s) => process.stdout.write(s) } = {}) {
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const projects = new Map();
  for (const s of plan) {
    const t0 = Date.now();
    log(`▶ ${s.project} ${s.step}\n`);
    const r = spawnSync(s.cmd, s.args, {
      cwd: s.cwd,
      env: childEnv,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const ok = r.status === 0;
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`;
    if (!projects.has(s.project)) projects.set(s.project, { name: s.project, steps: [] });
    projects
      .get(s.project)
      .steps.push({ step: s.step, ok, ms: Date.now() - t0, ...(ok ? {} : { detail: tail(out) }) });
    if (!ok) log(tail(out) + '\n');
  }
  const list = [...projects.values()];
  return { ok: list.every((p) => p.steps.every((s) => s.ok)), projects: list };
}

export function formatReport(report) {
  const lines = ['', 'Verify report', '-------------'];
  for (const p of report.projects) {
    const bad = p.steps.filter((s) => !s.ok);
    lines.push(
      `${bad.length ? 'FAIL' : 'PASS'}  ${p.name.padEnd(14)} ${p.steps.map((s) => `${s.step}:${s.ok ? 'ok' : 'FAIL'}`).join('  ')}`,
    );
  }
  lines.push(report.ok ? '\nALL GREEN' : '\nFAILED');
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { SF_GPU: '0', SF_LLM: 'replay', ...process.env };
  const report = runPlan(defaultPlan(), { env });
  writeFileSync(path.join(root, 'verify-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(formatReport(report));
  process.exitCode = report.ok ? 0 : 1;
}
