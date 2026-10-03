// 001 · US1 AC2, US3 AC1/AC4, US6 · FR-002/004/006/019 — script khung.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkMessage } from '../check-commit-msg.mjs';
import { checkStructure } from '../check-structure.mjs';
import { atLeast, check, parseVersion } from '../doctor.mjs';
import { formatReport, runPlan } from '../verify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function fakeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ version: '1.0.0', workspaces: [] }),
  );
  for (const p of ['apps/desktop', 'packages/core']) {
    mkdirSync(path.join(dir, p), { recursive: true });
    writeFileSync(path.join(dir, p, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  }
  mkdirSync(path.join(dir, 'workers/gpu'), { recursive: true });
  writeFileSync(path.join(dir, 'workers/gpu/pyproject.toml'), '[project]\nversion = "1.0.0"\n');
  return dir;
}

test('check-structure: real repo is valid (US3 AC1)', () => {
  assert.deepEqual(checkStructure(root), []);
});

test('check-structure: a fourth project is reported (FR-SC-002a)', () => {
  const dir = fakeRepo();
  try {
    assert.deepEqual(checkStructure(dir), []);
    mkdirSync(path.join(dir, 'packages/extra'), { recursive: true });
    writeFileSync(path.join(dir, 'packages/extra/package.json'), '{}');
    mkdirSync(path.join(dir, 'extensions/workflows/x'), { recursive: true });
    writeFileSync(path.join(dir, 'extensions/workflows/x/package.json'), '{}');
    const errors = checkStructure(dir);
    assert.equal(errors.length, 2);
    assert.match(errors.join('\n'), /unexpected project packages\/extra/);
    assert.match(errors.join('\n'), /extensions\/ must contain data/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-structure: version drift is reported', () => {
  const dir = fakeRepo();
  try {
    writeFileSync(
      path.join(dir, 'packages/core/package.json'),
      JSON.stringify({ version: '2.0.0' }),
    );
    assert.match(checkStructure(dir).join('\n'), /packages\/core version 2.0.0 differs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop importing core internals fails lint (US3 AC4, FR-SC-002b)', () => {
  const file = path.join(root, 'apps/desktop/src/__lint_probe__.ts');
  writeFileSync(
    file,
    "import { main } from '@studioflow/core/dist/cli/main.js';\nexport { main };\n",
  );
  try {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [path.join(root, 'node_modules/eslint/bin/eslint.js'), file],
          { cwd: root, stdio: 'pipe' },
        ),
      (e) => /no-restricted-imports/.test(String(e.stdout)),
    );
  } finally {
    rmSync(file, { force: true });
  }
});

test('check-commit-msg (US6 AC1/AC2, FR-019)', () => {
  assert.notEqual(checkMessage('fix: something'), null);
  assert.equal(checkMessage('feat(core): sf CLI (001 FR-008)'), null);
  assert.equal(checkMessage('chore: x\n\nRefs 002'), null);
  assert.equal(checkMessage("Merge branch '001-repo-scaffold'"), null);
  assert.notEqual(checkMessage('# 001 only in comment\nfix: y'), null);
});

test('doctor reports missing and outdated tools (FR-006)', () => {
  assert.deepEqual(parseVersion('Python 3.12.7'), [3, 12, 7]);
  assert.equal(atLeast([22, 1, 0], '22.0.0'), true);
  assert.equal(atLeast([3, 10, 9], '3.11.0'), false);
  const reqs = [
    { tool: 'a', args: [], min: '1.0.0', hint: 'h' },
    { tool: 'b', args: [], min: '2.0.0', hint: 'h' },
  ];
  const res = check(reqs, (tool) => (tool === 'a' ? 'v1.2.3' : undefined));
  assert.deepEqual(
    res.map((r) => [r.tool, r.ok, r.found]),
    [
      ['a', true, '1.2.3'],
      ['b', false, null],
    ],
  );
});

test('verify: a failing step fails the report and names the project (US1 AC2)', () => {
  const node = process.execPath;
  const report = runPlan(
    [
      { project: 'good', step: 'test', cwd: root, cmd: node, args: ['-e', 'process.exit(0)'] },
      {
        project: 'bad',
        step: 'test',
        cwd: root,
        cmd: node,
        args: ['-e', 'console.error("boom.test failed");process.exit(1)'],
      },
      { project: 'bad', step: 'lint', cwd: root, cmd: node, args: ['-e', ''] },
    ],
    { log: () => {} },
  );
  assert.equal(report.ok, false);
  const bad = report.projects.find((p) => p.name === 'bad');
  assert.equal(bad.steps[0].ok, false);
  assert.match(bad.steps[0].detail, /boom.test failed/);
  assert.equal(bad.steps[1].ok, true, 'later steps still run');
  assert.match(formatReport(report), /FAIL\s+bad/);
  assert.match(formatReport(report), /PASS\s+good/);
});
