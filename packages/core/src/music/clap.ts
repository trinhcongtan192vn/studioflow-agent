import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProviderAdapter } from '../capability/types.js';
import { defaultAppDataDir } from '../config/resolve.js';
import { SfError } from '../errors.js';
import { loadProviderManifest } from '../providers/manifest.js';
import { enginePython, WORKER_SRC } from '../providers/omnivoice.js';
import { PythonWorker } from '../workers/client.js';

export interface EmbedInput {
  /** Đường dẫn tuyệt đối file âm thanh (đọc trong worker). */
  file: string;
  /** Hash nội dung (khóa cache). */
  hash: string;
}

export interface EmbedOutput {
  file: string;
  dim: number;
  model: string;
}

/** Embedding văn bản cho truy vấn `music.find` (không cache; 021). */
export interface TextEmbedder {
  model: string;
  embedTexts(texts: string[]): Promise<number[][]>;
}

let seq = 0;

/**
 * `audio.clap` (D4 mục 4.3, 021): worker Python engine `clap` (CPU) — embedding âm thanh (`music.embed`,
 * capability nội bộ) và văn bản (`embedTexts`) cùng không gian để tìm nhạc bằng mô tả.
 */
export function createClapProvider(opts: { appDataDir?: string } = {}) {
  const appDataDir = opts.appDataDir ?? defaultAppDataDir();
  const python = enginePython('clap', appDataDir);
  const worker = new PythonWorker({
    engine: 'clap',
    python,
    srcDir: WORKER_SRC,
    env: { HF_HOME: process.env.HF_HOME ?? path.join(appDataDir, 'models', 'hf') },
  });
  let healthy: { ok: boolean; detail?: string } | undefined;
  const adapter: ProviderAdapter<EmbedInput, EmbedOutput> = {
    manifest: loadProviderManifest('audio.clap'),
    async health() {
      if (!existsSync(python)) return { ok: false, detail: `engine env not installed: ${python}` };
      if (healthy) return healthy;
      try {
        healthy = await worker.call<{ ok: boolean; detail?: string }>('health');
        return healthy;
      } catch (e) {
        return { ok: false, detail: String((e as Error).message) };
      }
    },
    cacheKeyParts: (i) => ({ hash: i.hash }),
    async run(input, ctx) {
      return (await worker.run('music.embed', { file: input.file }, ctx.workdir, {
        jobId: `clap-${++seq}`,
        onProgress: ctx.progress,
        signal: ctx.signal,
      })) as unknown as EmbedOutput;
    },
  };
  const embedder: TextEmbedder = {
    model: 'laion/clap-htsat-unfused',
    async embedTexts(texts) {
      const h = await adapter.health();
      if (!h.ok) throw new SfError('E_PROVIDER_UNAVAILABLE', `CLAP unavailable: ${h.detail ?? ''}`);
      const r = (await worker.run('text.embed', { texts }, os.tmpdir(), {
        jobId: `clap-t-${++seq}`,
      })) as unknown as { vectors: number[][] };
      return r.vectors;
    },
  };
  return { adapter, embedder, worker };
}
