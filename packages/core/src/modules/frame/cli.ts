import path from 'node:path';
import { createRuntime } from '../../agent/index.js';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { createCore } from '../../core.js';
import { SfError } from '../../errors.js';

/** `sf frame build --channel --video [--frames fr_a,fr_b]` — phiên `frame` thật (011 FR-010). */
export const commands: CliCommand[] = [
  {
    module: 'frame',
    name: 'build',
    summary: 'Build frame compositions with frame agent sessions, assemble index.html, lint',
    options: {
      channel: { type: 'string', required: true },
      video: { type: 'string', required: true },
      frames: { type: 'string' },
    },
    async run(input, ctx) {
      const appDataDir = defaultAppDataDir();
      const core = createCore({ appDataDir, dbFile: ':memory:', start: false });
      try {
        core.workflows.setAgentRuntime(createRuntime({ gateway: core.gateway }));
        const channelDir = path.resolve(ctx.cwd, input.channel as string);
        const videoId = input.video as string;
        const exec = core.workflows.executor('frame-build');
        if (!exec) throw new SfError('E_INTERNAL', 'frame-build executor is not registered');
        const engine = core.workflows.engine(channelDir, videoId);
        const step = { id: 'frames', uses: 'frame-build', title: 'Dựng frame' } as const;
        const only = typeof input.frames === 'string' ? input.frames.split(',') : undefined;
        return await exec({
          store: core.gateway.storeFor(channelDir),
          channelDir,
          videoId,
          step: step as never,
          manifest: { id: 'cli', steps: [step] } as never,
          signal: new AbortController().signal,
          appDataDir,
          waitFrame: (f: string) => engine.waitFrame(step.id, f),
          ...(only ? { only } : {}),
        } as never);
      } finally {
        core.close();
      }
    },
  },
];
