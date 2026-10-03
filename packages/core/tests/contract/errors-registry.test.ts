// 002 · US7 · FR-002, FR-003 — registry mã lỗi và đồng bộ hợp đồng.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorRegistry } from '../../src/contracts/errors.js';
import { coreDir } from '../helpers.js';

const repoRoot = path.resolve(coreDir, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === 'contracts' ? [] : sourceFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('error registry (002 FR-002)', () => {
  const codes = new Set<string>(errorRegistry.errors.map((e) => e.code));

  it('every E_* used in core src is registered', () => {
    const missing = new Set<string>();
    for (const f of sourceFiles(path.join(coreDir, 'src'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/['"`](E_[A-Z0-9_]+)['"`]/g)) {
        if (!codes.has(m[1]!)) missing.add(`${m[1]} (${path.relative(coreDir, f)})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('a code shared by two docs appears once with both sources', () => {
    const e = errorRegistry.errors.filter((x) => x.code === 'E_PATH_OUTSIDE');
    expect(e).toHaveLength(1);
    expect(e[0]!.sources.map((s) => s.doc)).toEqual(
      expect.arrayContaining([
        'docs/03-spec-domain-artifacts.md',
        'docs/05-spec-agent-runtime-policy.md',
      ]),
    );
  });

  it('retryable defaults to false and is true where docs say so', () => {
    const byCode = Object.fromEntries(errorRegistry.errors.map((e) => [e.code, e.retryable]));
    expect(byCode.E_SCHEMA_INVALID).toBe(false);
    expect(byCode.E_PROVIDER_FAILED).toBe(true);
    expect(byCode.E_RUNTIME_RATE_LIMIT).toBe(true);
  });

  it('generated contracts are up to date (FR-003)', () => {
    execFileSync(process.execPath, ['scripts/gen-contracts.mjs', '--check'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  });
});
