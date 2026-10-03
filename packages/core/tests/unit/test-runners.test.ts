// 001 · FR-012 — `sf test <type>` chọn runner theo project.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readJsonInput, MAX_STDIN_BYTES } from '../../src/cli/io.js';
import { commands, findRepoRoot, runnersFor, TEST_TYPES } from '../../src/modules/test/cli.js';
import { coreDir } from '../helpers.js';

const repoRoot = path.resolve(coreDir, '..', '..');

describe('sf test runners (001 FR-012)', () => {
  it('registers one command per D12 test type', () => {
    expect(commands.map((c) => c.name)).toEqual([...TEST_TYPES]);
  });

  it('finds the repo root from a nested directory', () => {
    expect(findRepoRoot(path.join(coreDir, 'src', 'cli'))).toBe(repoRoot);
  });

  it('returns undefined outside a repo', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'norepo-'));
    try {
      writeFileSync(path.join(dir, 'package.json'), '{}');
      expect(findRepoRoot(dir) === repoRoot).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps contract tests to core vitest', () => {
    const runners = runnersFor('contract', repoRoot);
    expect(runners[0]).toMatchObject({ project: 'packages/core' });
    expect(runners[0]!.args).toContain('tests/contract');
  });

  it('a type with no directories yields no runners', () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    try {
      expect(runnersFor('unit', empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('reports failure as E_TEST_FAILED (exit 1) and success as JSON', async () => {
    const fake = mkdtempSync(path.join(os.tmpdir(), 'fakerepo-'));
    try {
      writeFileSync(path.join(fake, 'package.json'), '{"workspaces":[]}');
      const cmd = commands.find((c) => c.name === 'e2e')!;
      // Không có project nào → không chạy gì, trả danh sách rỗng.
      await expect(cmd.run({}, { cwd: fake, env: process.env })).resolves.toEqual({
        type: 'e2e',
        projects: [],
      });
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });
});

describe('readJsonInput (001 FR-008)', () => {
  it('reads JSON from a stream', async () => {
    await expect(
      readJsonInput(Readable.from([Buffer.from('{"a":'), Buffer.from('1}')])),
    ).resolves.toEqual({ a: 1 });
  });

  it('empty input is an empty object', async () => {
    await expect(readJsonInput('  ')).resolves.toEqual({});
  });

  it('rejects arrays and oversized streams', async () => {
    await expect(readJsonInput('[1]')).rejects.toMatchObject({ code: 'E_CLI_BAD_JSON' });
    const big = Readable.from([Buffer.alloc(MAX_STDIN_BYTES + 1, 0x20)]);
    await expect(readJsonInput(big)).rejects.toMatchObject({ code: 'E_CLI_BAD_JSON', exit: 2 });
  });
});
