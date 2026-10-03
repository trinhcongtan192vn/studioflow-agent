import path from 'node:path';
import type { CliCommand } from '../../cli/types.js';
import { hfCheck, hfLint } from '../../hf/cli.js';

const videoDir = (input: Record<string, unknown>, cwd: string) =>
  path.join(path.resolve(cwd, input.channel as string), 'videos', input.video as string);
const opts = {
  channel: { type: 'string', required: true },
  video: { type: 'string', required: true },
} as const;

/** `sf hf lint|check --channel --video` (011 FR-010). */
export const commands: CliCommand[] = [
  {
    module: 'hf',
    name: 'lint',
    summary: 'Run the pinned `hyperframes lint` on a video project',
    options: { ...opts },
    run: async (input, ctx) => hfLint(videoDir(input, ctx.cwd)),
  },
  {
    module: 'hf',
    name: 'check',
    summary: 'Run the pinned `hyperframes check` (headless Chrome) on a video project',
    options: { ...opts },
    run: async (input, ctx) => {
      const r = await hfCheck(videoDir(input, ctx.cwd));
      return { ok: r.ok, errorCount: r.errorCount, errors: r.errors };
    },
  },
];
