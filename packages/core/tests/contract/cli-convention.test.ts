// 001 · US2 AC1–4 · FR-008, FR-009 · SC-003 — quy ước D4 mục 12.
import { describe, expect, it } from 'vitest';
import { runSf } from '../helpers.js';

function parseErr(stderr: string): { code: string; message: string } {
  const lines = stderr.trim().split('\n');
  expect(lines).toHaveLength(1);
  const err = JSON.parse(lines[0]!) as { code: string; message: string };
  expect(typeof err.code).toBe('string');
  expect(typeof err.message).toBe('string');
  return err;
}

describe('sf CLI convention (001 FR-008)', () => {
  it('--version prints JSON with version, exit 0', () => {
    const r = runSf(['--version']);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toMatchObject({
      name: 'studioflow',
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
  });

  it('--help lists registered commands', () => {
    const r = runSf(['--help']);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as { commands: { module: string; name: string }[] };
    expect(out.commands).toEqual(
      expect.arrayContaining([expect.objectContaining({ module: 'diag', name: 'echo' })]),
    );
  });

  it('valid args → JSON stdout, empty stderr, exit 0', () => {
    const r = runSf(['diag', 'echo', '--message', 'xin chào', '--repeat', '2']);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual({
      message: 'xin chào',
      repeat: 2,
      echo: ['xin chào', 'xin chào'],
    });
  });

  it('JSON stdin is equivalent to args', () => {
    const r = runSf(['diag', 'echo', '--json'], {
      input: JSON.stringify({ message: 'hi', repeat: 1 }),
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ message: 'hi', repeat: 1, echo: ['hi'] });
  });

  it('missing argument → exit 2, {code,message}, empty stdout', () => {
    const r = runSf(['diag', 'echo']);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(parseErr(r.stderr).code).toBe('E_CLI_USAGE');
  });

  it('wrong type → exit 2', () => {
    const r = runSf(['diag', 'echo', '--message', 'a', '--repeat', 'abc']);
    expect(r.code).toBe(2);
    expect(parseErr(r.stderr).code).toBe('E_CLI_USAGE');
  });

  it('unknown option → exit 2', () => {
    const r = runSf(['diag', 'echo', '--message', 'a', '--bogus']);
    expect(r.code).toBe(2);
    expect(parseErr(r.stderr).code).toBe('E_CLI_USAGE');
  });

  it('unknown command → exit 2', () => {
    const r = runSf(['nope', 'cmd']);
    expect(r.code).toBe(2);
    expect(parseErr(r.stderr).code).toBe('E_CLI_USAGE');
  });

  it('invalid JSON stdin → exit 2 E_CLI_BAD_JSON', () => {
    const r = runSf(['diag', 'echo', '--json'], { input: '{not json' });
    expect(r.code).toBe(2);
    expect(parseErr(r.stderr).code).toBe('E_CLI_BAD_JSON');
  });

  it('oversized JSON stdin → exit 2 without hanging', () => {
    const r = runSf(['diag', 'echo', '--json'], { input: 'x'.repeat(1024 * 1024 + 10) });
    expect(r.code).toBe(2);
    expect(parseErr(r.stderr).code).toBe('E_CLI_BAD_JSON');
  });

  it('business failure → exit 1 with code', () => {
    const r = runSf(['diag', 'fail']);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(parseErr(r.stderr).code).toBe('E_DIAG_FAIL');
  });
});
