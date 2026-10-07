// 062 — video làm trước khi gộp look/effects/overlays thành `finish`: mở lại → `finish` lấy trạng thái từ
// các bước cũ (không chạy thêm một phiên agent nếu chúng đã xong/bỏ qua).
import { describe, expect, it } from 'vitest';
import { migrateMergedSteps } from '../../src/workflow/engine.js';

describe('migrateMergedSteps', () => {
  const ids = ['frames', 'finish', 'captions'];
  it('finish = done when the old steps are done or skipped', () => {
    const steps = {
      look: { status: 'skipped' as const, attempt: 0 },
      effects: { status: 'done' as const, attempt: 1 },
      overlays: { status: 'done' as const, attempt: 1, finished_at: '2026-10-06T10:00:00Z' },
    };
    expect(migrateMergedSteps(ids, steps)).toBe(true);
    expect(steps).toMatchObject({ finish: { status: 'done', attempt: 1 } });
  });
  it('finish = pending when an old step was not finished; untouched when finish exists or no old steps', () => {
    const half = {
      effects: { status: 'done' as const, attempt: 1 },
      overlays: { status: 'pending' as const, attempt: 0 },
    };
    expect(migrateMergedSteps(ids, half)).toBe(true);
    expect(half).toMatchObject({ finish: { status: 'pending' } });
    const has = {
      finish: { status: 'stale' as const, attempt: 1 },
      effects: { status: 'done' as const, attempt: 1 },
    };
    expect(migrateMergedSteps(ids, has)).toBe(false);
    expect(migrateMergedSteps(ids, {})).toBe(false);
    expect(
      migrateMergedSteps(['frames'], { effects: { status: 'done' as const, attempt: 1 } }),
    ).toBe(false);
  });
});
