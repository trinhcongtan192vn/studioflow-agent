// 001 · US2 AC5 · FR-010 · SC-006 — module tự đăng ký, phát hiện trùng.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../../src/cli/main.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeModule(root: string, mod: string, cmd: string): void {
  const dir = path.join(root, mod);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'cli.mjs'),
    `export const commands = [{ module: '${mod}', name: '${cmd}', summary: 'fake', run: async () => ({ ok: '${mod}' }) }];\n`,
  );
}

async function capture(argv: string[], modulesDirs: string[], stdin = '') {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (c: Buffer) => (out += c.toString()));
  stderr.on('data', (c: Buffer) => (err += c.toString()));
  const code = await main(argv, {
    stdout,
    stderr,
    stdin,
    modulesDirs: modulesDirs.length ? modulesDirs : undefined,
  });
  return { code, out, err };
}

describe('CLI registry (001 FR-010)', () => {
  it('discovers a new module without touching the framework', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sf-mod-'));
    tmpDirs.push(root);
    fakeModule(root, 'demo', 'hello');
    const help = await capture(['--help'], [root]);
    expect(help.code).toBe(0);
    expect(JSON.parse(help.out).commands).toEqual([
      { module: 'demo', name: 'hello', summary: 'fake' },
    ]);
    const run = await capture(['demo', 'hello'], [root]);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.out)).toEqual({ ok: 'demo' });
  });

  it('duplicate command names are rejected, not chosen silently', async () => {
    const a = mkdtempSync(path.join(os.tmpdir(), 'sf-mod-'));
    const b = mkdtempSync(path.join(os.tmpdir(), 'sf-mod-'));
    tmpDirs.push(a, b);
    fakeModule(a, 'demo', 'hello');
    fakeModule(b, 'demo', 'hello');
    const r = await capture(['--help'], [a, b]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).code).toBe('E_CLI_DUPLICATE_COMMAND');
  });

  it('built-in modules run in-process (diag echo/fail, json stdin)', async () => {
    const ok = await capture(['diag', 'echo', '--json', '--repeat', '3'], [], '{"message":"a"}');
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.out).echo).toEqual(['a', 'a', 'a']);
    const fail = await capture(['diag', 'fail'], []);
    expect(fail.code).toBe(1);
    const ver = await capture(['--version'], []);
    expect(JSON.parse(ver.out).name).toBe('studioflow');
  });

  it('unexpected exceptions map to E_INTERNAL exit 1', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sf-mod-'));
    tmpDirs.push(root);
    mkdirSync(path.join(root, 'boom'));
    writeFileSync(
      path.join(root, 'boom', 'cli.mjs'),
      `export const commands = [{ module: 'boom', name: 'x', summary: '', run: async () => { throw new Error('kaput'); } }];\n`,
    );
    const r = await capture(['boom', 'x'], [root]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err)).toMatchObject({ code: 'E_INTERNAL', message: 'kaput' });
  });
});
