import path from 'node:path';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { createCore } from '../../core.js';
import { SfError } from '../../errors.js';

/** `sf refine run --channel <dir> --video <vd> --step <id>` — chạy executor bước text (không đổi trạng thái workflow) (009 FR-010). */
export const commands: CliCommand[] = [
  {
    module: 'refine',
    name: 'run',
    summary: 'Run a text step (script/publish-meta) through the refine-loop outside the workflow',
    options: {
      channel: { type: 'string', required: true },
      video: { type: 'string', required: true },
      step: { type: 'string', required: true },
    },
    async run(input, ctx) {
      const core = createCore({
        appDataDir: defaultAppDataDir(),
        dbFile: ':memory:',
        start: false,
      });
      try {
        const channelDir = path.resolve(ctx.cwd, input.channel as string);
        const videoId = input.video as string;
        const st = core.workflows.engine(channelDir, videoId).readState();
        const pack = core.workflows.packs().find((p) => p.manifest.id === st.workflow?.id);
        if (!pack)
          throw new SfError(
            'E_WORKFLOW_INCOMPATIBLE',
            `video ${videoId} has no installed workflow`,
          );
        const step = pack.manifest.steps.find((s) => s.id === input.step);
        if (!step)
          throw new SfError(
            'E_ID_UNKNOWN',
            `step ${String(input.step)} not in workflow ${pack.manifest.id}`,
          );
        const exec = core.workflows.executor(step.uses);
        if (!exec || !['script', 'publish-meta'].includes(step.uses)) {
          throw new SfError(
            'E_WORKFLOW_INCOMPATIBLE',
            `step ${step.id} (${step.uses}) is not a text step`,
          );
        }
        return await exec({
          store: core.gateway.storeFor(channelDir),
          channelDir,
          videoId,
          step,
          manifest: pack.manifest,
          signal: new AbortController().signal,
          appDataDir: core.appDataDir,
          packDir: pack.dir,
        });
      } finally {
        core.close();
      }
    },
  },
];
