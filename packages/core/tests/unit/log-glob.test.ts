// 003 · FR-021, FR-015 — che khóa trong log; glob.
import { describe, expect, it } from 'vitest';
import { globToRegExp, maskSecrets } from '../../src/index.js';

describe('maskSecrets (003 FR-021, D5 5.4)', () => {
  it.each([
    ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'],
    ['sk-proj-abcdefghijklmnopqrstuvwxyz012345'],
    ['sk-abcdefghijklmnopqrstuvwx'],
    ['Bearer abcdefghijklmnop1234567890'],
    ['AIzaSyA1234567890abcdefghijklmnopqrstu'],
  ])('masks %s', (secret) => {
    const out = maskSecrets(`key=${secret} done`);
    expect(out).not.toContain(secret.slice(-12));
    expect(out).toContain('done');
  });

  it('leaves ordinary text alone', () => {
    expect(maskSecrets('sk-1 is not a key; skip-this')).toBe('sk-1 is not a key; skip-this');
  });
});

describe('globToRegExp (003 FR-015)', () => {
  it.each([
    ['*.md', 'SCRIPT.md', true],
    ['*.md', 'a/SCRIPT.md', false],
    ['**/*.json', 'reviews/script/round-1.json', true],
    ['**/*.json', 'state.json', true],
    ['audio/lines/*.wav', 'audio/lines/ln_1.wav', true],
    ['?.md', 'a.md', true],
    ['compositions/**', 'compositions/frames/x.html', true],
    ['*.md', 'a.mdx', false],
  ])('%s vs %s → %s', (glob, p, ok) => {
    expect(globToRegExp(glob).test(p)).toBe(ok);
  });
});
