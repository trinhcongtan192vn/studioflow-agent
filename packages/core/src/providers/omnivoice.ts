import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderAdapter } from '../capability/types.js';
import { defaultAppDataDir } from '../config/resolve.js';
import { SfError } from '../errors.js';
import { PythonWorker } from '../workers/client.js';
import { isVoiceProfile, ttsCacheParts, type AdapterInput } from './fake.js';
import { loadProviderManifest } from './manifest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Mã worker (`workers/gpu/src`); `SF_WORKER_SRC` ghi đè khi đóng gói. */
export const WORKER_SRC =
  process.env.SF_WORKER_SRC ?? path.resolve(here, '..', '..', '..', '..', 'workers', 'gpu', 'src');

/** Python của môi trường engine: `<app-data>/providers/python/<engine>/` (D4 mục 9.3); `SF_PYTHON_<ENGINE>` ghi đè. */
export function enginePython(engine: string, appDataDir = defaultAppDataDir()): string {
  return (
    process.env[`SF_PYTHON_${engine.toUpperCase()}`] ??
    path.join(appDataDir, 'providers', 'python', engine, 'Scripts', 'python.exe')
  );
}

let jobSeq = 0;

/**
 * `tts.omnivoice` (D4 mục 4.3): `voice.profile` + `tts.synthesize` qua worker Python engine
 * `omnivoice`. Một adapter cho hai capability — phân biệt theo hình dạng đầu vào.
 */
export function createOmniVoiceProvider(opts: { appDataDir?: string } = {}) {
  const appDataDir = opts.appDataDir ?? defaultAppDataDir();
  const python = enginePython('omnivoice', appDataDir);
  const worker = new PythonWorker({
    engine: 'omnivoice',
    python,
    srcDir: WORKER_SRC,
    env: { HF_HOME: process.env.HF_HOME ?? path.join(appDataDir, 'models', 'hf') },
  });
  let healthy: boolean | undefined;
  const adapter: ProviderAdapter<AdapterInput, Record<string, unknown>> = {
    manifest: loadProviderManifest('tts.omnivoice'),
    async health() {
      if (!existsSync(python)) return { ok: false, detail: `engine env not installed: ${python}` };
      if (healthy !== undefined) return { ok: healthy };
      try {
        const h = await worker.call<{ ok: boolean; detail?: string }>('health');
        healthy = h.ok;
        return h;
      } catch (e) {
        return { ok: false, detail: String((e as Error).message) };
      }
    },
    async prepare() {
      await worker.call('load');
    },
    async release(mode) {
      await worker.call(mode);
    },
    cacheKeyParts: (i) =>
      isVoiceProfile(i)
        ? { ref_audio: i.ref_audio, ref_text: i.ref_text ?? null }
        : ttsCacheParts(i),
    async run(input, ctx) {
      const jobId = `run-${++jobSeq}`;
      if (isVoiceProfile(input)) {
        return worker.run(
          'voice.profile',
          { ref_audio: ctx.resolveInput(input.ref_audio), ref_text: input.ref_text ?? null },
          ctx.workdir,
          { jobId, onProgress: ctx.progress, signal: ctx.signal },
        );
      }
      if (!input.voice_file || !existsSync(input.voice_file)) {
        throw new SfError(
          'E_ID_UNKNOWN',
          `voice ${input.voice_id ?? '(none)'} has no cloned voice file; create it with voice.profile_create`,
        );
      }
      const limit = adapter.manifest.limits?.max_chars;
      if (limit && input.text.length > limit) {
        throw new SfError(
          'E_SCHEMA_INVALID',
          `line is ${input.text.length} chars, limit ${limit}; split it into shorter lines`,
        );
      }
      return worker.run(
        'tts.synthesize',
        {
          text: input.text,
          voice_prompt: input.voice_file,
          speed: input.speed ?? null,
          seed: input.seed ?? null,
        },
        ctx.workdir,
        { jobId, onProgress: ctx.progress, signal: ctx.signal },
      );
    },
  };
  return { adapter, worker };
}
