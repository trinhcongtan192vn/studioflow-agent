import path from 'node:path';
import type { CliCommand } from '../../cli/types.js';
import { usageError } from '../../cli/errors.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { createCore } from '../../core.js';
import { renderVideo } from '../../render/render.js';

/** `sf render video --channel --video [--mode draft|release] [--profile <id>]` (013 FR-006). */
export const commands: CliCommand[] = [
  {
    module: 'render',
    name: 'video',
    summary: 'Render a video to MP4 (draft with NHÁP mark, or release with gates + CREDITS)',
    options: {
      channel: { type: 'string', required: true },
      video: { type: 'string', required: true },
      mode: { type: 'string' },
      profile: { type: 'string' },
    },
    async run(input, ctx) {
      const mode = (input.mode as string | undefined) ?? 'draft';
      if (mode !== 'draft' && mode !== 'release')
        throw usageError('--mode must be draft or release');
      const appDataDir = defaultAppDataDir();
      const core = createCore({ appDataDir, dbFile: ':memory:', start: false });
      try {
        const store = core.gateway.storeFor(path.resolve(ctx.cwd, input.channel as string));
        return await renderVideo(
          { store, builders: core.graph, appDataDir },
          input.video as string,
          {
            mode,
            ...(input.profile ? { output_profile: input.profile as string } : {}),
          },
        );
      } finally {
        core.close();
      }
    },
  },
];
