// 034 · SC-001..004 (FR-WF-10) — chế độ tự động: chỉ dừng ở điểm chốt; batch_gen tự đồng ý;
// thiếu giọng → giao agent gợi ý và chờ chọn.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wireDemo, workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture;
afterEach(() => fx?.cleanup());

const state = (f: WorkflowFixture) =>
  JSON.parse(readFileSync(path.join(f.dir, f.v('state.json')), 'utf8'));
const status = (f: WorkflowFixture) =>
  Object.fromEntries(
    f.core.workflows
      .engine(f.dir, f.videoId)
      .summary()
      .steps.map((s) => [s.id, s.status]),
  );

/** Bật/tắt autopilot ở tầng video (fixture app đặt false để giữ test cũ). */
function setAutopilot(f: WorkflowFixture, on: boolean) {
  const p = path.join(f.dir, f.v('state.json'));
  const st = JSON.parse(readFileSync(p, 'utf8'));
  st.config_overrides = { ...st.config_overrides, 'workflow.autopilot': on };
  writeFileSync(p, JSON.stringify(st, null, 2));
}

async function start(f: WorkflowFixture, autopilot: boolean) {
  const e = f.core.workflows.engine(f.dir, f.videoId);
  await e.select('demo-explainer', 'yt-1080p30');
  setAutopilot(f, autopilot);
  await e.approve(e.summary().pending_approvals[0]!); // brief: luôn duyệt tay
  await e.advance();
  return e;
}

describe('autopilot (034)', () => {
  it('stops only at key approvals; others are approved automatically (SC-001)', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    const e = await start(fx, true);
    expect(status(fx).script).toBe('waiting_approval'); // điểm chốt
    await e.approve(e.summary().pending_approvals[0]!);
    // storyboard tự duyệt → chạy tới finalize (điểm chốt trước render)
    expect(status(fx)).toMatchObject({
      script: 'done',
      storyboard: 'done',
      voice: 'done',
      finalize: 'waiting_approval',
    });
    const sb = state(fx).approvals.find((a: { step_id: string }) => a.step_id === 'storyboard');
    expect(sb).toMatchObject({ status: 'approved', note: expect.stringMatching(/^Tự duyệt/) });
    expect(e.summary().pending_approvals).toHaveLength(1);
    // agent sửa storyboard đã tự duyệt: không bị coi là ghi đè artifact đã duyệt, không quay về chờ duyệt
    expect(fx.store.protectedReason(fx.v('STORYBOARD.md'))).toBeUndefined();
    fx.store.write(
      fx.v('STORYBOARD.md'),
      fx.sample('STORYBOARD.md').replace('Ghi chú', 'Ghi chú mới'),
      {
        by: 'test',
      },
    );
    expect(status(fx).storyboard).toBe('done');
    expect(e.summary().pending_approvals).toHaveLength(1);
  });

  it('turned off: every manifest approval stops as before (SC-002)', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    const e = await start(fx, false);
    await e.approve(e.summary().pending_approvals[0]!);
    expect(status(fx).storyboard).toBe('waiting_approval');
  });

  it('batch_gen is allowed automatically, paid_api still asks (SC-003)', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    await start(fx, true);
    const asked: string[] = [];
    fx.core.gateway.permissions.on(
      'permission.requested',
      (r: { kind: string; request_id: string }) => {
        asked.push(r.kind);
        fx.core.gateway.permissions.decide({ request_id: r.request_id, allow: false });
      },
    );
    const p = fx.core.gateway.permissions;
    expect(await p.ask(fx.session, { tool: 't', kind: 'batch_gen', summary: 'x' })).toBe(true);
    expect(await p.ask(fx.session, { tool: 't', kind: 'paid_api', summary: 'x' })).toBe(false);
    expect(asked).toEqual(['paid_api']);
    setAutopilot(fx, false);
    expect(await p.ask(fx.session, { tool: 't', kind: 'batch_gen', summary: 'x' })).toBe(false);
    expect(asked).toEqual(['paid_api', 'batch_gen']);
  });

  it('Autopilot videos never wait for a person: overwrite allowed, pinned frame declined (077)', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    // video do bộ chạy Autopilot tạo (052): state.autopilot
    const sp = path.join(fx.dir, fx.v('state.json'));
    const st = JSON.parse(readFileSync(sp, 'utf8'));
    st.autopilot = { plan_date: '2026-10-08', item_id: 'pi_aaaaaaaa', channel_id: st.channel_id };
    writeFileSync(sp, JSON.stringify(st, null, 2));
    const p = fx.core.gateway.permissions;
    const asked: string[] = [];
    const decided: { kind: string; allow: boolean }[] = [];
    p.on('permission.requested', (r: { kind: string }) => asked.push(r.kind));
    p.on('autopilot.decided', (e: { request: { kind: string }; allow: boolean }) =>
      decided.push({ kind: e.request.kind, allow: e.allow }),
    );
    const t0 = Date.now();
    expect(await p.ask(fx.session, { tool: 't', kind: 'overwrite_approved', summary: 'x' })).toBe(
      true,
    );
    expect(await p.ask(fx.session, { tool: 't', kind: 'pinned_frame', summary: 'x' })).toBe(false);
    expect(await p.ask(fx.session, { tool: 't', kind: 'render', summary: 'x' })).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000); // không chờ người (trước đây 10 phút mỗi lần)
    expect(asked).toEqual([]);
    expect(decided).toEqual([
      { kind: 'overwrite_approved', allow: true },
      { kind: 'pinned_frame', allow: false },
      { kind: 'render', allow: true },
    ]);
  });

  it('missing voice: the voice step hands over to the agent, then builds audio (SC-004)', async () => {
    fx = workflowFixture();
    // kênh chưa có giọng người dẫn
    const ch = path.join(fx.dir, 'channel.json');
    const c = JSON.parse(readFileSync(ch, 'utf8'));
    delete c.config['voice.id'];
    writeFileSync(ch, JSON.stringify(c, null, 2));
    wireDemo(fx);
    const instructions: string[] = [];
    fx.core.workflows.setAgentRunner(async (instruction, ctx) => {
      instructions.push(instruction);
      if (/bước storyboard/.test(instruction)) {
        fx.store.write(fx.v('STORYBOARD.md'), fx.sample('STORYBOARD.md'), { by: 'test' });
        await ctx.stepComplete(['STORYBOARD.md']);
      } else if (/bước voice/.test(instruction)) {
        // agent: gợi ý giọng, người dùng chọn → đặt voice.id (giọng có sẵn trong kênh mẫu)
        c.config['voice.id'] = 'vo_c3z8p1mn';
        writeFileSync(ch, JSON.stringify(c, null, 2));
        await ctx.stepComplete([]);
      }
    });
    const e = await start(fx, true);
    await e.approve(e.summary().pending_approvals[0]!); // script
    const voiceAsk = instructions.find((i) => /bước voice/.test(i));
    expect(voiceAsk).toContain('voice.design');
    expect(voiceAsk).toContain('narrator');
    expect(status(fx)).toMatchObject({ voice: 'done', finalize: 'waiting_approval' });
  });
});
