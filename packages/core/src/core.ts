import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { asrLineBuilder } from './asr/builder.js';
import { assetTools } from './assets/tools.js';
import { defineImageJobs, imageTools } from './image/tools.js';
import { defineMusicJobs, musicTools } from './music/tools.js';
import { ensureToolPaths, installEntry, type InstallProfile } from './models/install.js';
import { attachTraceStore, type Pricing } from './trace/trace.js';
import { PhoenixServer } from './trace/phoenix.js';
import { Logger } from './log.js';
import { StudioPreviews } from './studio/preview.js';
import { captionsExecutor, finalizeExecutor } from './workflow/finalize.js';
import { assetsExecutor } from './workflow/assets.js';
import { storyboardExecutor } from './text/storyboard.js';
import { studioTools } from './studio/tools.js';
import { StudioEdits } from './studio/edit.js';
import { CaptionPanel } from './captions/panel.js';
import { defineFinishJobs, finishTools } from './finish/tools.js';
import { finishStepExecutor } from './finish/check.js';
import { animaticExecutor } from './render/animatic.js';
import { castExecutor } from './workflow/cast.js';
import './hf/safe-area.js';
import { PinnedDecider } from './studio/pinned.js';
import { defineRenderJob, renderExecutor, renderTools } from './render/tools.js';
import { designSystemExecutor } from './hf/design-system.js';
import { frameBuildExecutor } from './hf/frame-build.js';
import { indexBuilder } from './hf/index-builder.js';
import { captionsBuilder } from './asr/captions.js';
import { asrTools, defineAsrJobs } from './asr/tools.js';
import { ProviderRegistry } from './capability/registry.js';
import { defaultAppDataDir, resolveAppConfig } from './config/resolve.js';
import { getGpuScheduler, setGpuScheduler } from './capability/run.js';
import { GpuScheduler } from './jobs/gpu.js';
import { DISK_MIN_BYTES, diskSpace } from './disk/usage.js';
import { enforceCacheBudget } from './disk/clean.js';
import { createGateway, type Gateway } from './gateway/index.js';
import { BuilderRegistry } from './graph/graph.js';
import { defineGraphJob, graphTools } from './graph/tools.js';
import { JobQueue } from './jobs/queue.js';
import { jobTools } from './jobs/tools.js';
import { registerDefaultProviders } from './providers/index.js';
import type { TextEmbedder } from './music/clap.js';
import { openDb, type Db } from './store/db.js';
import { audioLineBuilder, audioLinePlanner } from './tts/builder.js';
import { assetBuilder, assetPlanner } from './image/asset-builder.js';
import { frameHtmlBuilder } from './hf/frame-builder.js';
import { creditsBuilder, renderBuilder, renderPlanner } from './render/graph-builders.js';
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
  /** Ngưỡng đĩa tối thiểu cho job sinh/render (024, FN-024: 5 GB). */
  diskMinBytes?: number;
  /** Cửa sổ gom `graph.build` từ chat (019); mặc định `SF_BATCH_WINDOW_MS` hoặc 3 000 ms. */
  batchWindowMs?: number;
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
  /** Studio xem trước (017). */
  studio: StudioPreviews;
  /** Studio chế độ chỉnh (025). */
  edits: StudioEdits;
  /** Frame ghim lỗi thời (025). */
  pinned: PinnedDecider;
  /** Bảng caption (026). */
  captions: CaptionPanel;
  /** Phoenix cục bộ (028). */
  phoenix: PhoenixServer;
  /** Embedding văn bản CLAP cho tìm nhạc (021). */
  embedder?: TextEmbedder;
  close(): void;
}

/**
 * Lắp các dịch vụ của tiến trình `core` (D4 mục 1): DB, hàng đợi job, provider, build graph,
 * Gateway với tool nền + `job.*` + `graph.*`.
 */
export function createCore(opts: CoreOptions = {}): Core {
  const appDataDir = opts.appDataDir ?? defaultAppDataDir();
  const db = openDb(opts.dbFile ?? path.join(appDataDir, 'studioflow.db'));
  // trace cục bộ (D11, 015): span ghi vào bảng `spans`; giữ `settings.trace.retention_days`
  // 028: bảng `usage` ghi từ span; giá ước tính theo `settings.pricing` (đọc lúc ghi)
  const detachTrace = attachTraceStore(db, retentionDays(appDataDir), {
    pricing: () => (traceSettings(appDataDir).pricing ?? []) as Pricing,
  });
  // Phoenix cục bộ (FR-OB-04) khi `settings.trace.phoenix_enabled`
  const phoenix = new PhoenixServer(appDataDir);
  if (traceSettings(appDataDir).trace?.phoenix_enabled)
    phoenix.enable().catch((e: unknown) =>
      new Logger().write('warn', 'sf.phoenix', {
        code: 'E_PHOENIX_UNAVAILABLE',
        msg: String((e as Error).message),
      }),
    );
  const providers = new ProviderRegistry();
  // lịch GPU (019, D4 mục 6): engine → lớp tài nguyên từ manifest provider; ngân sách tầng app
  const gpu = new GpuScheduler({
    resourceOf: (e) => {
      if (e === 'render') return 'gpu-light';
      const r = providers.forEngine(e).map((a) => a.manifest.resource);
      return r.includes('gpu-heavy')
        ? 'gpu-heavy'
        : r.includes('gpu-light')
          ? 'gpu-light'
          : undefined;
    },
    budgetOf: (e) => Number(resolveAppConfig(`gpu.vram_budget_gb.${e}`, { appDataDir })) || 0,
    total: () => Number(resolveAppConfig('gpu.vram_total_gb', { appDataDir })) || 0,
    holdsVram: (e) => providers.forEngine(e).some((a) => a.release),
    release: async (e) => {
      await Promise.all(providers.forEngine(e).map((a) => a.release?.('offload')));
    },
  });
  setGpuScheduler(gpu);
  const diskMin = opts.diskMinBytes ?? DISK_MIN_BYTES;
  const queue = new JobQueue({
    db,
    backoffMs: opts.backoffMs,
    gpu,
    diskLow: (job) => diskSpace(job.channel_dir ?? appDataDir).free_bytes < diskMin,
  });
  const graph = new BuilderRegistry();
  const gateway = createGateway({ appDataDir, permissionTimeoutMs: opts.permissionTimeoutMs });
  // hạn mức cache kênh sau mỗi job (D4 mục 7, 024): tối đa 1 lần/phút mỗi kênh
  const trimmed = new Map<string, number>();
  queue.on('job.updated', (j: { id: string; status: string }) => {
    if (!['succeeded', 'failed', 'partial'].includes(j.status)) return;
    const dir = queue.get(j.id)?.channel_dir;
    if (!dir || Date.now() - (trimmed.get(dir) ?? 0) < 60_000) return;
    trimmed.set(dir, Date.now());
    try {
      enforceCacheBudget({ db, store: gateway.storeFor(dir), appDataDir });
    } catch {
      /* cấu hình kênh lỗi: channel.validate báo */
    }
  });
  const batchWindowMs = opts.batchWindowMs ?? Number(process.env.SF_BATCH_WINDOW_MS ?? 3000);
  for (const t of [...jobTools(queue), ...graphTools({ queue, builders: graph, batchWindowMs })])
    gateway.register(t);
  defineGraphJob(queue, graph, (dir) => gateway.storeFor(dir));
  // TTS (006): provider mặc định, builder audio.line, tool voice/tts.
  const providerHandles = registerDefaultProviders(providers, { appDataDir });
  graph.registerBuilder('audio.line', audioLineBuilder({ providers, db, appDataDir }));
  graph.registerPlanner('audio.line', audioLinePlanner({ providers }));
  const tts = {
    queue,
    builders: graph,
    providers,
    db,
    storeFor: (dir: string) => gateway.storeFor(dir),
    batchWindowMs,
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
    opts.textMode ??
    (envMode === 'record' || envMode === 'replay' ? envMode : undefined) ??
    // test (D12): không gọi LLM thật ngoài test live
    (process.env.SF_TEXT_MODE === 'replay' ? 'replay' : undefined);
  const textFixtureDir =
    opts.textFixtureDir ?? process.env.SF_LLM_FIXTURES ?? path.join(appDataDir, 'llm-fixtures');
  const text = createTextService({
    appDataDir,
    ...(opts.getSecret ? { getSecret: opts.getSecret } : {}),
    ...(textMode && textFixtureDir ? { mode: textMode, fixtureDir: textFixtureDir } : {}),
  });
  registerTextObjectives();
  // HyperFrames adapter, frame build, asset (011)
  graph.registerBuilder('index', indexBuilder({ appDataDir }));
  for (const t of assetTools()) gateway.register(t);
  // Ảnh (018): image.generate / image.edit / image.remove_bg
  for (const t of imageTools(tts)) gateway.register(t);
  defineImageJobs(tts, appDataDir);
  // Build graph đầy đủ (020): asset, frame_html (dựng lại bằng phiên frame khi có runtime), credits, render
  graph.registerBuilder('asset', assetBuilder({ providers, db, appDataDir }));
  graph.registerPlanner('asset', assetPlanner({ providers, appDataDir }));
  graph.registerBuilder(
    'frame_html',
    frameHtmlBuilder({
      rebuild: () => (workflows.agentRuntime ? workflows.rebuildFrame : undefined),
      appDataDir,
    }),
  );
  graph.registerBuilder('credits', creditsBuilder({ appDataDir }));
  graph.registerBuilder('render', renderBuilder({ builders: graph, appDataDir }));
  graph.registerPlanner('render', renderPlanner);
  // Kho nhạc (012)
  for (const t of musicTools(tts, appDataDir, providerHandles.embedder)) gateway.register(t);
  defineMusicJobs(tts, appDataDir);
  // Trình quản lý model (014): công cụ đã tải vào PATH; job `download` cài một thành phần
  ensureToolPaths(appDataDir);
  queue.define('download', {
    engine: 'download',
    idempotent: true,
    run: async (job, ctx) => {
      const p = job.payload as { key: string; profile?: InstallProfile; accept_license?: boolean };
      return installEntry(appDataDir, p.key, {
        signal: ctx.signal,
        progress: ctx.progress,
        ...(p.profile ? { profile: p.profile } : {}),
        ...(p.accept_license ? { acceptLicense: true } : {}),
      });
    },
  });
  // Studio xem trước (017)
  const studio = new StudioPreviews();
  // Studio chế độ chỉnh + frame ghim (025)
  const edits = new StudioEdits({ queue, builders: graph, appDataDir });
  const pinned = new PinnedDecider({
    builders: graph,
    appDataDir,
    rebuild: () => (workflows.agentRuntime ? workflows.rebuildFrame : undefined),
  });
  for (const t of studioTools(studio, edits, pinned)) gateway.register(t);
  // Look, hiệu ứng, overlay (027)
  defineFinishJobs({ queue, storeFor: (d) => gateway.storeFor(d) }, appDataDir);
  for (const t of finishTools({ queue, storeFor: (d) => gateway.storeFor(d) })) gateway.register(t);
  // Render (013)
  for (const t of renderTools(tts)) gateway.register(t);
  defineRenderJob(tts, appDataDir);
  workflows.registerExecutor('render', renderExecutor(graph));
  // narrated-explainer (016): bước engine còn lại
  workflows.registerExecutor('captions', captionsExecutor(graph));
  for (const k of ['look', 'effects', 'overlays'] as const)
    workflows.registerExecutor(k, finishStepExecutor(k));
  workflows.registerExecutor('finalize', finalizeExecutor(graph));
  workflows.registerExecutor('animatic', animaticExecutor(graph));
  workflows.registerExecutor('cast', castExecutor());
  workflows.registerExecutor('design-system', designSystemExecutor());
  // story-documentary (023): storyboard refine (phiên producer) + assets (nút asset)
  workflows.registerExecutor(
    'storyboard',
    storyboardExecutor({
      text,
      gateway,
      runtime: () => workflows.agentRuntime,
      permissions: gateway.permissions,
    }),
  );
  workflows.registerExecutor('assets', assetsExecutor(graph));
  workflows.registerExecutor(
    'frame-build',
    frameBuildExecutor({ builders: graph, gateway, runtime: () => workflows.agentRuntime }),
  );
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
    studio,
    edits,
    pinned,
    captions: new CaptionPanel(gateway),
    phoenix,
    ...(providerHandles.embedder ? { embedder: providerHandles.embedder } : {}),
    close() {
      if (closed) return;
      closed = true;
      studio.closeAll();
      phoenix.stop();
      void edits.closeAll();
      detachTrace();
      if (getGpuScheduler() === gpu) setGpuScheduler(undefined);
      queue.stop();
      void providerHandles.stop();
      db.close();
    },
  };
}

function traceSettings(appDataDir: string): {
  trace?: { phoenix_enabled?: boolean };
  pricing?: unknown[];
} {
  const f = path.join(appDataDir, 'settings.json');
  try {
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  } catch {
    return {};
  }
}

function retentionDays(appDataDir: string): number {
  const f = path.join(appDataDir, 'settings.json');
  if (!existsSync(f)) return 30;
  return (
    (JSON.parse(readFileSync(f, 'utf8')) as { trace?: { retention_days?: number } }).trace
      ?.retention_days ?? 30
  );
}
