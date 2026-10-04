import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProviderRegistry } from '../capability/registry.js';
import { runCapability } from '../capability/run.js';
import type { MusicManifest, MusicTrack, VideoState } from '../contracts/types.js';
import { sha256 } from '../domain/hash.js';
import { newId } from '../domain/ids.js';
import { isSfError, SfError } from '../errors.js';
import type { Db } from '../store/db.js';
import { WriteStore } from '../store/writer.js';
import type { MusicAnalysis } from './provider.js';

export const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg']);

/** Một kho nhạc: `<root>/music/` (D8 mục 1) — kênh (qua module ghi) hoặc app (ghi nội bộ). */
export interface MusicLibrary {
  scope: 'channel' | 'app';
  store: WriteStore;
}

export function appLibrary(appDataDir: string): MusicLibrary {
  return { scope: 'app', store: new WriteStore(appDataDir) };
}

export function readMusicManifest(lib: MusicLibrary): MusicManifest {
  const f = lib.store.abs('music/manifest.json');
  return existsSync(f)
    ? (JSON.parse(readFileSync(f, 'utf8')) as MusicManifest)
    : { schema_version: 1, tracks: [] };
}

export function writeMusicManifest(lib: MusicLibrary, m: MusicManifest): void {
  lib.store.write('music/manifest.json', `${JSON.stringify(m, null, 2)}\n`, {
    by: 'music.library',
  });
}

export interface AddInput {
  /** Đường dẫn tương đối kênh (trong `uploads/`). */
  files: string[];
  scope: 'channel' | 'app';
  kind?: 'music' | 'sfx';
  source?: string;
  url?: string;
  attribution?: string;
  tags?: string[];
  description?: string;
}

/**
 * `music.library.add` (D8 mục 2.1): chép file vào `music/files/<mt>.<ext>`, phân tích (`music.analyze`,
 * cache theo hash), ghi `manifest.json`. Trùng hash → trả bài có sẵn.
 */
export async function addTracks(
  d: { channel: WriteStore; appDataDir: string; providers: ProviderRegistry; db?: Db },
  input: AddInput,
  opts: { signal?: AbortSignal; progress?: (done: number, total: number) => void } = {},
): Promise<{ track_ids: string[]; skipped: { file: string; reason: string }[] }> {
  const lib: MusicLibrary =
    input.scope === 'app' ? appLibrary(d.appDataDir) : { scope: 'channel', store: d.channel };
  const m = readMusicManifest(lib);
  const adapter = await d.providers.resolve('music.analyze', {
    channelDir: d.channel.root,
    appDataDir: d.appDataDir,
  });
  const track_ids: string[] = [];
  const skipped: { file: string; reason: string }[] = [];
  for (const [n, rel] of input.files.entries()) {
    opts.progress?.(n, input.files.length);
    const norm = rel.replaceAll('\\', '/');
    const ext = path.extname(norm).toLowerCase();
    if (!/(^|\/)uploads\//.test(norm)) {
      skipped.push({ file: rel, reason: 'E_PATH_OUTSIDE: only files under uploads/' });
      continue;
    }
    if (!existsSync(d.channel.abs(norm))) {
      skipped.push({ file: rel, reason: 'E_FILE_NOT_FOUND' });
      continue;
    }
    if (!AUDIO_EXT.has(ext)) {
      skipped.push({ file: rel, reason: `E_AUDIO_UNSUPPORTED: ${ext || 'no extension'}` });
      continue;
    }
    const buf = readFileSync(d.channel.abs(norm));
    const hash = sha256(buf);
    const dup = m.tracks.find((t) => t.hash === hash);
    if (dup) {
      track_ids.push(dup.id);
      continue;
    }
    let analysis: MusicAnalysis;
    try {
      const r = await runCapability({
        store: d.channel,
        db: d.db,
        adapter,
        capability: 'music.analyze',
        input: { file: d.channel.abs(norm), hash },
        outputs: {},
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      analysis = r.output as MusicAnalysis;
    } catch (e) {
      skipped.push({ file: rel, reason: isSfError(e) ? `${e.code}: ${e.message}` : String(e) });
      continue;
    }
    const id = newId('mt', new Set(m.tracks.map((t) => t.id)));
    const file = `files/${id}${ext}`;
    lib.store.write(`music/${file}`, buf, { by: 'music.library', validate: false });
    const track: MusicTrack = {
      id: id as MusicTrack['id'],
      kind: input.kind ?? (analysis.duration_ms < 10_000 ? 'sfx' : 'music'),
      file,
      original_name: path.basename(norm),
      hash,
      ...(input.source ? { source: input.source } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.attribution ? { attribution: input.attribution } : {}),
      tags: (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
      ...(input.description ? { description: input.description } : {}),
      title: path.basename(norm, ext).replace(/^[0-9a-f-]{36}$/i, '') || undefined,
      analysis,
      added_at: new Date().toISOString(),
      used_in: [],
    } as MusicTrack;
    if (!track.title) delete track.title;
    // 021: embedding CLAP (tùy chọn — không có CLAP thì tìm theo từ khóa như 012)
    const emb = await embedTrack(d, lib, track, opts.signal);
    if (emb) track.embedding = emb;
    m.tracks.push(track);
    writeMusicManifest(lib, m);
    track_ids.push(id);
  }
  opts.progress?.(input.files.length, input.files.length);
  return { track_ids, skipped };
}

/**
 * Embedding CLAP một bài (021): `music.embed` (cache theo hash) → `music/.index/<mt>.npy` của kho.
 * CLAP chưa cài/lỗi → undefined (không chặn việc nạp).
 */
export async function embedTrack(
  d: { channel: WriteStore; appDataDir: string; providers: ProviderRegistry; db?: Db },
  lib: MusicLibrary,
  track: Pick<MusicTrack, 'id' | 'file' | 'hash'>,
  signal?: AbortSignal,
): Promise<MusicTrack['embedding'] | undefined> {
  let adapter;
  try {
    adapter = await d.providers.resolve('music.embed', {
      channelDir: d.channel.root,
      appDataDir: d.appDataDir,
    });
  } catch {
    return undefined;
  }
  const vector_file = `.index/${track.id}.npy`;
  try {
    const r = await runCapability({
      store: lib.store,
      db: d.db,
      adapter,
      capability: 'music.embed',
      input: { file: lib.store.abs(`music/${track.file}`), hash: track.hash },
      outputs: { file: `music/${vector_file}` },
      ...(signal ? { signal } : {}),
    });
    return {
      model: String((r.output as { model?: string }).model ?? adapter.manifest.id),
      vector_file,
    };
  } catch {
    return undefined;
  }
}

/** `sf music reindex`: embedding cho bài chưa có (021). */
export async function embedMissing(
  d: { channel: WriteStore; appDataDir: string; providers: ProviderRegistry; db?: Db },
  scope: 'channel' | 'app',
  opts: { signal?: AbortSignal; progress?: (done: number, total: number) => void } = {},
): Promise<{ embedded: string[]; skipped: string[] }> {
  const lib: MusicLibrary =
    scope === 'app' ? appLibrary(d.appDataDir) : { scope: 'channel', store: d.channel };
  const m = readMusicManifest(lib);
  const todo = m.tracks.filter(
    (t) => !t.embedding || !existsSync(lib.store.abs(`music/${t.embedding.vector_file}`)),
  );
  const embedded: string[] = [];
  const skipped: string[] = [];
  for (const [i, t] of todo.entries()) {
    opts.progress?.(i, todo.length);
    const e = await embedTrack(d, lib, t, opts.signal);
    if (e) {
      t.embedding = e;
      embedded.push(t.id);
    } else skipped.push(t.id);
  }
  if (embedded.length) writeMusicManifest(lib, m);
  opts.progress?.(todo.length, todo.length);
  return { embedded, skipped };
}

/** Tìm bài theo id trong hai kho; trả cả đường dẫn tuyệt đối. */
export function trackById(
  channel: WriteStore,
  appDataDir: string,
  id: string,
): { track: MusicTrack; abs: string; lib: MusicLibrary } | undefined {
  for (const lib of [
    { scope: 'channel', store: channel } as MusicLibrary,
    appLibrary(appDataDir),
  ]) {
    const t = readMusicManifest(lib).tracks.find((x) => x.id === id);
    if (t) return { track: t, abs: lib.store.abs(`music/${t.file}`), lib };
  }
  return undefined;
}

/** 5 video gần nhất của kênh (theo `created_at`) — cho phạt dùng gần đây (FN-012). */
export function recentVideoIds(channelDir: string, n = 5): string[] {
  const dir = path.join(channelDir, 'videos');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((id) => {
      const f = path.join(dir, id, 'state.json');
      if (!existsSync(f)) return undefined;
      return { id, at: (JSON.parse(readFileSync(f, 'utf8')) as VideoState).created_at };
    })
    .filter((x): x is { id: string; at: string } => Boolean(x))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, n)
    .map((x) => x.id);
}

/** Ghi `used_in` (khi index dùng bài). */
export function markUsed(lib: MusicLibrary, trackId: string, videoId: string): void {
  const m = readMusicManifest(lib);
  const t = m.tracks.find((x) => x.id === trackId);
  if (!t || t.used_in.includes(videoId as never)) return;
  t.used_in.push(videoId as never);
  writeMusicManifest(lib, m);
}

export function assertTracks(found: unknown[], what: string): void {
  if (!found.length) throw new SfError('E_MUSIC_NOT_FOUND', what);
}
