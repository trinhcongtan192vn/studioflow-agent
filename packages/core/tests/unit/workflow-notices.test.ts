// 041 — thông báo workflow trong chat: bắt đầu / xong → tiếp theo / cần duyệt / lỗi / render xong.
import { describe, expect, it } from 'vitest';
import { noticeText, workflowNotices } from '../../src/workflow/notices.js';

const steps = (...st: [string, string][]) =>
  st.map(([id, status]) => ({ id, title: id.toUpperCase(), status }));

describe('workflowNotices', () => {
  it('first snapshot says nothing', () => {
    expect(workflowNotices({}, steps(['a', 'running']), {})).toEqual([]);
  });
  it('merges "done X" with "started Y" and flags auto-approval', () => {
    const r = workflowNotices(
      { a: 'running', b: 'pending' },
      steps(['a', 'done'], ['b', 'running']),
      {
        steps: { a: { outputs: ['STORYBOARD.md'] } },
        approvals: [
          { id: 'ap_1', step_id: 'a', status: 'approved', note: 'Tự duyệt (chế độ tự động) — x' },
        ],
      },
    );
    expect(r).toEqual([
      {
        event: 'done',
        step_id: 'a',
        step_title: 'A',
        position: [1, 2],
        auto_approved: true,
        outputs: ['STORYBOARD.md'],
        next: { id: 'b', title: 'B' },
      },
    ]);
  });
  it('waiting carries the pending approval; failed carries the error; started alone is reported', () => {
    expect(
      workflowNotices({ a: 'running' }, steps(['a', 'waiting_approval']), {
        approvals: [{ id: 'ap_2', step_id: 'a', status: 'pending' }],
      })[0],
    ).toMatchObject({ event: 'waiting', approval_id: 'ap_2' });
    expect(
      workflowNotices({ a: 'running' }, steps(['a', 'failed']), {
        steps: { a: { error: { message: 'boom' } } },
      })[0],
    ).toMatchObject({ event: 'failed', error: 'boom' });
    expect(workflowNotices({ a: 'pending' }, steps(['a', 'running']), {})[0]).toMatchObject({
      event: 'started',
      position: [1, 1],
    });
  });
  it('the last step done also says the video is finished', () => {
    const r = workflowNotices({ a: 'done', r: 'running' }, steps(['a', 'done'], ['r', 'done']), {
      steps: { r: { outputs: ['renders/rd_1/video.mp4'] } },
    });
    expect(r.map((x) => x.event)).toEqual(['done', 'finished']);
    expect(r[1]).toMatchObject({ outputs: ['renders/rd_1/video.mp4'] });
  });
});

describe('noticeText (083)', () => {
  it('a step waiting for the user reads as a question, not an error', () => {
    const base = {
      step_id: 'voice',
      step_title: 'Giọng đọc',
      position: [4, 12] as [number, number],
    };
    expect(
      noticeText({
        event: 'failed',
        ...base,
        error: 'agent stopped without completing step voice — waiting for your reply in chat',
      }),
    ).toMatch(/^💬 Bước \*\*Giọng đọc\*\* \(4\/12\) đang chờ bạn trả lời/);
    expect(noticeText({ event: 'failed', ...base, error: 'boom' })).toMatch(/^✕/);
  });
});
