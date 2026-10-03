// 002 · FR-004, FR-005, FR-010.
import { describe, expect, it } from 'vitest';
import { ID_PREFIXES, isId, newId, sha256 } from '../../src/index.js';

describe('ids (002 FR-004)', () => {
  it('generates <prefix>_<8 [0-9a-z]> for every prefix', () => {
    for (const p of ID_PREFIXES) expect(newId(p)).toMatch(new RegExp(`^${p}_[0-9a-z]{8}$`));
  });

  it('avoids ids already taken in scope', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = newId('ln', taken);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
  });

  it('isId checks prefix and format', () => {
    expect(isId('ln', 'ln_2r7c4kxm')).toBe(true);
    expect(isId('ln', 'bt_2r7c4kxm')).toBe(false);
    expect(isId('ln', 'ln_2R7C4KXM')).toBe(false);
    expect(isId('ln', 'ln_2r7c4kx')).toBe(false);
  });

  it('rejects unknown prefixes', () => {
    expect(() => newId('zz' as never)).toThrow();
  });
});

describe('sha256 (002 FR-010)', () => {
  it('hashes normalized text so CRLF and LF agree', () => {
    expect(sha256('a\r\nb\n')).toBe(sha256('a\nb\n'));
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes buffers as raw bytes', () => {
    expect(sha256(Buffer.from('a\r\n'))).not.toBe(sha256('a\n'));
  });
});
