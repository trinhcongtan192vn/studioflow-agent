// 001 · FR-011, FR-016 — API công khai của core; phiên bản khớp package.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getVersion } from '../../src/index.js';
import { coreDir } from '../helpers.js';

describe('getVersion (001 FR-011)', () => {
  it('returns the core package version', () => {
    const pkg = JSON.parse(readFileSync(path.join(coreDir, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(getVersion()).toEqual({ name: 'studioflow', version: pkg.version });
  });
});
