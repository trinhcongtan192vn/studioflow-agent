import path from 'node:path';
import { usageError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { cleanChannel, type CleanTarget } from '../../disk/clean.js';
import { diskUsage } from '../../disk/usage.js';
import { openDb } from '../../store/db.js';
import { WriteStore } from '../../store/writer.js';

const TARGETS: CleanTarget[] = ['cache', 'drafts', 'backups', 'snapshots'];

/** `sf disk usage [--channel]`, `sf disk clean --channel --targets` (024, D10 UI-10). */
export const commands: CliCommand[] = [
  {
    module: 'disk',
    name: 'usage',
    summary: 'Disk space, app models/providers and (with --channel) cache, renders, backups',
    options: { channel: { type: 'string' } },
    async run(input, ctx) {
      return diskUsage({
        appDataDir: defaultAppDataDir(),
        ...(input.channel ? { channelDir: path.resolve(ctx.cwd, input.channel as string) } : {}),
      });
    },
  },
  {
    module: 'disk',
    name: 'clean',
    summary: 'Remove derived data of a channel: --targets cache,drafts,backups,snapshots',
    options: {
      channel: { type: 'string', required: true },
      targets: { type: 'string', required: true },
    },
    async run(input, ctx) {
      const targets = String(input.targets)
        .split(',')
        .map((s) => s.trim()) as CleanTarget[];
      const bad = targets.filter((t) => !TARGETS.includes(t));
      if (bad.length)
        throw usageError(`unknown target(s): ${bad.join(', ')} (use ${TARGETS.join(', ')})`);
      const app = defaultAppDataDir();
      const db = openDb(path.join(app, 'studioflow.db'));
      try {
        return cleanChannel(
          { db, store: new WriteStore(path.resolve(ctx.cwd, input.channel as string)) },
          targets,
        );
      } finally {
        db.close();
      }
    },
  },
];
