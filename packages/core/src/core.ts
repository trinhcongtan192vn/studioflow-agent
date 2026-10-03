import path from 'node:path';
import { asrLineBuilder } from './asr/builder.js';
import { captionsBuilder } from './asr/captions.js';
import { asrTools, defineAsrJobs } from './asr/tools.js';
import { ProviderRegistry } from './capability/registry.js';
import { defaultAppDataDir } from './config/resolve.js';
import { createGateway, type Gateway } from './gateway/index.js';
import { BuilderRegistry } from './graph/graph.js';
import { defineGraphJob, graphTools } from './graph/tools.js';
import { JobQueue } from './jobs/queue.js';
import { jobTools } from './jobs/tools.js';
import { registerDefaultProviders } from './providers/index.js';
import { openDb, type Db } from './store/db.js';
import { audioLineBuilder } from './tts/builder.js';
import { defineTtsJobs, ttsTools } from './tts/tools.js';
import type { LlmMode } from './testing/llm-replay.js';
import { publishMetaExecutor, scriptExecutor } from './text/executors.js';
import { registerTextObjectives } from './text/objectives.js';
import { createTextService, type TextService } from './text/service.js';
import { defaultWorkflowDirs } from './workflow/packs.js';
import { WorkflowService } from './workflow/service.js';
import { workflowTools } from './workflow/tools.js';

export interface CoreOptions {
  appDataDir?: string;
  permissionTimeoutMs?: number;
  backoffMs?: number[];
  /** Thư mục gói workflow (mặc định D5 mục 3.2). */
  workflowDirs?: string[];
  /** Mặc định `<appDataDir>/studioflow.db`; `:memory:` cho lệnh CLI ngắn. */
  dbFile?: string;
  /** Mặc định true: khôi phục job dở dang và bắt đầu chạy hàng đợi. */
  start?: boolean;
  /** Ghi/phát lại lời gọi text (D12); mặc định theo `SF_LLM`/`SF_LLM_FIXTURES`. */
  textFixtureDir?: string;
  textMode?: LlmMode;
  /** Khóa API provider text (mặc định biến môi trường, 009). */
  getSecret?: (name: string) => string | undefined;
}

export interface Core {
  appDataDir: string;
  db: Db;
  queue: JobQueue;
  providers: ProviderRegistry;
  /** Builder build graph — tính năng sau đăng ký `registerBuilder`. */
  graph: BuilderRegistry;
  gateway: Gateway;
  /** Workflow Engine (007). */
  workflows: WorkflowService;
  /** Text providers (009). */
  text: TextService;
  close(): void;
}

/**
 * Lắp các dịch vụ của tiến trình `core` (D4 mục 1): DB, hàng đợi job, provider, build graph,
 * Gateway với tool nền + `job.*` + `graph.*`.
 */
export function createCore(opts: CoreOptions = {}): Core {
  const appDataDir = opts.appDataDir ?? defaultAppDataDir();
  const db = openDb(opts.dbFile ?? path.join(appDataDir, 'studioflow.db'));
  const queue = new JobQueue({ db, backoffMs: opts.backoffMs });
  const providers = new ProviderRegistry();
  const graph = new BuilderRegistry();
  const gateway = createGateway({ appDataDir, permissionTimeoutMs: opts.permissionTimeoutMs });
  for (const t of [...jobTools(queue), ...graphTools({ queue, builders: graph })])
    gateway.register(t);
  defineGraphJob(queue, graph, (dir) => gateway.storeFor(dir));
  // TTS (006): provider mặc định, builder audio.line, tool voice/tts.
  const providerHandles = registerDefaultProviders(providers, { appDataDir });
  graph.registerBuilder('audio.line', audioLineBuilder({ providers, db, appDataDir }));
  const tts = {
    queue,
    builders: graph,
    providers,
    db,
    storeFor: (dir: string) => gateway.storeFor(dir),
  };
  for (const t of ttsTools(tts)) gateway.register(t);
  defineTtsJobs(tts, appDataDir);
  // ASR + caption (010)
  graph.registerBuilder('asr.line', asrLineBuilder({ providers, db, appDataDir }));
  graph.registerBuilder('captions', captionsBuilder);
  for (const t of asrTools(tts)) gateway.register(t);
  defineAsrJobs(tts, appDataDir);
  // Workflow (007)
  const workflows = new WorkflowService({
    dirs: opts.workflowDirs ?? defaultWorkflowDirs(appDataDir),
    providers,
    builders: graph,
    storeFor: (dir) => gateway.storeFor(dir),
    permissions: gateway.permissions,
    appDataDir,
  });
  for (const t of workflowTools(workflows)) gateway.register(t);
  // Text + refine-loop (009)
  const envMode = process.env.SF_LLM;
  const textMode =
    opts.textMode ?? (envMode === 'record' || envMode === 'replay' ? envMode : undefined);
  const textFixtureDir = opts.textFixtureDir ?? process.env.SF_LLM_FIXTURES;
  const text = createTextService({
    appDataDir,
    ...(opts.getSecret ? { getSecret: opts.getSecret } : {}),
    ...(textMode && textFixtureDir ? { mode: textMode, fixtureDir: textFixtureDir } : {}),
  });
  registerTextObjectives();
  workflows.registerExecutor('script', scriptExecutor({ text, permissions: gateway.permissions }));
  workflows.registerExecutor(
    'publish-meta',
    publishMetaExecutor({ text, permissions: gateway.permissions }),
  );
  if (opts.start !== false) {
    queue.recover();
    queue.start();
  }
  let closed = false;
  return {
    appDataDir,
    db,
    queue,
    providers,
    graph,
    gateway,
    workflows,
    text,
    close() {
      if (closed) return;
      closed = true;
      queue.stop();
      void providerHandles.stop();
      db.close();
    },
  };
}
