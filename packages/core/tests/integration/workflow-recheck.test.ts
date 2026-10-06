// 036 — bước lỗi đã được sửa tay: "Kiểm tra lại" chạy lại gate trên file hiện có (không sinh lại);
// "chạy tới" khi có bước lỗi phía trước báo lỗi rõ thay vì lặng lẽ không làm gì.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { wireDemo, workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture;
afterEach(() => fx?.cleanup());
const status = (f: WorkflowFixture) =>
  Object.fromEntries(
    f.core.workflows
      .engine(f.dir, f.videoId)
      .summary()
      .steps.map((s) => [s.id, s.status]),
  );

it('recheck accepts a hand-fixed artifact without regenerating it; run_to past a failed step errors', async () => {
  fx = workflowFixture();
  const { notes } = wireDemo(fx, { badScript: true });
  const e = fx.core.workflows.engine(fx.dir, fx.videoId);
  await e.select('demo-explainer', 'yt-1080p30');
  await e.approve(e.summary().pending_approvals[0]!);
  await e.advance();
  expect(status(fx).script).toBe('failed');
  const calls = notes.length;
  // chạy tới bước sau khi script đang lỗi → lỗi rõ ràng
  let err: unknown;
  try {
    await e.runTo('storyboard');
  } catch (x) {
    err = x;
  }
  expect(err).toMatchObject({ code: 'E_STEP_ORDER' });
  // còn lỗi → kiểm tra lại vẫn lỗi, không sinh lại
  await expect(e.recheck('script')).resolves.toMatchObject({ pass: false });
  expect(status(fx).script).toBe('failed');
  // người dùng/agent sửa tay → kiểm tra lại qua → tới điểm duyệt, nội dung giữ nguyên
  fx.store.write(fx.v('SCRIPT.md'), fx.sample('SCRIPT.md'), { by: 'test' });
  const fixed = readFileSync(path.join(fx.dir, fx.v('SCRIPT.md')), 'utf8');
  await expect(e.recheck('script')).resolves.toMatchObject({ pass: true });
  expect(status(fx).script).toBe('waiting_approval');
  expect(readFileSync(path.join(fx.dir, fx.v('SCRIPT.md')), 'utf8')).toBe(fixed);
  expect(notes.length).toBe(calls); // executor không chạy lại
  // gateway tool cho agent
  const r = (await fx.core.gateway.call(fx.session, 'workflow.recheck', {
    step_id: 'storyboard',
  })) as {
    ok: boolean;
    error?: { code: string };
  };
  expect(r).toMatchObject({ ok: false, error: { code: 'E_STEP_ORDER' } });
});

it('a step interrupted with its outputs on disk becomes failed (recheck or run again), not silently pending', async () => {
  fx = workflowFixture();
  wireDemo(fx);
  const e = fx.core.workflows.engine(fx.dir, fx.videoId);
  await e.select('demo-explainer', 'yt-1080p30');
  await e.approve(e.summary().pending_approvals[0]!);
  await e.advance(); // script → waiting_approval (SCRIPT.md có)
  // giả lập app tắt giữa bước script: state ghi running
  const p = path.join(fx.dir, fx.v('state.json'));
  const st = JSON.parse(readFileSync(p, 'utf8'));
  st.steps.script.status = 'running';
  st.approvals = st.approvals.filter((a: { step_id: string }) => a.step_id !== 'script');
  writeFileSync(p, JSON.stringify(st, null, 2));
  const fresh = fx.core.workflows.engine(fx.dir, fx.videoId);
  fresh.open();
  const s = JSON.parse(readFileSync(p, 'utf8')).steps.script;
  expect(s).toMatchObject({ status: 'failed', error: { code: 'E_STEP_INCOMPLETE' } });
  await expect(fresh.recheck('script')).resolves.toMatchObject({ pass: true });
  expect(status(fx).script).toBe('waiting_approval');
});

it('running a failed step again actually re-runs it (run_step on the failed target)', async () => {
  fx = workflowFixture();
  const { notes } = wireDemo(fx, { badScript: true });
  const e = fx.core.workflows.engine(fx.dir, fx.videoId);
  await e.select('demo-explainer', 'yt-1080p30');
  await e.approve(e.summary().pending_approvals[0]!);
  await e.advance();
  expect(status(fx).script).toBe('failed');
  const before = notes.length;
  await e.runTo('script');
  expect(notes.length).toBe(before + 1);
});
