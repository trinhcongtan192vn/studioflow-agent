// 001 · US3 AC2 — nhãn phiên bản hiển thị giá trị từ core.
import { describe, expect, it } from 'vitest';
import { versionLabel } from '../../src/renderer/version-label';

describe('versionLabel (001 US3 AC2)', () => {
  it('formats the core version', () => {
    expect(versionLabel({ version: '1.2.3' })).toBe('core 1.2.3');
  });
});
