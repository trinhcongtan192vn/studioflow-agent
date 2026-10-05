// 007 · US4 · SC-002 (FR-WS-04) — giết core giữa bước engine; mở lại hoàn tất đúng.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore } from '../../src/index.js';
import { coreDir } from '../helpers.js';
import {
  finalizeExecutor,
  wireDemo,
  workflowFixture,
  workflowFixtures,
  type WorkflowFixture,
} from '../workflow-helpers.js';

let fx: WorkflowFixture;
afterEach(() => fx?.cleanup());

const status = (f: WorkflowFixture) =>
  JSON.parse(readFileSync(path.join(f.dir, f.v('state.json')), 'utf8')).steps as Record<
    string,
    { status: string; error?: { code: string } }
  >;

describe('recovery (007 US4)', () => {
  it('reopening a video in the same process leaves a step that is really running alone (008)', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    let finish: () => void = () => {};
    fx.core.workflows.registerExecutor(
      'voice',
      () => new Promise((r) => (finish = () => r({ outputs: [] }))),
    );
    const e = fx.core.workflows.engine(fx.dir, fx.videoId);
    await e.select('demo-explainer', 'yt-1080p30');
    await e.approve(e.summary().pending_approvals[0]!);
    await e.advance();
    await e.approve(e.summary().pending_approvals[0]!); // script
    const run = e.approve(e.summary().pending_approvals[0]!); // storyboard → voice chạy
    const t0 = Date.now();
    while (status(fx).voice!.status !== 'running') {
      if (Date.now() - t0 > 10_000) throw new Error('voice never started');
      await new Promise((r) => setTimeout(r, 20));
    }
    e.open(); // người dùng bấm lại vào video
    expect(status(fx).voice).toMatchObject({ status: 'running' });
    expect(status(fx).voice!.error).toBeUndefined();
    finish();
    await run;
    await e.idle();
    // bước chạy tới hết bình thường (kết quả do gate quyết), không bị coi là app đã tắt
    expect(status(fx).voice!.status).not.toBe('pending');
    expect(status(fx).voice!.error?.code).not.toBe('E_STEP_INCOMPLETE');
  });

  it('an engine step killed mid-run is re-run after reopening', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    const e = fx.core.workflows.engine(fx.dir, fx.videoId);
    await e.select('demo-explainer', 'yt-1080p30');
    await e.approve(e.summary().pending_approvals[0]!);
    await e.advance();
    await e.approve(e.summary().pending_approvals[0]!); // script
    e.pause();
    await e.approve(e.summary().pending_approvals[0]!); // storyboard → dừng (paused)
    expect(status(fx).voice!.status).toBe('pending');
    const appData = fx.core.appDataDir;
    fx.core.close();

    // tiến trình con: bước voice chạy rất lâu, bị giết khi đang running
    const script = path.join(appData, 'child.mjs');
    const dist = pathToFileURL(path.join(coreDir, 'dist', 'index.js')).href;
    writeFileSync(
      script,
      `import { createCore } from ${JSON.stringify(dist)};
const core = createCore({ appDataDir: ${JSON.stringify(appData)}, workflowDirs: [${JSON.stringify(workflowFixtures)}] });
core.workflows.registerExecutor('voice', () => new Promise(() => {}));
await core.workflows.engine(${JSON.stringify(fx.dir)}, ${JSON.stringify(fx.videoId)}).runTo('voice');
`,
    );
    const child = spawn(process.execPath, [script], {
      stdio: 'ignore',
      env: { ...process.env, SF_GPU: '0' },
    });
    const exited = new Promise((r) => child.once('exit', r));
    const t0 = Date.now();
    while (status(fx).voice!.status !== 'running') {
      if (Date.now() - t0 > 20_000) throw new Error('voice never started');
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill('SIGKILL');
    await exited;

    const core2 = createCore({ appDataDir: appData, workflowDirs: [workflowFixtures] });
    try {
      core2.workflows.registerExecutor('finalize', finalizeExecutor(core2));
      const e2 = core2.workflows.engine(fx.dir, fx.videoId);
      e2.open();
      expect(status(fx).voice!.status).toBe('pending');
      await e2.advance();
      expect(status(fx)).toMatchObject({
        voice: { status: 'done' },
        finalize: { status: 'waiting_approval' },
      });
    } finally {
      core2.close();
    }
  }, 60_000);

  it('an agent step interrupted by a crash goes back to pending and asks for confirmation', async () => {
    fx = workflowFixture();
    wireDemo(fx);
    const e = fx.core.workflows.engine(fx.dir, fx.videoId);
    await e.select('demo-explainer', 'yt-1080p30');
    await e.approve(e.summary().pending_approvals[0]!);
    // giả lập crash: storyboard (agent) đang running trong state.json
    const p = path.join(fx.dir, fx.v('state.json'));
    const st = JSON.parse(readFileSync(p, 'utf8'));
    st.steps.script.status = 'done';
    st.steps.storyboard.status = 'running';
    writeFileSync(p, JSON.stringify(st));
    e.open();
    expect(status(fx).storyboard).toMatchObject({
      status: 'pending',
      error: { code: 'E_STEP_INCOMPLETE' },
    });
  });
});
