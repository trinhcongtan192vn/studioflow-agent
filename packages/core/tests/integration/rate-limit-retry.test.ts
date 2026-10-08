// 086 · FR-WF-86-04 — bước lỗi hết lượt Claude tự chạy lại lúc hết hạn mức (video không thuộc Autopilot).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SfError } from '../../src/index.js';
import { wireDemo, workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture;
afterEach(() => fx?.cleanup());

const steps = (f: WorkflowFixture) =>
  JSON.parse(readFileSync(path.join(f.dir, f.v('state.json')), 'utf8')).steps;

describe('rate limit retry (086)', () => {
  it('notes the retry time, then runs the step again when the limit resets', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    let limited = true;
    fx.core.workflows.setAgentRunner(async (instruction, ctx) => {
      if (/bước storyboard/.test(instruction)) {
        if (limited)
          throw new SfError(
            'E_RUNTIME_RATE_LIMIT',
            "Claude Code returned an error result: You've hit your session limit · resets 5pm (Asia/Bangkok)",
          );
        fx.store.write(fx.v('STORYBOARD.md'), fx.sample('STORYBOARD.md'), { by: 'test' });
        await ctx.stepComplete(['STORYBOARD.md']);
      }
    });
    const e = fx.core.workflows.engine(fx.dir, fx.videoId);
    await e.select('demo-explainer', 'yt-1080p30');
    await e.approve(e.summary().pending_approvals[0]!); // brief
    await e.idle();
    await e.approve(e.summary().pending_approvals[0]!); // script
    await e.idle();
    expect(steps(fx).storyboard).toMatchObject({
      status: 'failed',
      error: {
        code: 'E_RUNTIME_RATE_LIMIT',
        message: expect.stringMatching(/tự chạy lại lúc 17:01 \d\d\/\d\d$/),
      },
    });
    // tới giờ: bước chạy lại và xong
    limited = false;
    await e.retryAfterLimit('storyboard');
    await e.idle();
    expect(steps(fx).storyboard.status).not.toBe('failed');
    // gọi lại khi bước không còn lỗi hết lượt → không làm gì
    await e.retryAfterLimit('storyboard');
  });
});
