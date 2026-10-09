// 007 · US1–US3 · FR-001..008 (FR-WF-01..04).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wireDemo, workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';
import { AWAITING_REPLY } from '../../src/workflow/engine.js';

let fx: WorkflowFixture;
afterEach(() => fx?.cleanup());

const stepStatus = (fx: WorkflowFixture) =>
  Object.fromEntries(
    fx.core.workflows
      .engine(fx.dir, fx.videoId)
      .summary()
      .steps.map((s) => [s.id, s.status]),
  );
const pending = (fx: WorkflowFixture) =>
  fx.core.workflows.engine(fx.dir, fx.videoId).summary().pending_approvals;
const state = (fx: WorkflowFixture) =>
  JSON.parse(readFileSync(path.join(fx.dir, fx.v('state.json')), 'utf8'));

async function startWorkflow(f: WorkflowFixture) {
  const e = f.core.workflows.engine(f.dir, f.videoId);
  await e.select('demo-explainer', 'yt-1080p30');
  await e.approve(pending(f)[0]!);
  return e;
}

describe('briefing (007 US1, FR-WF-01)', () => {
  it('lists compatible workflows only', async () => {
    fx = workflowFixture();
    const r = await fx.core.gateway.call(fx.session, 'workflow.list', {});
    const ids = (r as { data: { workflows: { id: string }[] } }).data.workflows.map((w) => w.id);
    expect(ids).toEqual(['demo-explainer', 'duration-demo', 'publish-demo', 'refine-demo']); // bad-order bị loại (E_STEP_ORDER)
  });

  it('select proposes in BRIEF.md and creates the brief approval; approving starts the workflow', async () => {
    fx = workflowFixture();
    const sel = await fx.core.gateway.call(fx.session, 'workflow.select', {
      workflow_id: 'demo-explainer',
      output_profile: 'yt-1080p30',
    });
    expect(sel.ok).toBe(true);
    const brief = readFileSync(path.join(fx.dir, fx.v('BRIEF.md')), 'utf8');
    expect(brief).toContain('proposed_output_profile: yt-1080p30');
    expect(brief).toMatch(/proposed_workflow:[\s\S]*id: demo-explainer/);
    const e = fx.core.workflows.engine(fx.dir, fx.videoId);
    const s = e.summary();
    expect(s).toMatchObject({
      phase: 'briefing',
      workflow: null,
      pending_approvals: [expect.stringMatching(/^ap_/)],
    });
    await e.approve(s.pending_approvals[0]!);
    const st = state(fx);
    expect(st).toMatchObject({
      phase: 'workflow',
      workflow: { id: 'demo-explainer', version: '1.0.0' },
      output_profile: 'yt-1080p30',
    });
    expect(Object.keys(st.steps)).toEqual(['script', 'storyboard', 'look', 'voice', 'finalize']);
    expect(readFileSync(path.join(fx.dir, fx.v('BRIEF.md')), 'utf8')).toMatch(/approved_at: .+T/);
    expect(
      await fx.core.gateway.call(fx.session, 'workflow.select', {
        workflow_id: 'demo-explainer',
        output_profile: 'yt-1080p30',
      }),
    ).toMatchObject({ ok: false });
  });

  it('rejects an output profile the workflow does not allow', async () => {
    fx = workflowFixture();
    expect(
      await fx.core.gateway.call(fx.session, 'workflow.select', {
        workflow_id: 'demo-explainer',
        output_profile: 'tiktok',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'E_WORKFLOW_INCOMPATIBLE' },
    });
  });
});

describe('steps, gates, approvals (007 US2, FR-WF-03/04)', () => {
  it('runs end to end with approvals, skip_if and the voice executor', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    const e = await startWorkflow(fx);
    await e.advance();
    expect(stepStatus(fx)).toMatchObject({ script: 'waiting_approval', storyboard: 'pending' });
    const ap = state(fx).approvals.find((a: { step_id: string }) => a.step_id === 'script');
    expect(Object.keys(ap.artifact_hashes)).toEqual(['SCRIPT.md']);
    await e.approve(ap.id);
    expect(stepStatus(fx)).toMatchObject({ script: 'done', storyboard: 'waiting_approval' });
    await e.approve(pending(fx)[0]!);
    expect(stepStatus(fx)).toEqual({
      script: 'done',
      storyboard: 'done',
      look: 'skipped',
      voice: 'done',
      finalize: 'waiting_approval',
    });
    await e.approve(pending(fx)[0]!);
    expect(Object.values(stepStatus(fx)).every((s) => s === 'done' || s === 'skipped')).toBe(true);
    expect(e.summary().current_step).toBeUndefined();
  });

  it('a failing gate fails the step with E_GATE_FAILED and per-gate results', async () => {
    fx = workflowFixture();
    wireDemo(fx, { badScript: true });
    const e = await startWorkflow(fx);
    await e.advance();
    const st = state(fx).steps.script;
    expect(st).toMatchObject({ status: 'failed', error: { code: 'E_GATE_FAILED' } });
    expect((await e.gateCheck('script')).pass).toBe(false);
  });

  it('changes_requested reruns the step with the note as input', async () => {
    fx = workflowFixture();
    const { notes } = wireDemo(fx);
    const e = await startWorkflow(fx);
    await e.advance();
    await e.requestChanges(pending(fx)[0]!, 'Ngắn hơn một chút');
    expect(notes).toEqual([undefined, 'Ngắn hơn một chút']);
    expect(stepStatus(fx).script).toBe('waiting_approval');
  });

  it('approval.annotate attaches a summary to the pending approval', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    await (await startWorkflow(fx)).advance();
    expect(
      await fx.core.gateway.call(fx.session, 'approval.annotate', {
        step_id: 'script',
        summary: '3 line, giọng trang nghiêm',
      }),
    ).toEqual({ ok: true, data: {} });
    expect(state(fx).approvals.find((a: { step_id: string }) => a.step_id === 'script').note).toBe(
      '3 line, giọng trang nghiêm',
    );
  });

  it('093: a step that is failed or waiting to rerun keeps its status when its file changes', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    const e = await startWorkflow(fx);
    await e.advance();
    await e.approve(pending(fx)[0]!);
    e.pause();
    expect(stepStatus(fx).script).toBe('done');
    // bước chạy lại rồi lỗi, file đã đổi: không được biến thành "chờ duyệt" (duyệt cũ không vượt qua gate trượt)
    const sf = path.join(fx.dir, fx.v('state.json'));
    const st = state(fx);
    st.steps.script = {
      ...st.steps.script,
      status: 'failed',
      error: {
        code: 'E_GATE_FAILED',
        message: 'artifact_valid(SCRIPT.md): line 12: unexpected marker',
      },
    };
    writeFileSync(sf, JSON.stringify(st));
    const p = path.join(fx.dir, fx.v('SCRIPT.md'));
    writeFileSync(p, readFileSync(p, 'utf8').replace('Bệ hạ…', 'Tâu bệ hạ…'));
    expect(stepStatus(fx).script).toBe('failed');
    const scriptApprovals = () =>
      state(fx).approvals.filter((a: { step_id: string }) => a.step_id === 'script');
    expect(scriptApprovals().map((a: { status: string }) => a.status)).toEqual(['approved']);
    // bước chờ chạy lại (quay lại) cũng giữ nguyên
    const st2 = state(fx);
    st2.steps.script.status = 'stale';
    delete st2.steps.script.error;
    writeFileSync(sf, JSON.stringify(st2));
    writeFileSync(p, readFileSync(p, 'utf8').replace('Tâu bệ hạ…', 'Muôn tâu bệ hạ…'));
    expect(stepStatus(fx).script).toBe('stale');
    expect(scriptApprovals().map((a: { status: string }) => a.status)).toEqual(['approved']);
  });

  it('an approved artifact that changes invalidates the approval', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    const e = await startWorkflow(fx);
    await e.advance();
    await e.approve(pending(fx)[0]!);
    expect(stepStatus(fx).script).toBe('done');
    const p = path.join(fx.dir, fx.v('SCRIPT.md'));
    writeFileSync(p, readFileSync(p, 'utf8').replace('Bệ hạ…', 'Tâu bệ hạ…'));
    expect(stepStatus(fx).script).toBe('waiting_approval');
    expect(pending(fx)).toHaveLength(2);
    // duyệt lại nội dung mới → giữ trạng thái duyệt (hash cập nhật; 016 phát hiện khi nghiệm thu)
    const again = state(fx).approvals.find(
      (a: { step_id: string; status: string }) => a.step_id === 'script' && a.status === 'pending',
    )!;
    e.pause();
    await e.approve(again.id);
    expect(stepStatus(fx).script).toBe('done');
    expect(e.summary().pending_approvals).not.toContain(again.id);
  });

  it('agent steps must report completion (E_STEP_INCOMPLETE)', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    fx.core.workflows.setAgentRunner(async () => {});
    const e = await startWorkflow(fx);
    await e.advance();
    await e.approve(pending(fx)[0]!);
    expect(state(fx).steps.storyboard).toMatchObject({
      status: 'failed',
      error: { code: 'E_STEP_INCOMPLETE' },
    });
  });

  it('083: an agent that ends its turn to ask the user can complete the step on a later turn', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    fx.core.workflows.setAgentRunner(async () => {}); // lượt 1: agent hỏi người dùng rồi dừng
    const e = await startWorkflow(fx);
    await e.advance();
    await e.approve(pending(fx)[0]!);
    expect(state(fx).steps.storyboard).toMatchObject({
      status: 'failed',
      error: { code: 'E_STEP_INCOMPLETE', message: expect.stringMatching(AWAITING_REPLY) },
    });
    // lượt 2 (người dùng trả lời): agent viết file và báo xong → bước chạy tiếp sau lượt
    fx.store.write(fx.v('STORYBOARD.md'), fx.sample('STORYBOARD.md'), { by: 'test' });
    await e.stepComplete('storyboard', ['STORYBOARD.md']);
    expect(stepStatus(fx).storyboard).toBe('failed'); // chưa chạy trong lượt của agent
    await e.resumeAfterTurn();
    await e.idle();
    expect(stepStatus(fx).storyboard).not.toBe('failed');
    expect(state(fx).steps.storyboard.error).toBeUndefined();
    // không chờ gì thì resumeAfterTurn không làm gì; bước không chờ thì step_complete vẫn lỗi
    await e.resumeAfterTurn();
    await expect(e.stepComplete('script', [])).rejects.toMatchObject({
      code: 'E_STEP_INCOMPLETE',
    });
  });

  it('a step without an executor fails with E_WORKFLOW_INCOMPATIBLE', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    fx.core.workflows.unregisterExecutor('finalize');
    const e = await startWorkflow(fx);
    await e.advance();
    await e.approve(pending(fx)[0]!);
    await e.approve(pending(fx)[0]!);
    expect(state(fx).steps.finalize).toMatchObject({
      status: 'failed',
      error: { code: 'E_WORKFLOW_INCOMPATIBLE' },
    });
  });
});

describe('control (007 US3)', () => {
  it('rewind sends later steps to stale and reruns the target', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    const e = await startWorkflow(fx);
    await e.advance();
    await e.approve(pending(fx)[0]!);
    await e.approve(pending(fx)[0]!);
    await e.approve(pending(fx)[0]!);
    expect(stepStatus(fx).finalize).toBe('done');
    await fx.core.gateway.call(fx.session, 'workflow.rewind', { step_id: 'storyboard' });
    await e.idle();
    expect(stepStatus(fx)).toMatchObject({
      script: 'done',
      storyboard: 'waiting_approval',
      voice: 'stale',
      finalize: 'stale',
    });
  });

  it('pause stops after the running step; run_to resumes', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    const e = await startWorkflow(fx);
    await e.advance();
    e.pause();
    await e.approve(pending(fx)[0]!);
    expect(stepStatus(fx).storyboard).toBe('pending');
    expect(
      await fx.core.gateway.call(fx.session, 'workflow.run_to', { step_id: 'storyboard' }),
    ).toEqual({ ok: true, data: {} });
    await e.idle();
    expect(stepStatus(fx).storyboard).toBe('waiting_approval');
  });

  it('workflow.state returns a VideoStateSummary; gate_check does not change state', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    await (await startWorkflow(fx)).advance();
    const r = await fx.core.gateway.call(fx.session, 'workflow.state', {});
    expect((r as { data: unknown }).data).toMatchObject({
      video_id: fx.videoId,
      phase: 'workflow',
      workflow: { id: 'demo-explainer' },
      current_step: 'script',
      steps: [
        { id: 'script', title: 'Kịch bản', status: 'waiting_approval' },
        expect.objectContaining({ id: 'storyboard' }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      ],
      pending_approvals: [expect.stringMatching(/^ap_/)],
      owner: 'agent',
      budget: { tokens_used: 0, api_cost_usd: 0 },
    });
    const g = await fx.core.gateway.call(fx.session, 'workflow.gate_check', { step_id: 'script' });
    expect(g).toMatchObject({
      ok: true,
      data: {
        pass: true,
        results: [expect.objectContaining({ gate: 'artifact_valid', pass: true })],
      },
    });
  });

  it('workflow.step_complete from a frame session is allowed by policy; unknown step → error', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    await startWorkflow(fx);
    expect(
      await fx.core.gateway.call({ ...fx.session, kind: 'frame' }, 'workflow.step_complete', {
        step_id: 'nope',
        outputs: [],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'E_ID_UNKNOWN' },
    });
  });
});
