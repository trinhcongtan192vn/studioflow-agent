import { withSpan } from '../trace/trace.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { SfError } from '../errors.js';
import { Logger } from '../log.js';
import type { GpuScheduler } from '../jobs/gpu.js';
import { getSecretDefault } from '../secrets/credman.js';
import type { Db } from '../store/db.js';
import { splitVideoPath } from '../store/paths.js';
import { createScratchDir } from '../store/scratch.js';
import type { WriteStore } from '../store/writer.js';
import type { ProviderAdapter } from './types.js';

export interface CacheKeyInput {
  capability: string;
  contract_version: string;
  provider_id: string;
  provider_version: string;
  model_file_hash: string | null;
  input: unknown;
  seed: number | null;
}

let gpuScheduler: GpuScheduler | undefined;

/** Lịch GPU dùng chung của tiến trình core (019): mọi lời gọi provider có `engine` GPU lấy lease. */
export function setGpuScheduler(s: GpuScheduler | undefined): void {
  gpuScheduler = s;
}

export function getGpuScheduler(): GpuScheduler | undefined {
  return gpuScheduler;
}

/** Khóa cache (D4 mục 7). */
export function cacheKey(parts: CacheKeyInput): string {
  return sha256(canonicalJson(parts));
}

/** `text.*` chỉ cache khi temperature = 0; `render.video` không cache (D4 mục 7). */
export function isCacheable(capability: string, input: unknown): boolean {
  if (capability === 'render.video') return false;
  if (capability.startsWith('text.')) return (input as { temperature?: number })?.temperature === 0;
  return true;
}

/** Phần khóa cache của một lần chạy (D4 mục 7). */
export function cacheKeyParts<I>(
  adapter: ProviderAdapter<I, unknown>,
  capability: string,
  input: I,
  seed?: number,
): CacheKeyInput {
  const m = adapter.manifest;
  return {
    capability,
    contract_version: m.contract_versions[capability] ?? '1',
    provider_id: m.id,
    provider_version: m.version,
    model_file_hash: adapter.modelFileHash ?? null,
    input: adapter.cacheKeyParts(input),
    seed: seed ?? null,
  };
}

export const cacheDir = (key: string): string => `cache/objects/${key.slice(0, 2)}/${key}`;

export interface RunCapabilityArgs<I, O> {
  store: WriteStore;
  db?: Db;
  adapter: ProviderAdapter<I, O>;
  capability: string;
  input: I;
  seed?: number;
  videoId?: string;
  /** Trường đầu ra là đường dẫn (tương đối workdir) → đích tương đối kênh. */
  outputs: Record<string, string>;
  signal?: AbortSignal;
  progress?: (done: number, total: number, message?: string) => void;
  jobId?: string;
  logger?: Logger;
  /** Nguồn bí mật (mặc định biến môi trường → Credential Manager). */
  getSecret?: (name: string) => string | undefined;
}

export interface RunCapabilityResult<O> {
  output: O;
  from_cache: boolean;
  cache_key: string;
  /** Đường dẫn (tương đối kênh) của file provenance đã ghi. */
  provenance: string[];
}

interface CacheMeta {
  output: unknown;
  files: Record<string, string>;
}

function touch(db: Db | undefined, key: string, channel: string, size?: number): void {
  if (!db) return;
  if (size === undefined) {
    db.prepare('UPDATE cache_entries SET last_used = ? WHERE key = ? AND channel = ?').run(
      new Date().toISOString(),
      key,
      channel,
    );
  } else {
    db.prepare(
      'INSERT INTO cache_entries (key, channel, size, last_used) VALUES (?, ?, ?, ?) ON CONFLICT(key, channel) DO UPDATE SET size = excluded.size, last_used = excluded.last_used',
    ).run(key, channel, size, new Date().toISOString());
  }
}

/**
 * Chạy một capability qua adapter (D4 mục 4.2, 7): tra cache → chạy trong thư mục tạm → đưa đầu ra
 * vào đích qua module ghi → lưu cache → ghi provenance (D3 5.12) cho mỗi file đầu ra.
 */
export function runCapability<I, O>(
  args: RunCapabilityArgs<I, O>,
): Promise<RunCapabilityResult<O>> {
  const m = args.adapter.manifest;
  return withSpan(
    'sf.provider.run',
    {
      'sf.capability': args.capability,
      'sf.provider': m.id,
      'sf.model': m.models?.[0],
      'sf.video_id': args.videoId,
    },
    async (span) => {
      const r = await runCapabilityInner(args);
      span.setAttribute('sf.from_cache', r.from_cache);
      return r;
    },
  );
}

async function runCapabilityInner<I, O>(
  args: RunCapabilityArgs<I, O>,
): Promise<RunCapabilityResult<O>> {
  const { store, adapter, capability, input } = args;
  const m = adapter.manifest;
  const keyParts = cacheKeyParts(adapter, capability, input, args.seed);
  const key = cacheKey(keyParts);
  const cacheable = isCacheable(capability, input);
  const cdir = cacheDir(key);
  const metaRel = `${cdir}/meta.json`;
  let output: Record<string, unknown>;
  let fromCache = false;

  if (cacheable && existsSync(store.abs(metaRel))) {
    const meta = JSON.parse(readFileSync(store.abs(metaRel), 'utf8')) as CacheMeta;
    for (const [field, dest] of Object.entries(args.outputs)) {
      const file = meta.files[field];
      if (!file) throw new SfError('E_PROVIDER_FAILED', `cache entry ${key} has no ${field}`);
      store.copyWithin(`${cdir}/${file}`, dest, { by: `capability:${capability}` });
    }
    output = { ...(meta.output as Record<string, unknown>) };
    fromCache = true;
    touch(args.db, key, store.root);
  } else {
    const scratch = createScratchDir();
    try {
      const ctrl = new AbortController();
      args.signal?.addEventListener('abort', () => ctrl.abort());
      // lịch GPU (019): giữ lease engine trong suốt lần chạy adapter (cache hit không cần GPU)
      const lease = m.engine ? await gpuScheduler?.acquire(m.engine, args.signal) : undefined;
      const out = (await adapter
        .run(input, {
          signal: ctrl.signal,
          workdir: scratch.dir,
          progress: args.progress ?? (() => {}),
          logger: args.logger ?? new Logger(),
          span: {},
          resolveInput: (p) => store.abs(p),
          // chỉ provider khai báo `secrets` (D4 mục 4.2)
          secrets: async (name) => {
            const v = m.secrets?.includes(name)
              ? (args.getSecret ?? getSecretDefault)(name)
              : undefined;
            if (!v)
              throw new SfError('E_AUTH_REQUIRED', `secret ${name} is not available to ${m.id}`);
            return v;
          },
        })
        .finally(() => lease?.release())) as Record<string, unknown>;
      output = { ...out };
      const files: Record<string, string> = {};
      let size = 0;
      for (const [field, dest] of Object.entries(args.outputs)) {
        const rel = out[field];
        if (typeof rel !== 'string')
          throw new SfError('E_PROVIDER_FAILED', `${m.id} returned no ${field}`);
        const buf = readFileSync(path.join(scratch.dir, rel));
        store.write(dest, buf, { by: `capability:${capability}`, validate: false });
        if (cacheable) {
          files[field] = `${field}${path.extname(rel)}`;
          store.write(`${cdir}/${files[field]}`, buf, { by: 'cache', validate: false });
          size += buf.length;
        }
      }
      if (cacheable) {
        store.write(metaRel, JSON.stringify({ output: out, files } satisfies CacheMeta), {
          by: 'cache',
          validate: false,
        });
        touch(args.db, key, store.root, size);
      }
    } finally {
      scratch.cleanup();
    }
  }

  const provenance: string[] = [];
  for (const [field, dest] of Object.entries(args.outputs)) {
    output[field] = dest;
    const video = splitVideoPath(dest);
    const base = video ? video.videoRel : '';
    const inner = video ? video.inner : dest;
    const outputHash = sha256(readFileSync(store.abs(dest)));
    const parts = keyParts.input;
    const prov = {
      schema_version: 1,
      output: inner,
      output_hash: outputHash,
      capability,
      provider: m.id,
      provider_version: m.version,
      ...(m.models?.[0]
        ? {
            model: {
              id: m.models[0],
              ...(adapter.modelFileHash ? { file_hash: adapter.modelFileHash } : {}),
            },
          }
        : {}),
      params:
        parts && typeof parts === 'object' && !Array.isArray(parts) ? parts : { value: parts },
      ...(args.seed === undefined ? {} : { seed: args.seed }),
      inputs: [],
      cache_key: key,
      from_cache: fromCache,
      source: { kind: 'generated' },
      ...(args.jobId ? { job_id: args.jobId } : {}),
      created_at: new Date().toISOString(),
    };
    const rel = [base, 'provenance', `${outputHash.slice(0, 12)}.json`].filter(Boolean).join('/');
    store.write(rel, `${JSON.stringify(prov, null, 2)}\n`, {
      by: 'provenance',
      validate: Boolean(video),
    });
    provenance.push(rel);
  }
  return { output: output as O, from_cache: fromCache, cache_key: key, provenance };
}
