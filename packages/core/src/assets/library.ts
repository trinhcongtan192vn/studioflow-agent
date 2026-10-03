import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AssetManifest } from '../contracts/types.js';
import { sha256 } from '../domain/hash.js';
import { newId } from '../domain/ids.js';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';
import { imageInfo } from './image-info.js';

type Asset = AssetManifest['assets'][number];
const MANIFEST = 'assets/manifest.json';

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);
const AUDIO_EXT = new Set(['.wav', '.mp3', '.m4a', '.ogg', '.flac']);

export function readManifest(store: WriteStore): AssetManifest {
  const f = store.abs(MANIFEST);
  return existsSync(f)
    ? (JSON.parse(readFileSync(f, 'utf8')) as AssetManifest)
    : { schema_version: 1, assets: [] };
}

/**
 * `asset.import` (D4 mục 2.4): file trong `uploads/` → thư viện kênh `assets/files/<as_id>.<ext>` +
 * `assets/manifest.json`; có video → chép vào `public/<as_id>.<ext>` (011 R6).
 */
export function importAsset(
  store: WriteStore,
  input: { path: string; tags?: string[]; description?: string; videoId?: string },
): { asset_id: string; file: string; public?: string } {
  const rel = input.path.replaceAll('\\', '/');
  if (!/(^|\/)uploads\//.test(rel))
    throw new SfError(
      'E_PATH_OUTSIDE',
      `asset.import only takes files under uploads/: ${input.path}`,
    );
  if (!existsSync(store.abs(rel)))
    throw new SfError('E_FILE_NOT_FOUND', `${input.path} does not exist`);
  const buf = readFileSync(store.abs(rel));
  const ext = path.extname(rel).toLowerCase();
  const info = imageInfo(buf);
  const kind: Asset['kind'] | undefined =
    info?.kind ?? (VIDEO_EXT.has(ext) ? 'video' : AUDIO_EXT.has(ext) ? 'audio' : undefined);
  if (!kind)
    throw new SfError(
      'E_SCHEMA_INVALID',
      `${input.path}: unsupported asset type (image, svg, video or audio)`,
    );
  const m = readManifest(store);
  const hash = sha256(buf);
  const dup = m.assets.find((a) => a.hash === hash);
  const id = dup?.id ?? newId('as', new Set(m.assets.map((a) => a.id)));
  const file = dup?.file ?? `assets/files/${id}${ext}`;
  if (!dup) {
    store.copyWithin(rel, file, { by: 'asset.import' });
    m.assets.push({
      id: id as Asset['id'],
      file,
      kind,
      ...(info ? { width: info.width, height: info.height, alpha: info.alpha } : {}),
      tags: input.tags ?? [],
      ...(input.description ? { description: input.description } : {}),
      source: { kind: 'user_import' },
      hash,
      created_at: new Date().toISOString(),
    });
    store.write(MANIFEST, `${JSON.stringify(m, null, 2)}\n`, { by: 'asset.import' });
  }
  let pub: string | undefined;
  if (input.videoId) {
    pub = `public/${id}${ext}`;
    const dest = `videos/${input.videoId}/${pub}`;
    if (!existsSync(store.abs(dest))) store.copyWithin(file, dest, { by: 'asset.import' });
  }
  return { asset_id: id, file, ...(pub ? { public: pub } : {}) };
}

const norm = (s: string) => s.normalize('NFC').toLowerCase();

/** `asset.search` (D4 mục 2.4): khớp tag (trọng số 3), mô tả (2), tên file (1); tag lọc bắt buộc. */
export function searchAssets(
  store: WriteStore,
  input: { query: string; tags?: string[]; limit?: number },
): { assets: (Asset & { score: number })[] } {
  const words = norm(input.query).split(/\s+/).filter(Boolean);
  const must = (input.tags ?? []).map(norm);
  const out = readManifest(store)
    .assets.filter((a) => must.every((t) => a.tags.map(norm).includes(t)))
    .map((a) => {
      const tags = a.tags.map(norm).join(' ');
      const desc = norm(a.description ?? '');
      const name = norm(path.basename(a.file));
      const score = words.reduce(
        (s, w) =>
          s + (tags.includes(w) ? 3 : 0) + (desc.includes(w) ? 2 : 0) + (name.includes(w) ? 1 : 0),
        0,
      );
      return { ...a, score };
    })
    .filter((a) => a.score > 0 || words.length === 0)
    .sort((a, b) => b.score - a.score);
  return { assets: out.slice(0, input.limit ?? 20) };
}
