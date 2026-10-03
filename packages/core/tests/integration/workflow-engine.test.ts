// 007 · US1–US3 · FR-001..008 (FR-WF-01..04).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wireDemo, workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

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
    expect(ids).toEqual(['demo-explainer', 'refine-demo']); // bad-order bị loại (E_STEP_ORDER)
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
