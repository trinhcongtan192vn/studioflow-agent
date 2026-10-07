// 045 — đóng app khi còn việc chạy dở: liệt kê để người dùng xác nhận.
import { describe, expect, it } from 'vitest';
import { activityLines } from '../../src/renderer/close-format';

describe('activityLines', () => {
  it('is empty when nothing runs (close right away)', () => {
    expect(activityLines({ studio: [], steps: [], jobs: [], chats: [] })).toEqual([]);
  });
  it('names Studio sessions, running steps, background jobs and a replying agent', () => {
    const l = activityLines({
      studio: [{ channel: 'C:/k', video: 'vd_1' }],
      steps: [{ channel: 'C:/k', video: 'vd_1', step_id: 'frames', title: 'Dựng shot' }],
      jobs: [{ kind: 'render.video' }, { kind: 'render.video' }, { kind: 'tts.synthesize' }],
      chats: [{ channel: 'C:/k', video: 'vd_1' }],
    });
    expect(l).toHaveLength(4);
    expect(l[0]).toMatch(/^Studio đang mở/);
    expect(l[1]).toBe('Bước "Dựng shot" đang chạy (vd_1) — sẽ dừng giữa chừng.');
    expect(l[2]).toBe('3 việc nền đang chạy (render.video, tts.synthesize).');
    expect(l[3]).toBe('Agent đang trả lời trong khung chat.');
  });
});
