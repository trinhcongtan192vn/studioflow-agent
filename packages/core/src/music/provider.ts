import { existsSync } from 'node:fs';
import type { ProviderAdapter } from '../capability/types.js';
import type { MusicTrack } from '../contracts/types.js';
import { defaultAppDataDir } from '../config/resolve.js';
import { SfError } from '../errors.js';
import { loadProviderManifest } from '../providers/manifest.js';
import { enginePython, WORKER_SRC } from '../providers/omnivoice.js';
import { PythonWorker } from '../workers/client.js';

export interface AnalyzeInput {
  /** Đường dẫn tuyệt đối của file (đọc trong worker). */
  file: string;
  /** Hash nội dung (khóa cache thay cho đường dẫn). */
  hash: string;
}

export type MusicAnalysis = MusicTrack['analysis'];

let seq = 0;

/** `audio.analysis` (D4 mục 4.3): worker Python engine `audio-analysis` (CPU). */
export function createAudioAnalysisProvider(opts: { appDataDir?: string } = {}) {
  const python = enginePython('audio-analysis', opts.appDataDir ?? defaultAppDataDir());
  const worker = new PythonWorker({ engine: 'audio-analysis', python, srcDir: WORKER_SRC });
  const adapter: ProviderAdapter<AnalyzeInput, MusicAnalysis> = {
    manifest: loadProviderManifest('audio.analysis'),
    async health() {
      if (!existsSync(python)) return { ok: false, detail: `engine env not installed: ${python}` };
      try {
        return await worker.call<{ ok: boolean; detail?: string }>('health');
      } catch (e) {
        return { ok: false, detail: String((e as Error).message) };
      }
    },
    cacheKeyParts: (i) => ({ hash: i.hash }),
    async run(input, ctx) {
      try {
        return (await worker.run('music.analyze', { file: input.file }, ctx.workdir, {
          jobId: `an-${++seq}`,
          onProgress: ctx.progress,
          signal: ctx.signal,
        })) as unknown as MusicAnalysis;
      } catch (e) {
        const code = (e as { code?: string }).code;
        throw code === 'E_AUDIO_UNSUPPORTED'
          ? e
          : new SfError('E_AUDIO_ANALYSIS', String((e as Error).message));
      }
    },
  };
  return { adapter, worker };
}
