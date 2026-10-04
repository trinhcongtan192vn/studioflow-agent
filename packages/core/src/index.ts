// API công khai của @studioflow/core. apps/desktop chỉ được import từ đây (constitution Điều II).
export { getVersion, type VersionInfo } from './version.js';
export { SfError, isSfError } from './errors.js';
export type * from './contracts/types.js';

// Miền & artifact (002, D3)
export { ID_PREFIXES, newId, isId, type IdPrefix } from './domain/ids.js';
export { sha256, normalizeNewlines } from './domain/hash.js';
export { artifactKind, artifactSpec, type ArtifactKind } from './domain/artifacts.js';
export {
  validateArtifact,
  validateValue,
  type ValidationError,
  type ValidationResult,
} from './domain/validate.js';
export { crossCheckVideo } from './domain/crossref.js';
export {
  parseScript,
  serializeScript,
  assignScriptIds,
  toScriptDoc,
  type ParsedScript,
} from './domain/markdown/script.js';
export {
  parseStoryboard,
  serializeStoryboard,
  assignStoryboardIds,
  toStoryboardDoc,
  type ParsedStoryboard,
} from './domain/markdown/storyboard.js';
export { parseBlocksDoc, serializeBlocksDoc, type BlocksDoc } from './domain/markdown/blocks.js';
export { detectChannel, initChannel, type ChannelDetection } from './domain/channel.js';
export { createVideo, listVideoIds } from './domain/video.js';
export {
  MigrationRegistry,
  migrateVideo,
  scanVideo,
  defaultMigrations,
  type Migration,
} from './domain/migrate.js';

// Cấu hình theo tầng (D3 mục 7)
export {
  resolveConfig,
  setConfig,
  defaultAppDataDir,
  type ResolvedValue,
  type ConfigScope,
} from './config/resolve.js';
export { configKeySpec, checkConfigTier, type ConfigTier } from './config/keys.js';

// Module ghi (Điều VI)
export {
  WriteStore,
  type WriteLogEntry,
  type WriteResult,
  type WriteOptions,
} from './store/writer.js';

// Gateway (003, D4 mục 2, D5)
export * from './gateway/index.js';
export { maskSecrets, Logger, type LogSink, type LogLevel } from './log.js';

// Job, capability, cache, build graph (004, D4 mục 4–8)
export { openDb, type Db } from './store/db.js';
export {
  JobQueue,
  type QueuedJob,
  type JobContext,
  type JobKind,
  type EnqueueSpec,
} from './jobs/queue.js';
export { ProviderRegistry, type AnyAdapter, type ResolveScope } from './capability/registry.js';
export type { ProviderAdapter, RunContext, Span } from './capability/types.js';
export {
  runCapability,
  cacheKey,
  isCacheable,
  type RunCapabilityArgs,
  type RunCapabilityResult,
} from './capability/run.js';
export { evictCache } from './capability/cache.js';
export {
  BuildGraph,
  BuilderRegistry,
  type Builder,
  type BuilderContext,
  type BuildOutput,
  type BuildResult,
  type NodeState_,
  type NodeType,
  type PlannedNode,
} from './graph/graph.js';
export { assembleAudioLines, computeFrameTiming, type FrameTiming } from './graph/timing.js';
export { loadVideoModel, type VideoModel } from './graph/model.js';
export { createCore, type Core, type CoreOptions } from './core.js';
export { canonicalJson } from './domain/hash.js';

// Agent Runtime (005, D5)
export * from './agent/index.js';

// TTS (006)
export { PythonWorker } from './workers/client.js';
export * from './providers/index.js';
export { audioLineBuilder, voiceFile } from './tts/builder.js';
export { createVoiceProfile, speak, ttsTools, defineTtsJobs } from './tts/tools.js';

// Workflow Engine (007, D6)
export { satisfies } from './workflow/semver.js';
export {
  STEP_LIBRARY,
  validateManifest,
  executionOrder,
  type StepSpec,
  type ManifestError,
} from './workflow/library.js';
export {
  loadPack,
  loadPacks,
  defaultWorkflowDirs,
  APP_API,
  APP_PHASE,
  type WorkflowPack,
} from './workflow/packs.js';
export {
  evaluateGate,
  registerObjective,
  type GateResult,
  type GateContext,
} from './workflow/gates.js';
export {
  WorkflowEngine,
  type StepExecutor,
  type AgentStepRunner,
  type StepRunContext,
  type StepExecutorResult,
  type FrameCompletion,
} from './workflow/engine.js';
export { WorkflowService } from './workflow/service.js';
export { workflowTools } from './workflow/tools.js';
export {
  parseModelRef,
  resolveTextModels,
  assertDifferentModels,
  DEFAULT_MODELS,
  type ModelRef,
} from './text/models.js';
export { claudeTextProvider, openAICompatProvider, type TextProvider } from './text/providers.js';
export {
  createTextService,
  extractJson,
  type TextService,
  type TextServiceOptions,
} from './text/service.js';
export {
  buildPrompt,
  estimateTokens,
  loadPromptPack,
  bannedTerms,
  type PromptPack,
} from './text/prompts.js';
export { loadRubric, rubricShort } from './text/rubrics.js';
export {
  checkScript,
  checkMeta,
  objectiveContext,
  registerTextObjectives,
  type ObjectiveResult,
} from './text/objectives.js';
export { runRefine, refineSummary, type RefineDeps, type RefineResult } from './text/refine.js';
export { scriptExecutor, publishMetaExecutor, stripWrapping } from './text/executors.js';
export {
  alignWords,
  displayWords,
  normalizeTokens,
  normalizeWord,
  wordErrorRate,
  type TimedWord,
} from './asr/text.js';
export { buildCaptionGroups, captionsBuilder, type CaptionLineInput } from './asr/captions.js';
export {
  createHfTranscribeProvider,
  createFakeAsrProvider,
  parseTranscriptWords,
  whisperCli,
  whisperDir,
  type AsrAdapter,
  type AsrAlignInput,
  type AsrAlignOutput,
} from './asr/providers.js';
export { asrLineBuilder, type AsrLineMeta } from './asr/builder.js';
export { alignVideo, acceptLines, type AlignResult } from './asr/regen.js';
export { readAsrState, writeAsrState, type AsrState } from './asr/state.js';
export { asrTools, defineAsrJobs } from './asr/tools.js';
export { hfInstall, hfLint, hfCheck, runHf, pinnedHfVersion, type HfFinding } from './hf/cli.js';
export { sfIdsOf, checkFrameFile, type FrameFileProblem } from './hf/frame-file.js';
export { loadOutputProfile, DEFAULT_OUTPUT_PROFILE } from './hf/outputs.js';
export {
  buildIndexHtml,
  framePlacements,
  transitionSeconds,
  transitionRegistry,
  type IndexInput,
  type IndexFrame,
} from './hf/index-html.js';
export { buildCaptionsHtml, applyCaptionOverrides } from './hf/captions-html.js';
export {
  indexBuilder,
  ensureHfProject,
  groundColor,
  HYPERFRAMES_JSON,
} from './hf/index-builder.js';
export {
  buildFramePacket,
  frameInstruction,
  stageFrameAssets,
  readChannelAssets,
} from './hf/packet.js';
export {
  frameBuildExecutor,
  type FrameBuildDeps,
  type FrameBuildResult,
} from './hf/frame-build.js';
export { designSystemExecutor } from './hf/design-system.js';
export { imageInfo, type ImageInfo } from './assets/image-info.js';
export { importAsset, searchAssets, readManifest } from './assets/library.js';
export { assetTools } from './assets/tools.js';
export {
  createAudioAnalysisProvider,
  type AnalyzeInput,
  type MusicAnalysis,
} from './music/provider.js';
export {
  addTracks,
  appLibrary,
  readMusicManifest,
  trackById,
  recentVideoIds,
  markUsed,
  type MusicLibrary,
  type AddInput,
} from './music/library.js';
export { findMusic } from './music/find.js';
export {
  bedFfmpegArgs,
  duckExpression,
  mergeIntervals,
  renderBed,
  runFfmpeg,
  type BedInput,
  type MusicSegment,
} from './music/mix.js';
export { buildCredits } from './music/credits.js';
export { musicTools, defineMusicJobs } from './music/tools.js';
export { hfRender, killTree } from './render/hf-render.js';
export { finishVideo, measureLoudness, probeDurationMs } from './render/post.js';
export {
  renderVideo,
  releaseGates,
  creditsFor,
  newRenderId,
  markInterrupted,
  type RenderDeps,
  type RenderJobInput,
} from './render/render.js';
export { renderTools, defineRenderJob, renderExecutor } from './render/tools.js';
export {
  loadCatalog,
  installPlan,
  installEntry,
  entryStatus,
  recordInstalled,
  ffmpegPath,
  uvPath,
  ensureToolPaths,
  DEFAULT_SETTINGS,
  type CatalogEntry,
  type CatalogFile,
  type EntryStatus,
  type InstallProfile,
} from './models/install.js';
export { downloadFile, sha256File, extractZip, bsdtar } from './store/download.js';
export {
  secretGet,
  secretSet,
  secretDelete,
  secretHint,
  getSecretDefault,
  credTarget,
} from './secrets/credman.js';
export {
  attachTraceStore,
  withSpan,
  tracer,
  currentTraceparent,
  listTraces,
  getTrace,
  type SpanRow,
} from './trace/trace.js';
export { CoreHost } from './host/host.js';
export {
  UPLOAD_LIMIT,
  UPLOAD_TYPES,
  type IpcMethods,
  type IpcEvents,
  type IpcMethod,
  type IpcRequest,
  type IpcResponse,
  type IpcNotification,
  type ChatLine,
  type ExplorerNode,
  type HostControl,
} from './ipc/schema.js';
export { setHostSecrets } from './secrets/credman.js';
export { StudioPreviews, syncSnapshot, snapshotRel, snapshotMtime } from './studio/preview.js';
export { studioTools } from './studio/tools.js';
export { captionsExecutor, finalizeExecutor } from './workflow/finalize.js';
export { audioDurationCheck, beatDurations, type BeatDuration } from './workflow/duration.js';
export { ComfyServer, type ComfyServerOptions } from './comfy/server.js';
export { ComfyClient, type ComfyImageRef } from './comfy/client.js';
export {
  attachImages,
  fillWorkflow,
  keepAlpha,
  loadWorkflow,
  type ComfyWorkflow,
  type WorkflowVars,
} from './comfy/workflow.js';
export {
  buildQwenWorkflow,
  createQwen21ComfyProvider,
  qwenMode,
  snapSide,
  QWEN21_PACK,
  type QwenMode,
} from './image/qwen21-comfy.js';
export { createQwen20ApiProvider } from './image/qwen20-api.js';
export { createRemoveBgProvider } from './image/remove-bg.js';
export { createFakeImageProvider } from './image/fake.js';
export { solidPng } from './image/png.js';
export {
  editImage,
  generateImage,
  removeBackground,
  lookPrompt,
  type ImageResult,
} from './image/service.js';
export { defineImageJobs, imageTools } from './image/tools.js';
