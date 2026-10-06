// 008 UI-04 — tiến độ bước: executor báo qua ctx.progress → engine phát `workflow.progress`,
// giữ bản mới nhất để giao diện mở sau vẫn đọc được, xóa khi bước kết thúc.
import { afterEach, expect, it } from 'vitest';
import { wireDemo, workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture;
afterEach(() => fx?.cleanup());

it('engine relays step progress and clears it when the step ends', async () => {
  fx = workflowFixture();
  wireDemo(fx);
  const seen: unknown[] = [];
  let mid: unknown;
  const e = fx.core.workflows.engine(fx.dir, fx.videoId);
  fx.core.workflows.registerExecutor('script', async (ctx) => {
    ctx.progress?.(1, 4, 'Vòng 1/2: đang chấm điểm');
    mid = e.progress();
    ctx.store.write(fx.v('SCRIPT.md'), fx.sample('SCRIPT.md'), { by: 'test', validate: false });
    return { outputs: ['SCRIPT.md'] };
  });
  e.on('workflow.progress', (p) => seen.push(p));
  await e.select('demo-explainer', 'yt-1080p30');
  await e.approve(e.summary().pending_approvals[0]!);
  await e.advance();
  expect(mid).toEqual({ script: { done: 1, total: 4, message: 'Vòng 1/2: đang chấm điểm' } });
  expect(seen[0]).toEqual({
    step_id: 'script',
    done: 1,
    total: 4,
    message: 'Vòng 1/2: đang chấm điểm',
  });
  expect(seen.at(-1)).toEqual({ step_id: 'script', done: null, total: null });
  expect(e.progress()).toEqual({});
});
