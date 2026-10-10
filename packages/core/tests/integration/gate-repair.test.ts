// Tự sửa khi gate khách quan trượt: engine gọi hàm sửa đã đăng ký đúng một lần rồi kiểm lại; sửa được → bước
// qua (không chạy lại executor/agent); không sửa được → bước lỗi với chi tiết gốc.
import { afterEach, expect, it } from 'vitest';
import { registerGateRepair, registerObjective } from '../../src/workflow/gates.js';
import { wireDemo, workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture;
afterEach(() => fx?.cleanup());

it('a failed objective with a registered repair is fixed in place and re-checked once', async () => {
  let fixed = false;
  let repairs = 0;
  registerObjective('audio_duration', () =>
    fixed ? { pass: true } : { pass: false, detail: 'text outside safe area' },
  );
  registerGateRepair('audio_duration', async () => {
    repairs++;
    fixed = true;
    return 'shrank 1 text';
  });
  fx = workflowFixture();
  const { notes } = wireDemo(fx);
  const e = fx.core.workflows.engine(fx.dir, fx.videoId);
  await e.select('duration-demo', 'yt-1080p30');
  await e.approve(e.summary().pending_approvals[0]!);
  await e.advance();
  const calls = notes.length;
  expect(e.readState().steps.script!.status).not.toBe('failed');
  expect(repairs).toBe(1);
  expect(notes.length).toBe(calls);
});

it('a repair that changes nothing leaves the step failed with the original detail', async () => {
  let repairs = 0;
  registerObjective('audio_duration', () => ({ pass: false, detail: 'still outside' }));
  registerGateRepair('audio_duration', async () => {
    repairs++;
    return undefined;
  });
  fx = workflowFixture();
  wireDemo(fx);
  const e = fx.core.workflows.engine(fx.dir, fx.videoId);
  await e.select('duration-demo', 'yt-1080p30');
  await e.approve(e.summary().pending_approvals[0]!);
  await e.advance();
  expect(e.readState().steps.script).toMatchObject({
    status: 'failed',
    error: { message: expect.stringContaining('still outside') },
  });
  expect(repairs).toBe(1);
});
