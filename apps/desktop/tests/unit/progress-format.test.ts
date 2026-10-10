// 008 · FR-CH-03 (UI-04) — tab Tiến độ: trạng thái tổng, phản hồi sau thao tác, nút theo ngữ cảnh.
import { describe, expect, it } from 'vitest';
import {
  feedbackFor,
  overall,
  progressLabel,
  shownStatus,
  STATUS_LABEL,
  stepButtons,
  stepProgressView,
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
    expect(stepButtons(st[2]!, st).map((b) => b.action.kind)).toEqual([
      'recheck',
      'run_step',
      'rewind',
    ]);
    expect(stepButtons(st[0]!, st)[0]!.confirm).toContain('1 bước đã xong phía sau');
    expect(stepButtons({ id: 'r', title: 'R', status: 'running' }, st)).toEqual([]);
  });
  it('a mixed failure keeps "Kiểm tra lại" primary but still offers the skip (046)', () => {
    const st = S('done', 'failed');
    const b = stepButtons(
      st[1]!,
      st,
      'graph_fresh(*): index: stale; objective(audio_duration): 294 s vs target 360 s (±10%)',
    );
    expect(b.map((x) => [x.action.kind, Boolean(x.primary)])).toEqual([
      ['waive', false],
      ['recheck', true],
      ['run_step', false],
      ['rewind', false],
    ]);
  });

  it('misread lines put "Chấp nhận N dòng đọc sai" first (061)', () => {
    const st = S('done', 'failed');
    const b = stepButtons(
      st[1]!,
      st,
      'objective(asr_clean): 1 line(s) misread: ln_h4k2w9ab (22%) — listen',
    );
    expect(b[0]).toMatchObject({
      action: { kind: 'asr_accept', step: st[1]!.id, line_ids: ['ln_h4k2w9ab'] },
      label: 'Chấp nhận 1 dòng đọc sai',
      primary: true,
    });
  });

  it('a duration warning puts "Bỏ qua cảnh báo" first (043)', () => {
    const st = S('done', 'failed');
    const b = stepButtons(st[1]!, st, 'objective(audio_duration): 294 s vs target 360 s (±10%)');
    expect(b.map((x) => x.action.kind)).toEqual(['waive', 'recheck', 'run_step', 'rewind']);
    expect(b[0]).toMatchObject({ label: 'Bỏ qua cảnh báo', primary: true });
    expect(b[1]!.primary).toBe(false);
    expect(
      feedbackFor({ kind: 'waive', step: st[1]!.id, check: 'audio_duration' }, S('done', 'done'))
        .text,
    ).toMatch(/^Đã bỏ qua cảnh báo ở bước/);
  });
});

describe('step progress bar (008 UI-04)', () => {
  const now = Date.parse('2026-10-06T00:02:05Z');
  it('refine phases show a determinate bar with the phase text and elapsed time', () => {
    expect(
      stepProgressView({
        progress: { done: 3, total: 6, message: 'Vòng 2/3: đang chấm điểm (vòng trước 6.4/10)' },
        startedAt: '2026-10-06T00:00:00Z',
        now,
      }),
    ).toEqual({ pct: 50, text: 'Vòng 2/3: đang chấm điểm (vòng trước 6.4/10)', elapsed: '2:05' });
  });
  it('graph node keys become Vietnamese labels with counts', () => {
    expect(
      stepProgressView({ progress: { done: 4, total: 38, message: 'audio.line:ln_x' }, now }),
    ).toMatchObject({ pct: 11, text: 'Sinh giọng từng câu (4/38)' });
    expect(progressLabel('frame_html:fr_1')).toBe('Dựng frame');
  });
  it('agent steps without numbers are indeterminate and show the latest agent action', () => {
    expect(stepProgressView({ activity: 'Sinh ảnh: chân dung Tí', now })).toEqual({
      pct: null,
      text: 'Sinh ảnh: chân dung Tí',
    });
  });
});

describe('job progress text', () => {
  it('adds counts to a plain job label', () => {
    expect(
      stepProgressView({ progress: { done: 4, total: 15, message: 'Sinh ảnh' }, now: 0 }).text,
    ).toBe('Sinh ảnh (4/15)');
    expect(
      stepProgressView({ progress: { done: 2, total: 5, message: 'Dựng frame 2/5' }, now: 0 }).text,
    ).toBe('Dựng frame 2/5');
  });
});

describe('recheck (036)', () => {
  it('failed steps offer Kiểm tra lại first; Chạy lại asks to confirm overwriting', () => {
    const st = S('done', 'failed');
    const b = stepButtons(st[1]!, st);
    expect(b.map((x) => x.action.kind)).toEqual(['recheck', 'run_step', 'rewind']);
    expect(b[0]).toMatchObject({ primary: true, label: 'Kiểm tra lại' });
    expect(b[1]!.confirm).toContain('viết lại');
  });
  it('tracks the step after a passing recheck', () => {
    expect(
      feedbackFor({ kind: 'recheck', step: 's1' }, S('done', 'waiting_approval')),
    ).toMatchObject({
      tone: 'info',
      text: expect.stringMatching(/^Kiểm tra lại bước "Bước 1": đạt\. Dừng ở bước/),
    });
  });
});

describe('nothing to recheck (065 FR-UI-65-02)', () => {
  it('a provider error or a missing output makes Chạy lại primary without the overwrite prompt', () => {
    const st = S('done', 'failed');
    for (const err of ['claude: error_max_turns', 'artifact_valid(SCRIPT.md): SCRIPT.md missing']) {
      const b = stepButtons(st[1]!, st, err);
      expect(b.map((x) => x.action.kind)).toEqual(['run_step', 'rewind']);
      expect(b[0]).toMatchObject({ primary: true });
      expect(b[0]!.confirm).toBeUndefined();
    }
  });
});

it('a step waiting for the user shows "Chờ bạn" and makes the workflow waiting, not failed', () => {
  const steps = [
    { id: 'render', title: 'Render', status: 'done' },
    { id: 'publish', title: 'Đăng', status: 'failed', waiting_user: true },
  ];
  expect(overall(steps).state).toMatchObject({ kind: 'waiting', step: { id: 'publish' } });
  expect(STATUS_LABEL[shownStatus(steps[1]!)]).toBe('Chờ bạn');
});
