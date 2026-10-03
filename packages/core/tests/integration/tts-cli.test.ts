// 006 · US6 · FR-009 — sf video create, sf tts say (cache lần 2), sf voice create.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runSf } from '../helpers.js';
import { writeWav } from '../worker-helpers.js';
import { copyChannel, tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));
function env() {
  const c = copyChannel();
  const t = tempDir('app-');
  cleanups.push(c.cleanup, t.cleanup);
  return { dir: c.dir, env: { SF_GPU: '0', SF_APP_DATA: t.dir }, tmp: t.dir };
}

describe('CLI (006 US6)', () => {
  it('sf video create', () => {
    const { dir, env: e } = env();
    const r = runSf(['video', 'create', dir, '--title', 'Thử'], { env: e });
    expect(r.stderr).toBe('');
    const { video_id } = JSON.parse(r.stdout) as { video_id: string };
    expect(
      JSON.parse(readFileSync(path.join(dir, 'videos', video_id, 'state.json'), 'utf8')).phase,
    ).toBe('briefing');
  });

  it('sf tts say: second identical call comes from the cache (AC-M0-02)', () => {
    const { dir, env: e } = env();
    const args = [
      'tts',
      'say',
      '--channel',
      dir,
      '--voice',
      'vo_c3z8p1mn',
      '--text',
      'Xin chào các bạn',
    ];
    const a = JSON.parse(runSf(args, { env: e }).stdout);
    expect(a).toMatchObject({
      from_cache: false,
      duration_ms: expect.any(Number),
      file: expect.stringMatching(/\.wav$/),
    });
    expect(existsSync(path.join(dir, a.file))).toBe(true);
    const b = JSON.parse(runSf(args, { env: e }).stdout);
    expect(b).toMatchObject({ from_cache: true, file: a.file });
  });

  it('sf voice create from a reference file', () => {
    const { dir, env: e, tmp } = env();
    const ref = path.join(tmp, 'mẫu giọng.wav');
    writeWav(ref, 4000);
    const r = runSf(
      ['voice', 'create', '--channel', dir, '--name', 'Nam', '--ref', ref, '--language', 'vi'],
      { env: e },
    );
    expect(r.stderr).toBe('');
    const { voice_id } = JSON.parse(r.stdout);
    expect(existsSync(path.join(dir, 'voices', voice_id, 'voice.pt'))).toBe(true);
  });
});
