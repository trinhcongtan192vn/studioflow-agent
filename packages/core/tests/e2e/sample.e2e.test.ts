// 001 · FR-012 — chỗ cho e2e; dự án mẫu thật thuộc tính năng workflow (NFR-09).
import { describe, expect, it } from 'vitest';
import { runSf } from '../helpers.js';

describe('e2e placeholder (001 FR-012)', () => {
  it('sf is invocable end-to-end', () => {
    expect(runSf(['--version']).code).toBe(0);
  });
});
