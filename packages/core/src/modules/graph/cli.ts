import path from 'node:path';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { BuildGraph, BuilderRegistry } from '../../graph/graph.js';
import { WriteStore } from '../../store/writer.js';

const opts = {
  channel: { type: 'string' as const, required: true },
  video: { type: 'string' as const, required: true },
};

function graphFor(input: Record<string, unknown>, cwd: string): BuildGraph {
  return new BuildGraph({
    store: new WriteStore(path.resolve(cwd, input.channel as string)),
    appDataDir: defaultAppDataDir(),
    builders: new BuilderRegistry(),
  });
}

/** `sf graph status|plan` (D4 mục 12, agent ✓). Builder của provider chỉ có khi `core` chạy. */
export const commands: CliCommand[] = [
  {
    module: 'graph',
    name: 'status',
    summary: 'Build graph node status of a video',
    options: opts,
    async run(input, ctx) {
      return { nodes: graphFor(input, ctx.cwd).status(input.video as string) };
    },
  },
  {
    module: 'graph',
    name: 'plan',
    summary: 'Planned jobs to refresh the build graph (does not run)',
    options: opts,
    positionals: ['targets...'],
    async run(input, ctx) {
      return graphFor(input, ctx.cwd).plan(
        input.video as string,
        input.targets as string[] | undefined,
      );
    },
  },
];
