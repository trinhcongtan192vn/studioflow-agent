// 002 · US3 AC6 · FR-009 — kiểm chéo SCRIPT/STORYBOARD/CAST trong một video.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { crossCheckVideo } from '../../src/index.js';
import { copyChannel, fixtureChannel, fixtureVideoId } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));
function edit(file: string, fn: (s: string) => string) {
  const c = copyChannel();
  cleanups.push(c.cleanup);
  const p = path.join(c.dir, 'videos', fixtureVideoId, file);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
  return c.dir;
}

describe('crossCheckVideo (002 FR-009)', () => {
  it('fixture video is consistent', () => {
    expect(crossCheckVideo(fixtureChannel, fixtureVideoId)).toEqual([]);
  });

  it('frame referencing an unknown line → E_ID_UNKNOWN', () => {
    const dir = edit('STORYBOARD.md', (s) =>
      s.replace('line_ids: [ln_5h8q2m3x]', 'line_ids: [ln_5h8q2m3x, ln_zzzzzzzz]'),
    );
    expect(crossCheckVideo(dir, fixtureVideoId)).toEqual([
      expect.objectContaining({
        code: 'E_ID_UNKNOWN',
        message: expect.stringContaining('ln_zzzzzzzz'),
      }),
    ]);
  });

  it('a line in two frames → E_ID_DUPLICATE', () => {
    const dir = edit('STORYBOARD.md', (s) =>
      s.replace('line_ids: [ln_5h8q2m3x]', 'line_ids: [ln_5h8q2m3x, ln_9w3b6tqa]'),
    );
    expect(crossCheckVideo(dir, fixtureVideoId)).toEqual([
      expect.objectContaining({
        code: 'E_ID_DUPLICATE',
        message: expect.stringContaining('ln_9w3b6tqa'),
      }),
    ]);
  });

  it('a line in no frame is reported', () => {
    const dir = edit('STORYBOARD.md', (s) => s.replace('line_ids: [ln_5h8q2m3x]', 'line_ids: []'));
    expect(crossCheckVideo(dir, fixtureVideoId)).toEqual([
      expect.objectContaining({
        code: 'E_SCHEMA_INVALID',
        message: expect.stringContaining('ln_5h8q2m3x'),
      }),
    ]);
  });

  it('duplicate ids inside the video → E_ID_DUPLICATE', () => {
    const dir = edit('SCRIPT.md', (s) => s.replace('id=ln_5h8q2m3x', 'id=ln_2r7c4kxm'));
    const errs = crossCheckVideo(dir, fixtureVideoId);
    expect(errs.some((e) => e.code === 'E_ID_DUPLICATE' && e.message.includes('ln_2r7c4kxm'))).toBe(
      true,
    );
  });

  it('speaker without cast → E_ID_UNKNOWN', () => {
    const dir = edit('SCRIPT.md', (s) => s.replace('speaker=ca_a7f2k9wd', 'speaker=ca_00000000'));
    expect(
      crossCheckVideo(dir, fixtureVideoId).some(
        (e) => e.code === 'E_ID_UNKNOWN' && e.message.includes('ca_00000000'),
      ),
    ).toBe(true);
  });

  it('unknown beat in frame → E_ID_UNKNOWN', () => {
    const dir = edit('STORYBOARD.md', (s) =>
      s.replace('beat_ids: [bt_7c1v5p0e]', 'beat_ids: [bt_00000000]'),
    );
    expect(crossCheckVideo(dir, fixtureVideoId).some((e) => e.code === 'E_ID_UNKNOWN')).toBe(true);
  });
});
