// 002 · US6 · FR-020 (FR-WS-05).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MigrationRegistry, migrateVideo, WriteStore } from '../../src/index.js';
import { copyChannel, fixtureVideoId } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));
function setup() {
  const c = copyChannel();
  cleanups.push(c.cleanup);
  const registry = new MigrationRegistry();
  // Migration giả: caption_groups v1 → v2 đổi style. Schema v2 = schema hiện tại với schema_version 2.
  registry.register({
    kind: 'caption_groups',
    from: 1,
    fn: (doc: any) => ({ ...doc, schema_version: 2, style: `${doc.style}-v2` }),
  });
  return { dir: c.dir, registry, store: new WriteStore(c.dir) };
}
const rel = `videos/${fixtureVideoId}/caption_groups.json`;

describe('migration (002 US6)', () => {
  it('backs up, migrates to the current version and validates', () => {
    const { dir, registry, store } = setup();
    const r = migrateVideo(store, fixtureVideoId, { registry });
    expect(r.migrated).toEqual([
      { path: rel, from: 1, to: 2, backup: expect.stringMatching(/\.sf\/backups\//) },
    ]);
    const doc = JSON.parse(readFileSync(path.join(dir, rel), 'utf8'));
    expect(doc).toMatchObject({ schema_version: 2, style: 'caption-highlight-v2' });
    expect(existsSync(path.join(dir, r.migrated[0]!.backup!))).toBe(true);
    expect(
      JSON.parse(readFileSync(path.join(dir, r.migrated[0]!.backup!), 'utf8')).schema_version,
    ).toBe(1);
  });

  it('dry run lists files without writing', () => {
    const { dir, registry, store } = setup();
    const before = readFileSync(path.join(dir, rel), 'utf8');
    const r = migrateVideo(store, fixtureVideoId, { registry, dryRun: true });
    expect(r).toEqual({ dry_run: true, migrated: [{ path: rel, from: 1, to: 2 }] });
    expect(readFileSync(path.join(dir, rel), 'utf8')).toBe(before);
    expect(store.log()).toEqual([]);
  });

  it('newer schema_version than supported → E_SCHEMA_TOO_NEW, nothing written', () => {
    const { dir, registry, store } = setup();
    const doc = JSON.parse(readFileSync(path.join(dir, rel), 'utf8'));
    writeFileSync(path.join(dir, rel), JSON.stringify({ ...doc, schema_version: 99 }));
    expect(() => migrateVideo(store, fixtureVideoId, { registry })).toThrow(
      expect.objectContaining({ code: 'E_SCHEMA_TOO_NEW' }),
    );
    expect(store.log()).toEqual([]);
  });

  it('with no migrations registered everything is current', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const store = new WriteStore(c.dir);
    expect(migrateVideo(store, fixtureVideoId).migrated).toEqual([]);
  });

  it('migrates Markdown front matter too', () => {
    const { dir, store } = setup();
    const registry = new MigrationRegistry();
    registry.register({
      kind: 'brief',
      from: 1,
      fn: (doc: any) => ({ ...doc, front: { ...doc.front, schema_version: 2 } }),
    });
    const r = migrateVideo(store, fixtureVideoId, { registry });
    expect(r.migrated.map((m) => m.path)).toEqual([`videos/${fixtureVideoId}/BRIEF.md`]);
    const text = readFileSync(path.join(dir, 'videos', fixtureVideoId, 'BRIEF.md'), 'utf8');
    expect(text).toContain('schema_version: 2');
    expect(text).toContain('Chủ đề: sự kiện năm 1428.');
  });
});
