// 002 · FR-001, FR-013 — hợp đồng phủ đủ D3.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { configKeyTable } from '../../src/contracts/config-keys.js';
import { schemas } from '../../src/contracts/schemas.js';
import { coreDir } from '../helpers.js';

const repoRoot = path.resolve(coreDir, '..', '..');
const d3 = readFileSync(path.join(repoRoot, 'docs/03-spec-domain-artifacts.md'), 'utf8');
const types = readFileSync(path.join(coreDir, 'src/contracts/types.ts'), 'utf8');

describe('contracts mirror D3 (002 FR-001)', () => {
  it('every interface/type in D3 TS blocks is exported in contracts', () => {
    const blocks = [...d3.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]!).join('\n');
    const names = [...blocks.matchAll(/^(?:interface|type) (\w+)/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(20);
    for (const n of names) expect(types).toMatch(new RegExp(`export (interface|type) ${n}\\b`));
  });

  it('every key in D3 7.2 is in the key table', () => {
    const sec = d3.slice(d3.indexOf('### 7.2'), d3.indexOf('### 7.3'));
    const keys = [...sec.matchAll(/`([a-z_.<>]+)`/g)]
      .map((m) => m[1]!)
      .filter((k) => k.includes('.'));
    const table = new Set<string>(configKeyTable.keys.map((k) => k.key));
    for (const k of keys) expect(table.has(k)).toBe(true);
  });

  it('ID patterns follow D3 section 2', () => {
    const s = JSON.stringify(schemas.ScriptDoc);
    expect(s).toContain('^ln_[0-9a-z]{8}$');
    expect(s).toContain('^bt_[0-9a-z]{8}$');
  });
});
