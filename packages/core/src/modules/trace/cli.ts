import path from 'node:path';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { openDb } from '../../store/db.js';
import { getTrace, listTraces } from '../../trace/trace.js';

function withDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const db = openDb(path.join(defaultAppDataDir(), 'studioflow.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** `sf trace list [--video] [--limit]`, `sf trace show <trace_id>` (015, D11 mục 1). */
export const commands: CliCommand[] = [
  {
    module: 'trace',
    name: 'list',
    summary: 'Recent root spans (workflow steps, agent sessions, jobs) from studioflow.db',
    options: { video: { type: 'string' }, limit: { type: 'string' } },
    run: async (input) =>
      withDb((db) => ({
        traces: listTraces(db, {
          ...(input.video ? { videoId: input.video as string } : {}),
          ...(input.limit ? { limit: Number(input.limit) } : {}),
        }).map((s) => ({
          trace_id: s.trace_id,
          name: s.name,
          started_at: new Date(s.start_ms).toISOString(),
          ms: Math.round(s.end_ms - s.start_ms),
          status: s.status,
          video_id: s.video_id,
        })),
      })),
  },
  {
    module: 'trace',
    name: 'show',
    summary: 'All spans of one trace as a tree',
    positionals: ['trace_id'],
    run: async (input) => withDb((db) => ({ spans: getTrace(db, String(input.trace_id)) })),
  },
];
