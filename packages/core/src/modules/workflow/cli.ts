import path from 'node:path';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { createCore } from '../../core.js';

function withCore<T>(fn: (core: ReturnType<typeof createCore>) => T): T {
  const core = createCore({ appDataDir: defaultAppDataDir(), dbFile: ':memory:', start: false });
  try {
    return fn(core);
  } finally {
    core.close();
  }
}

/** `sf workflow list|state` (007 FR-009). */
export const commands: CliCommand[] = [
  {
    module: 'workflow',
    name: 'list',
    summary: 'Installed workflow packs (compatible ones; --all includes problems)',
    options: { all: { type: 'boolean' } },
    async run(input) {
      return withCore((core) => ({
        workflows: core.workflows
          .packs()
          .filter((p) => input.all === true || p.compatible)
          .map((p) => ({
            id: p.manifest.id,
            version: p.manifest.version,
            title: p.manifest.title,
            compatible: p.compatible,
            ...(p.compatible ? {} : { errors: p.errors }),
          })),
      }));
    },
  },
  {
    module: 'workflow',
    name: 'state',
    summary: 'Workflow state summary of a video',
    options: {
      channel: { type: 'string', required: true },
      video: { type: 'string', required: true },
    },
    async run(input, ctx) {
      return withCore((core) =>
        core.workflows
          .engine(path.resolve(ctx.cwd, input.channel as string), input.video as string)
          .summary(),
      );
    },
  },
];
