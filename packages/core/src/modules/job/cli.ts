import path from 'node:path';
import { usageError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { JobQueue } from '../../jobs/queue.js';
import { openDb } from '../../store/db.js';

function withQueue<T>(fn: (q: JobQueue) => T): T {
  const db = openDb(path.join(defaultAppDataDir(), 'studioflow.db'));
  try {
    return fn(new JobQueue({ db }));
  } finally {
    db.close();
  }
}

/** `sf job list|cancel` (D4 mục 12) — đọc `studioflow.db`. */
export const commands: CliCommand[] = [
  {
    module: 'job',
    name: 'list',
    summary: 'List jobs in studioflow.db',
    options: { status: { type: 'string' }, video: { type: 'string' } },
    async run(input) {
      return withQueue((q) => ({
        jobs: q.list({
          status: input.status as string | undefined,
          video_id: input.video as string | undefined,
        }),
      }));
    },
  },
  {
    module: 'job',
    name: 'cancel',
    summary: 'Cancel a queued job (a running job is canceled by its core process)',
    positionals: ['id'],
    async run(input) {
      if (typeof input.id !== 'string') throw usageError('usage: sf job cancel <id>');
      return withQueue((q) => q.cancel(input.id as string));
    },
  },
];
