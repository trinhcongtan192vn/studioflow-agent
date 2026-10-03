// 001 · FR-007 — đường dẫn có khoảng trắng và Unicode.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSf } from '../helpers.js';

describe('paths with spaces/Unicode (001 FR-007)', () => {
  it('sf runs from a cwd with spaces and diacritics', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'thư mục có dấu '));
    try {
      const r = runSf(['diag', 'echo', '--message', 'ok'], { cwd: dir });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).echo).toEqual(['ok']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
