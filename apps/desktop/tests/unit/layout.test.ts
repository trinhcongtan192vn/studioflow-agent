// 008 · FR-WS-02 — kéo đổi độ rộng sidebar, chat, tab phải.
import { describe, expect, it } from 'vitest';
import { clampWidths, DEFAULT_WIDTHS, dragWidths } from '../../src/renderer/layout';

describe('panel widths', () => {
  it('drags the left splitter within limits', () => {
    expect(dragWidths(DEFAULT_WIDTHS, 'left', 40, 1600)).toEqual({ left: 300, right: 420 });
    expect(dragWidths(DEFAULT_WIDTHS, 'left', -500, 1600).left).toBe(180);
    expect(dragWidths(DEFAULT_WIDTHS, 'left', 900, 1600).left).toBe(520);
  });
  it('dragging the right splitter left widens the right panel', () => {
    expect(dragWidths(DEFAULT_WIDTHS, 'right', -100, 1600)).toEqual({ left: 260, right: 520 });
    expect(dragWidths(DEFAULT_WIDTHS, 'right', 400, 1600).right).toBe(300);
  });
  it('always leaves room for the chat', () => {
    const w = clampWidths({ left: 260, right: 2000 }, 1400);
    expect(1400 - w.left - w.right - 12).toBeGreaterThanOrEqual(360);
  });
});
