import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BuildGraph,
  createCore,
  createVideo,
  loadVideoModel,
  type Core,
  type StepExecutor,
} from '../src/index.js';
import { coreDir } from './helpers.js';
import { copyChannel, fixtureAppData, fixtureVideo, tempDir } from './domain-helpers.js';

export const workflowFixtures = path.join(coreDir, 'tests', 'fixtures', 'workflows');

/** Kênh mẫu + core (SF_GPU=0) + video mới ở pha briefing, gói workflow fixture. */
export function workflowFixture() {
  process.env.SF_GPU = '0';
  const c = copyChannel();
  const t = tempDir('app-');
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const core = createCore({
    appDataDir: t.dir,
    workflowDirs: [workflowFixtures],
    permissionTimeoutMs: 1000,
    backoffMs: [10, 20],
  });
  const store = core.gateway.storeFor(c.dir);
  const videoId = createVideo(store, { title: 'Thử' }).video_id;
  const v = (f: string) => `videos/${videoId}/${f}`;
  /** Nội dung SCRIPT/STORYBOARD mẫu với video_id của video mới. */
  const sample = (f: 'SCRIPT.md' | 'STORYBOARD.md') =>
    readFileSync(path.join(fixtureVideo, f), 'utf8').replace('vd_8m2pq7rt', videoId);
  return {
    core,
    dir: c.dir,
    store,
    videoId,
    v,
    sample,
    session: {
      session_id: 'ss_test0001' as const,
      kind: 'main' as const,
      channel_dir: c.dir,
      video_id: videoId,
    },
    cleanup() {
      core.close();
      c.cleanup();
      t.cleanup();
    },
  };
}

export type WorkflowFixture = ReturnType<typeof workflowFixture>;

/** Đăng ký executor/agent giả cho demo-explainer. */
export function wireDemo(fx: WorkflowFixture, opts: { badScript?: boolean } = {}) {
  const notes: (string | undefined)[] = [];
  fx.core.workflows.registerExecutor('script', async (ctx) => {
    notes.push(ctx.note);
    ctx.store.write(
      fx.v('SCRIPT.md'),
      opts.badScript ? '---\nschema_version: 1\n---\n' : fx.sample('SCRIPT.md'),
      { by: 'test', validate: false },
    );
    return { outputs: ['SCRIPT.md'] };
  });
  fx.core.workflows.registerExecutor('finalize', finalizeExecutor(fx.core));
  fx.core.workflows.setAgentRunner(async (instruction, ctx) => {
    fx.store.write(fx.v('STORYBOARD.md'), fx.sample('STORYBOARD.md'), { by: 'test' });
    await ctx.stepComplete(['STORYBOARD.md']);
    void instruction;
  });
  return { notes };
}

/** `finalize` giả: frame giả (bản thật do frame-build, 011) rồi dựng toàn bộ graph. */
export function finalizeExecutor(core: Core): StepExecutor {
  return async (ctx) => {
    for (const f of loadVideoModel(ctx.store.root, ctx.videoId).frames) {
      const rel = `videos/${ctx.videoId}/compositions/frames/${f.id}.html`;
      if (!existsSync(ctx.store.abs(rel)))
        ctx.store.write(rel, `<template><div data-composition-id="${f.id}"></div></template>`, {
          by: 'test',
          validate: false,
        });
    }
    await new BuildGraph({
      store: ctx.store,
      appDataDir: ctx.appDataDir,
      builders: core.graph,
    }).build(ctx.videoId);
    return { outputs: [] };
  };
}
