// 043 — kiểm "mềm" (audio_duration) trượt chỉ là cảnh báo: người dùng bấm "Bỏ qua cảnh báo" → bước
// kiểm lại với kiểm đó được miễn, không sinh lại; chạy lại bước thì miễn trừ mất.
import { afterEach, expect, it } from 'vitest';
import { registerObjective } from '../../src/workflow/gates.js';
import { wireDemo, workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture;
afterEach(() => fx?.cleanup());

it('a failed audio_duration check is a warning the user can waive; hard failures cannot be waived', async () => {
  registerObjective('audio_duration', () => ({
    pass: false,
    detail: '294 s vs target 360 s (±10%)',
  }));
  fx = workflowFixture();
  const { notes } = wireDemo(fx);
  const e = fx.core.workflows.engine(fx.dir, fx.videoId);
  await e.select('duration-demo', 'yt-1080p30');
  await e.approve(e.summary().pending_approvals[0]!);
  await e.advance();
  const st = () => e.readState().steps.script!;
  expect(st()).toMatchObject({ status: 'failed', error: { code: 'E_GATE_WARNING' } });
  // chỉ kiểm mềm mới được miễn
  await expect(e.waive('script', 'artifact_valid')).rejects.toMatchObject({
    code: 'E_SCHEMA_INVALID',
  });
  const calls = notes.length;
  const r = await e.waive('script', 'audio_duration');
  expect(r.pass).toBe(true);
  expect(r.results.find((x) => x.target === 'audio_duration')).toMatchObject({
    pass: true,
    waived: true,
  });
  expect(st()).toMatchObject({ status: 'done', waived: ['audio_duration'] });
  expect(notes.length).toBe(calls); // không sinh lại
  // 046: đã chấp nhận thời lượng ở bước trước → bước sau cùng kiểm (finalize) không hỏi lại
  await e.idle();
  expect(e.readState().steps.storyboard).toMatchObject({ status: 'done' });
  // chạy lại bước → miễn trừ mất, cảnh báo quay lại
  await e.rewind('script');
  await e.idle();
  expect(st().status).toBe('failed');
  expect(st().waived).toBeUndefined();
});
