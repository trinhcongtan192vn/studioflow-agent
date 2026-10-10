import path from 'node:path';
import type { CliCommand } from '../../cli/types.js';
import { createCore } from '../../core.js';
import {
  capacityRun,
  installedWorkflows,
  planToday,
  createManualPlanVideo,
  removePlanItem,
  rankWithLearning,
} from '../../autopilot/index.js';
import { getSecretDefault } from '../../secrets/credman.js';
import { YOUTUBE_SECRET } from '../../youtube/index.js';
import { withSpan } from '../../trace/trace.js';

/** 096: inspect the same preview as the desktop without starting queued production work. */
export const commands: CliCommand[] = [
  {
    module: 'autopilot',
    name: 'remove-item',
    summary: 'Remove an unstarted item from a saved plan',
    options: {
      channel: { type: 'string', required: true },
      date: { type: 'string', required: true },
      item: { type: 'string', required: true },
    },
    async run(input, ctx) {
      const core = createCore({ start: false });
      try {
        return await withSpan('sf.autopilot.remove_item', {}, async () =>
          removePlanItem(core.gateway.storeFor(path.resolve(ctx.cwd, input.channel as string)), {
            date: input.date as string,
            item_id: input.item as string,
          }),
        );
      } finally {
        core.close();
      }
    },
  },
  {
    module: 'autopilot',
    name: 'create-video',
    summary: 'Transfer one plan item to a manual video and return its brief instruction',
    options: {
      channel: { type: 'string', required: true },
      date: { type: 'string', required: true },
      item: { type: 'string', required: true },
    },
    async run(input, ctx) {
      const core = createCore({ start: false });
      try {
        return await withSpan('sf.autopilot.create_video', {}, async () =>
          createManualPlanVideo(
            core.gateway.storeFor(path.resolve(ctx.cwd, input.channel as string)),
            {
              date: input.date as string,
              item_id: input.item as string,
              installed: installedWorkflows(core.workflows),
            },
          ),
        );
      } finally {
        core.close();
      }
    },
  },
  {
    module: 'autopilot',
    name: 'preview',
    summary: "Preview today's plan without saving a production plan or enabling Autopilot",
    options: { channel: { type: 'string', required: true } },
    async run(input, ctx) {
      const core = createCore({ start: false });
      try {
        return await withSpan('sf.autopilot.preview', {}, () =>
          planToday({
            channels: [path.resolve(ctx.cwd, input.channel as string)],
            preview: true,
            appDataDir: core.appDataDir,
            storeFor: (dir) => core.gateway.storeFor(dir),
            installed: installedWorkflows(core.workflows),
            capacity: (channels) =>
              capacityRun({
                db: core.db,
                appDataDir: core.appDataDir,
                workflows: core.workflows,
                channels,
              }),
            apiKey: getSecretDefault(YOUTUBE_SECRET),
            learn: (dir, candidates) => {
              try {
                return core.learning.enabled(dir)
                  ? rankWithLearning(candidates, core.learning.refresh(dir))
                  : undefined;
              } catch {
                return undefined;
              }
            },
          }),
        );
      } finally {
        core.close();
      }
    },
  },
];
