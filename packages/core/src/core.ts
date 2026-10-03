import path from 'node:path';
import { ProviderRegistry } from './capability/registry.js';
import { defaultAppDataDir } from './config/resolve.js';
import { createGateway, type Gateway } from './gateway/index.js';
import { BuilderRegistry } from './graph/graph.js';
import { defineGraphJob, graphTools } from './graph/tools.js';
import { JobQueue } from './jobs/queue.js';
import { jobTools } from './jobs/tools.js';
import { openDb, type Db } from './store/db.js';

export interface CoreOptions {
  appDataDir?: string;
  permissionTimeoutMs?: number;
  backoffMs?: number[];
  /** Mặc định true: khôi phục job dở dang và bắt đầu chạy hàng đợi. */
  start?: boolean;
}

export interface Core {
  appDataDir: string;
  db: Db;
  queue: JobQueue;
  providers: ProviderRegistry;
  /** Builder build graph — tính năng sau đăng ký `registerBuilder`. */
  graph: BuilderRegistry;
  gateway: Gateway;
  close(): void;
}

/**
 * Lắp các dịch vụ của tiến trình `core` (D4 mục 1): DB, hàng đợi job, provider, build graph,
 * Gateway với tool nền + `job.*` + `graph.*`.
 */
export function createCore(opts: CoreOptions = {}): Core {
  const appDataDir = opts.appDataDir ?? defaultAppDataDir();
  const db = openDb(path.join(appDataDir, 'studioflow.db'));
  const queue = new JobQueue({ db, backoffMs: opts.backoffMs });
  const providers = new ProviderRegistry();
  const graph = new BuilderRegistry();
  const gateway = createGateway({ appDataDir, permissionTimeoutMs: opts.permissionTimeoutMs });
  for (const t of [...jobTools(queue), ...graphTools({ queue, builders: graph })])
    gateway.register(t);
  defineGraphJob(queue, graph, (dir) => gateway.storeFor(dir));
  if (opts.start !== false) {
    queue.recover();
    queue.start();
  }
  return {
    appDataDir,
    db,
    queue,
    providers,
    graph,
    gateway,
    close() {
      queue.stop();
      db.close();
    },
  };
}
