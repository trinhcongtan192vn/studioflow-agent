// 013/019 — render treo (không in gì) bị dừng sau thời gian chờ để không giữ GPU mãi.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderStallMs, stallTimer } from '../../src/render/hf-render.js';

afterEach(() => {
  vi.useRealTimers();
  delete process.env.SF_RENDER_STALL_MS;
});

describe('stallTimer', () => {
  it('fires only after a full quiet period; output resets it', () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    const t = stallTimer(1000, onStall);
    vi.advanceTimersByTime(900);
    t.touch();
    vi.advanceTimersByTime(900);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onStall).toHaveBeenCalledTimes(1);
    t.stop();
  });
  it('stop prevents firing', () => {
    vi.useFakeTimers();
    const onStall = vi.fn();
    stallTimer(1000, onStall).stop();
    vi.advanceTimersByTime(5000);
    expect(onStall).not.toHaveBeenCalled();
  });
  it('defaults to 10 minutes, overridable by SF_RENDER_STALL_MS', () => {
    expect(renderStallMs()).toBe(600_000);
    process.env.SF_RENDER_STALL_MS = '2500';
    expect(renderStallMs()).toBe(2500);
  });
});
