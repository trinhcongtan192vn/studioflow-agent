// 002 · US5 · FR-016..018 (NFR-01, NFR-02).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256, WriteStore } from '../../src/index.js';
import { copyChannel, fixtureVideoId, tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));
function channel() {
  const c = copyChannel();
  cleanups.push(c.cleanup);
  return c.dir;
}
const V = `videos/${fixtureVideoId}`;

describe('WriteStore (002 US5)', () => {
  it('writes valid content atomically, returns hash, logs the write', () => {
    const dir = channel();
    const store = new WriteStore(dir);
    const content = readFileSync(path.join(dir, V, 'caption_groups.json'), 'utf8').replace(
      'Năm 1428,',
      'Năm 1428!',
    );
    const r = store.write(`${V}/caption_groups.json`, content, { by: 'test' });
    expect(r.hash).toBe(sha256(content));
    expect(readFileSync(path.join(dir, V, 'caption_groups.json'), 'utf8')).toBe(content);
    expect(store.log()).toEqual([
      { path: `${V}/caption_groups.json`, hash: r.hash, by: 'test', ts: expect.any(String) },
    ]);
    expect(readdirSync(path.join(dir, V, '.sf', 'tmp'))).toEqual([]);
  });

  it('rejects schema-invalid content and leaves the target untouched', () => {
    const dir = channel();
    const before = readFileSync(path.join(dir, V, 'audio_meta.json'), 'utf8');
    const store = new WriteStore(dir);
    expect(() =>
      store.write(`${V}/audio_meta.json`, '{"schema_version":1}', { by: 'test' }),
    ).toThrow(expect.objectContaining({ code: 'E_SCHEMA_INVALID' }));
    expect(readFileSync(path.join(dir, V, 'audio_meta.json'), 'utf8')).toBe(before);
    expect(store.log()).toEqual([]);
  });

  it.each([
    ['absolute', 'C:/Windows/evil.txt'],
    ['parent escape', '../evil.txt'],
    ['nested escape', 'videos/../../evil.txt'],
    ['drive-relative', 'D:evil.txt'],
    ['UNC', '//server/share/evil.txt'],
  ])('rejects %s paths with E_PATH_OUTSIDE', (_name, rel) => {
    const dir = channel();
    const store = new WriteStore(dir);
    expect(() => store.write(rel, 'x', { by: 'test' })).toThrow(
      expect.objectContaining({ code: 'E_PATH_OUTSIDE' }),
    );
    expect(existsSync(path.join(dir, '..', 'evil.txt'))).toBe(false);
  });

  it('rejects writes through a junction that points outside the channel', () => {
    const dir = channel();
    const outside = tempDir('ngoài-');
    cleanups.push(outside.cleanup);
    execFileSync('cmd', ['/c', 'mklink', '/J', path.join(dir, 'link'), outside.dir]);
    const store = new WriteStore(dir);
    expect(() => store.write('link/evil.txt', 'x', { by: 'test' })).toThrow(
      expect.objectContaining({ code: 'E_PATH_OUTSIDE' }),
    );
    expect(readdirSync(outside.dir)).toEqual([]);
  });

  it('backs up an approved artifact before overwriting and keeps 20 copies', () => {
    const dir = channel();
    const store = new WriteStore(dir);
    const script = readFileSync(path.join(dir, V, 'SCRIPT.md'), 'utf8');
    // state.json fixture: approval "approved" lists SCRIPT.md
    for (let i = 0; i < 22; i++) {
      const r = store.write(`${V}/SCRIPT.md`, script.replace('Bệ hạ…', `Bệ hạ ${i}`), {
        by: 'test',
      });
      expect(r.backup).toMatch(/^videos\/vd_8m2pq7rt\/\.sf\/backups\/[0-9TZ.-]+\/SCRIPT\.md$/);
    }
    const backups = readdirSync(path.join(dir, V, '.sf', 'backups')).filter((d) =>
      existsSync(path.join(dir, V, '.sf', 'backups', d, 'SCRIPT.md')),
    );
    expect(backups).toHaveLength(20);
    const first = readFileSync(
      path.join(dir, V, '.sf', 'backups', backups.sort()[0]!, 'SCRIPT.md'),
      'utf8',
    );
    expect(first).toContain('Bệ hạ 1');
  });

  it('does not back up files that are not approved or pinned', () => {
    const dir = channel();
    const store = new WriteStore(dir);
    const content = readFileSync(path.join(dir, V, 'caption-overrides.json'), 'utf8');
    expect(store.write(`${V}/caption-overrides.json`, content, { by: 't' }).backup).toBeUndefined();
  });

  it('backs up the HTML of a pinned frame', () => {
    const dir = channel();
    const statePath = path.join(dir, V, 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.pinned_frames = {
      fr_9x2b7cqe: {
        pinned_at: '2026-10-03T11:00:00+07:00',
        base_hash: 'a'.repeat(64),
        changes: [],
      },
    };
    writeFileSync(statePath, JSON.stringify(state));
    mkdirSync(path.join(dir, V, 'compositions', 'frames'), { recursive: true });
    writeFileSync(path.join(dir, V, 'compositions/frames/fr_9x2b7cqe.html'), '<div>old</div>');
    const store = new WriteStore(dir);
    const r = store.write(`${V}/compositions/frames/fr_9x2b7cqe.html`, '<div>new</div>', {
      by: 't',
    });
    expect(readFileSync(path.join(dir, r.backup!), 'utf8')).toBe('<div>old</div>');
  });

  it('writes binary content without schema validation', () => {
    const dir = channel();
    const store = new WriteStore(dir);
    const buf = Buffer.from([0, 1, 2, 255]);
    const r = store.write(`${V}/audio/lines/ln_2r7c4kxm.wav`, buf, { by: 'tts' });
    expect(readFileSync(path.join(dir, V, 'audio/lines/ln_2r7c4kxm.wav'))).toEqual(buf);
    expect(r.hash).toBe(sha256(buf));
  });

  it('creates directories only inside the channel', () => {
    const dir = channel();
    const store = new WriteStore(dir);
    store.ensureDir(`${V}/public`);
    expect(existsSync(path.join(dir, V, 'public'))).toBe(true);
    expect(() => store.ensureDir('../out')).toThrow(
      expect.objectContaining({ code: 'E_PATH_OUTSIDE' }),
    );
  });

  it('files without a schema are written without validation', () => {
    const dir = channel();
    const store = new WriteStore(dir);
    expect(() => store.write(`${V}/notes.md`, 'free text', { by: 't' })).not.toThrow();
  });
});
