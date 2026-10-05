// 008 · FR-CH-03 (UI-04) — tab Tiến độ: trạng thái tổng, phản hồi sau thao tác, nút theo ngữ cảnh.
import { describe, expect, it } from 'vitest';
import {
  feedbackFor,
  overall,
  stepButtons,
  type StepView,
} from '../../src/renderer/progress-format';

const S = (...st: string[]): StepView[] =>
  st.map((status, i) => ({ id: `s${i}`, title: `Bước ${i}`, status }));

describe('overall', () => {
  it('counts done/skipped and picks running > failed > waiting > next', () => {
    expect(overall(S('done', 'skipped', 'running', 'pending'))).toMatchObject({
      done: 2,
      total: 4,
      state: { kind: 'running', step: { id: 's2' } },
    });
    expect(overall(S('done', 'failed', 'pending')).state).toMatchObject({ kind: 'failed' });
    expect(overall(S('done', 'waiting_approval')).state).toMatchObject({ kind: 'waiting' });
    expect(overall(S('done', 'stale')).state).toMatchObject({ kind: 'idle', next: { id: 's1' } });
    expect(overall(S('done', 'done')).state).toEqual({ kind: 'done' });
  });
});

describe('feedbackFor', () => {
  const runTo = { kind: 'run_to', step: 's3' } as const;
  it('tracks a run_to until the target is done', () => {
    expect(feedbackFor(runTo, S('done', 'pending', 'pending', 'pending'))).toMatchObject({
      tone: 'progress',
      settled: false,
      text: expect.stringContaining('đang bắt đầu'),
    });
    expect(feedbackFor(runTo, S('done', 'running', 'pending', 'pending')).text).toBe(
      'Đang chạy bước "Bước 1" (2/4) — đích: "Bước 3"…',
    );
    expect(feedbackFor(runTo, S('done', 'done', 'done', 'done'))).toMatchObject({
      tone: 'success',
      settled: true,
    });
  });
  it('reports an approval stop or an error with its message', () => {
    expect(feedbackFor(runTo, S('done', 'waiting_approval', 'pending', 'pending'))).toMatchObject({
      tone: 'info',
      text: expect.stringContaining('chờ bạn duyệt'),
    });
    expect(
      feedbackFor(runTo, S('done', 'failed', 'pending', 'pending'), () => 'thiếu giọng'),
    ).toEqual({ tone: 'error', text: 'Lỗi ở bước "Bước 1": thiếu giọng.', settled: true });
  });
  it('rewind tracks the re-run; pause settles at once', () => {
    const rw = { kind: 'rewind', step: 's1' } as const;
    expect(feedbackFor(rw, S('done', 'pending'))).toMatchObject({
      tone: 'progress',
      text: 'Đã quay lại bước "Bước 1", đang chạy lại…',
    });
    expect(feedbackFor(rw, S('done', 'waiting_approval'))).toMatchObject({
      tone: 'info',
      settled: true,
      text: expect.stringMatching(/^Đã quay lại bước "Bước 1". Dừng ở bước/),
    });
    expect(feedbackFor(rw, S('done', 'done')).text).toBe(
      'Đã quay lại và chạy lại xong bước "Bước 1".',
    );
    expect(feedbackFor({ kind: 'pause' }, S('running')).text).toContain('Sẽ tạm dừng');
  });
});

describe('stepButtons', () => {
  it('offers context actions; rewind asks to confirm with the number of later steps', () => {
    const st = S('done', 'done', 'failed', 'stale', 'pending');
    expect(stepButtons(st[4]!, st).map((b) => b.label)).toEqual(['Chạy tới đây']);
    expect(stepButtons(st[3]!, st)[0]).toMatchObject({ primary: true });
    expect(stepButtons(st[2]!, st).map((b) => b.action.kind)).toEqual(['run_step', 'rewind']);
    expect(stepButtons(st[0]!, st)[0]!.confirm).toContain('1 bước đã xong phía sau');
    expect(stepButtons({ id: 'r', title: 'R', status: 'running' }, st)).toEqual([]);
  });
});
