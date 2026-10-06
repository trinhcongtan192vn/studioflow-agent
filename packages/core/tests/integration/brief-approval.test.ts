// 040 — agent ghi đề xuất workflow thẳng vào BRIEF.md (không gọi workflow.select) → app vẫn tạo điểm
// duyệt brief để thẻ Duyệt hiện trong chat.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture;
afterEach(() => fx?.cleanup());

it('a brief proposing a workflow gets a pending brief approval exactly once', async () => {
  fx = workflowFixture();
  const e = fx.core.workflows.engine(fx.dir, fx.videoId);
  const p = path.join(fx.dir, fx.v('BRIEF.md'));
  // chưa đề xuất → không tạo
  expect(await e.ensureBriefApproval()).toBe(false);
  writeFileSync(
    p,
    readFileSync(p, 'utf8')
      .replace(/proposed_workflow: .*/, 'proposed_workflow: { id: demo-explainer, version: 1.0.0 }')
      .replace(/proposed_output_profile: .*/, 'proposed_output_profile: yt-1080p30'),
  );
  expect(await e.ensureBriefApproval()).toBe(true);
  expect(await e.ensureBriefApproval()).toBe(false); // không tạo trùng
  const pending = e.summary().pending_approvals;
  expect(pending).toHaveLength(1);
  // duyệt → workflow chạy như sau workflow.select
  await e.approve(pending[0]!);
  expect(e.summary().phase).toBe('workflow');
  expect(await e.ensureBriefApproval()).toBe(false);
});

it('an unknown workflow or disallowed profile does not create an approval', async () => {
  fx = workflowFixture();
  const e = fx.core.workflows.engine(fx.dir, fx.videoId);
  const p = path.join(fx.dir, fx.v('BRIEF.md'));
  writeFileSync(
    p,
    readFileSync(p, 'utf8')
      .replace(/proposed_workflow: .*/, 'proposed_workflow: { id: no-such-wf, version: 1.0.0 }')
      .replace(/proposed_output_profile: .*/, 'proposed_output_profile: yt-1080p30'),
  );
  expect(await e.ensureBriefApproval()).toBe(false);
});
