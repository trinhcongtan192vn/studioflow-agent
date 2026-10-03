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
