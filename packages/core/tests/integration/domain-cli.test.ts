// 002 · FR-021 — sf artifact validate|migrate, sf config resolve.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runSf } from '../helpers.js';
import { copyChannel, fixtureChannel, fixtureVideo, fixtureVideoId } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

describe('domain CLI (002 FR-021)', () => {
  it('artifact validate: valid file → exit 0', () => {
    const r = runSf(['artifact', 'validate', path.join(fixtureVideo, 'SCRIPT.md')]);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual({ valid: true, kind: 'script', errors: [] });
  });

  it('artifact validate: invalid file → exit 1 with details', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const p = path.join(c.dir, 'videos', fixtureVideoId, 'state.json');
    writeFileSync(p, '{"schema_version":1}');
    const r = runSf(['artifact', 'validate', p]);
    expect(r.code).toBe(1);
    const err = JSON.parse(r.stderr);
    expect(err.code).toBe('E_SCHEMA_INVALID');
    expect(err.details.length).toBeGreaterThan(0);
  });

  it('artifact validate: unknown kind → exit 2', () => {
    const r = runSf(['artifact', 'validate', path.join(fixtureChannel, 'unknown.txt')]);
    expect(r.code).toBe(2);
  });

  it('artifact migrate --dry-run → exit 0', () => {
    const r = runSf(['artifact', 'migrate', fixtureVideo, '--dry-run']);
    expect(JSON.parse(r.stdout)).toEqual({ dry_run: true, migrated: [] });
  });

  it('config resolve: deepest tier wins', () => {
    const r = runSf([
      'config',
      'resolve',
      'look.id',
      '--channel',
      fixtureChannel,
      '--video',
      fixtureVideoId,
      '--frame',
      'fr_9x2b7cqe',
    ]);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toMatchObject({ value: 'frame-look', source: 'frame' });
  });

  it('config resolve: unknown key → exit 1', () => {
    const r = runSf(['config', 'resolve', 'nope.key', '--channel', fixtureChannel]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe('E_CONFIG_UNKNOWN_KEY');
  });
});
