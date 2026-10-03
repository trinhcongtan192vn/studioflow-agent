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
  type NodeStatus,
  type NodeType,
  type PlannedJob,
} from './graph/graph.js';
export { assembleAudioLines, computeFrameTiming, type FrameTiming } from './graph/timing.js';
export { loadVideoModel, type VideoModel } from './graph/model.js';
export { createCore, type Core, type CoreOptions } from './core.js';
export { canonicalJson } from './domain/hash.js';

// Agent Runtime (005, D5)
export * from './agent/index.js';
