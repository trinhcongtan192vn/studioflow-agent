import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';
import { artifactSpec, type ArtifactKind } from './artifacts.js';
import { parseBlocksDoc, serializeBlocksDoc } from './markdown/blocks.js';

export interface Migration {
  kind: ArtifactKind;
  /** Phiên bản nguồn; đích = from + 1. */
  from: number;
  /** Hàm thuần: JSON → JSON; Markdown nhận/trả `{ front }`. */
  fn: (doc: Record<string, unknown>) => Record<string, unknown>;
}

/** Registry `migrate_<artifact>_<n>_to_<n+1>` (D3 mục 8). */
export class MigrationRegistry {
  private readonly byKind = new Map<ArtifactKind, Map<number, Migration>>();

  register(m: Migration): void {
    const chain = this.byKind.get(m.kind) ?? new Map<number, Migration>();
    if (chain.has(m.from)) throw new Error(`duplicate migration ${m.kind} ${m.from}→${m.from + 1}`);
    chain.set(m.from, m);
    this.byKind.set(m.kind, chain);
  }

  /** Phiên bản hiện tại app hỗ trợ cho loại artifact (bắt đầu 1). */
  current(kind: ArtifactKind): number {
    let v = 1;
    const chain = this.byKind.get(kind);
    while (chain?.has(v)) v++;
    return v;
  }

  step(kind: ArtifactKind, from: number): Migration | undefined {
    return this.byKind.get(kind)?.get(from);
  }
}

/** Registry của app: hiện mọi artifact ở phiên bản 1, chưa có migration. */
export const defaultMigrations = new MigrationRegistry();

interface Found {
  rel: string;
  kind: ArtifactKind;
  format: 'json' | 'md';
  version: number;
}

function walk(dir: string, rel = ''): string[] {
  return readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return e.name === '.sf' ? [] : walk(dir, r);
    return [r];
  });
}

/** Phiên bản schema của mọi artifact trong video. */
export function scanVideo(store: WriteStore, videoId: string): Found[] {
  const vRel = `videos/${videoId}`;
  const dir = store.abs(vRel);
  if (!existsSync(dir)) throw new SfError('E_ID_UNKNOWN', `video ${videoId} not found`);
  const found: Found[] = [];
  for (const inner of walk(dir)) {
    const rel = `${vRel}/${inner}`;
    const spec = artifactSpec(rel);
    if (!spec) continue;
    const text = readFileSync(path.join(dir, ...inner.split('/')), 'utf8');
    let version: unknown;
    try {
      version =
        spec.format === 'json'
          ? JSON.parse(text).schema_version
          : parseBlocksDoc(text).front.schema_version;
    } catch {
      continue; // file hỏng: validate sẽ báo; migration bỏ qua
    }
    if (typeof version === 'number')
      found.push({ rel, kind: spec.kind, format: spec.format, version });
  }
  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

export interface MigrationReport {
  dry_run: boolean;
  migrated: { path: string; from: number; to: number; backup?: string }[];
}

/**
 * FR-WS-05: sao lưu → chạy lần lượt migration → kiểm schema → ghi. Phiên bản mới hơn app → lỗi
 * `E_SCHEMA_TOO_NEW` (mở chỉ đọc), không ghi gì.
 */
export function migrateVideo(
  store: WriteStore,
  videoId: string,
  opts: { registry?: MigrationRegistry; dryRun?: boolean } = {},
): MigrationReport {
  const registry = opts.registry ?? defaultMigrations;
  const found = scanVideo(store, videoId);
  const tooNew = found.filter((f) => f.version > registry.current(f.kind));
  if (tooNew.length) {
    throw new SfError(
      'E_SCHEMA_TOO_NEW',
      `${tooNew[0]!.rel} has schema_version ${tooNew[0]!.version} > supported ${registry.current(tooNew[0]!.kind)}; opening read-only`,
      tooNew.map((f) => ({ path: f.rel, version: f.version, supported: registry.current(f.kind) })),
    );
  }
  const todo = found.filter((f) => f.version < registry.current(f.kind));
  const plan = todo.map((f) => ({ path: f.rel, from: f.version, to: registry.current(f.kind) }));
  if (opts.dryRun) return { dry_run: true, migrated: plan };
  const migrated: MigrationReport['migrated'] = [];
  for (const f of todo) {
    const text = readFileSync(store.abs(f.rel), 'utf8');
    let content: string;
    if (f.format === 'json') {
      let doc = JSON.parse(text) as Record<string, unknown>;
      for (let v = f.version; v < registry.current(f.kind); v++)
        doc = registry.step(f.kind, v)!.fn(doc);
      content = `${JSON.stringify(doc, null, 2)}\n`;
    } else {
      const parsed = parseBlocksDoc(text);
      let doc: Record<string, unknown> = { front: parsed.front };
      for (let v = f.version; v < registry.current(f.kind); v++)
        doc = registry.step(f.kind, v)!.fn(doc);
      parsed.front = doc.front as Record<string, unknown>;
      content = serializeBlocksDoc(parsed);
    }
    const r = store.write(f.rel, content, { by: 'migration', backup: 'always' });
    migrated.push({
      path: f.rel,
      from: f.version,
      to: registry.current(f.kind),
      ...(r.backup ? { backup: r.backup } : {}),
    });
  }
  return { dry_run: false, migrated };
}
