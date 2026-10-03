// 011 · SC-001 — phiên `frame` thật (Claude) dựng 2 frame của video mẫu; record khi SF_LLM=record,
// replay (thực thi lại artifact.write/step_complete) khi không. HyperFrames lint + check thật.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  checkFrameFile,
  createCore,
  createRuntime,
  hfCheck,
  hfLint,
  loadVideoModel,
} from '../../src/index.js';
import { coreDir } from '../helpers.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

const fixtureDir = path.join(coreDir, 'tests', 'fixtures', 'llm', 'frames');
beforeAll(() => {
  process.env.SF_GPU = '0'; // TTS/ASR giả: mốc tất định cho khóa bản ghi
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

describe('frame sessions with Claude (011 SC-001)', () => {
  it('builds both frames, index.html passes lint and check, data-sf-id kept', async () => {
    process.env.SF_LLM ??= 'replay';
    const c = copyChannel();
    const t = tempDir('app-');
    writeFileSync(
      path.join(t.dir, 'settings.json'),
      readFileSync(path.join(fixtureAppData, 'settings.json')),
    );
    const core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 1000 });
    cleanups.push(() => core.close(), c.cleanup, t.cleanup);
    core.workflows.setAgentRuntime(createRuntime({ gateway: core.gateway, fixtureDir }));
    const engine = core.workflows.engine(c.dir, fixtureVideoId);
    const step = { id: 'frames', uses: 'frame-build', title: 'Dựng frame' };
    const r = (await core.workflows.executor('frame-build')!({
      store: core.gateway.storeFor(c.dir),
      channelDir: c.dir,
      videoId: fixtureVideoId,
      step,
      manifest: { id: 't', steps: [step] },
      signal: new AbortController().signal,
      appDataDir: t.dir,
      waitFrame: (f: string) => engine.waitFrame('frames', f),
    } as never)) as { built: string[] };
    expect(r.built.sort()).toEqual(['fr_3m8k1w7d', 'fr_9x2b7cqe']);
    const v = path.join(c.dir, 'videos', fixtureVideoId);
    const model = loadVideoModel(c.dir, fixtureVideoId);
    for (const f of model.frames) {
      const html = readFileSync(path.join(v, 'compositions', 'frames', `${f.id}.html`), 'utf8');
      expect(
        checkFrameFile(
          html,
          f.id,
          f.layers.map((l) => l.id),
        ),
      ).toEqual([]);
    }
    expect((await hfLint(v)).ok).toBe(true);
    const check = await hfCheck(v, {
      watch: model.frames.map((f) => path.join(v, 'compositions', 'frames', `${f.id}.html`)),
    });
    console.log('[frame-live] check errors', JSON.stringify(check.errors).slice(0, 2000));
    expect(check.errorCount).toBe(0);
  }, 1_800_000);
});
