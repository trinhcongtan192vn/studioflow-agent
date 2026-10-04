import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { sha256 } from '../domain/hash.js';
import type { WriteStore } from '../store/writer.js';

/** File được theo dõi (tương đối video): artifact nguồn + file cảnh (FR-WS-06, 025). */
const TRACKED =
  /^(SCRIPT\.md|STORYBOARD\.md|BRIEF\.md|CAST\.md|index\.html|hyperframes\.json|frame\.md|caption-overrides\.json|compositions\/.+)$/;

export const externalRel = (videoId: string) => `videos/${videoId}/.sf/external.json`;

export interface ExternalChanges {
  schema_version: 1;
  files: Record<string, { hash: string; at: string }>;
}

export function readExternal(store: WriteStore, videoId: string): ExternalChanges {
  const f = store.abs(externalRel(videoId));
  try {
    return existsSync(f)
      ? (JSON.parse(readFileSync(f, 'utf8')) as ExternalChanges)
      : { schema_version: 1, files: {} };
  } catch {
    return { schema_version: 1, files: {} };
  }
}

function list(dir: string, rel = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? list(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`],
  );
}

/**
 * File watcher (D9 3.6, FR-WS-06): file theo dõi đổi mà nội dung khác lần ghi gần nhất của module ghi →
 * ghi `.sf/external.json`, gọi `onChange`; module ghi ghi lại file đó → bỏ đánh dấu.
 */
export function watchVideo(
  store: WriteStore,
  videoId: string,
  onChange: (rel: string) => void,
): { close(): void } {
  const vDir = store.abs(`videos/${videoId}`);
  const prefix = `videos/${videoId}/`;
  const known = new Map<string, string>();
  for (const f of list(vDir).filter((x) => TRACKED.test(x)))
    known.set(f, sha256(readFileSync(path.join(vDir, f))));
  const save = (ext: ExternalChanges) =>
    store.write(externalRel(videoId), `${JSON.stringify(ext, null, 2)}\n`, {
      by: 'watcher',
      validate: false,
    });
  const unsubscribe = store.subscribe((rel, hash) => {
    if (!rel.startsWith(prefix)) return;
    const inner = rel.slice(prefix.length);
    if (!TRACKED.test(inner)) return;
    known.set(inner, hash);
    const ext = readExternal(store, videoId);
    if (ext.files[inner]) {
      delete ext.files[inner];
      save(ext);
    }
  });
  const timers = new Map<string, NodeJS.Timeout>();
  let w: FSWatcher | undefined;
  try {
    w = watch(vDir, { recursive: true }, (_ev, file) => {
      const inner = String(file ?? '').replaceAll('\\', '/');
      if (!TRACKED.test(inner)) return;
      clearTimeout(timers.get(inner));
      timers.set(
        inner,
        setTimeout(() => {
          const abs = path.join(vDir, inner);
          if (!existsSync(abs) || statSync(abs).isDirectory()) return;
          const h = sha256(readFileSync(abs));
          if (known.get(inner) === h) return;
          known.set(inner, h);
          const ext = readExternal(store, videoId);
          ext.files[inner] = { hash: h, at: new Date().toISOString() };
          save(ext);
          onChange(inner);
        }, 200),
      );
    });
  } catch {
    /* hệ thống không hỗ trợ theo dõi đệ quy → không cảnh báo */
  }
  return {
    close() {
      unsubscribe();
      for (const t of timers.values()) clearTimeout(t);
      w?.close();
    },
  };
}
