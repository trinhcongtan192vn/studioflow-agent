import { spawn } from 'node:child_process';
import { nodeChildEnv } from '../node-child.js';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ProviderAdapter } from '../capability/types.js';
import { defaultAppDataDir } from '../config/resolve.js';
import { SfError } from '../errors.js';
import { loadProviderManifest } from '../providers/manifest.js';
import { wavDurationMs } from '../providers/wav.js';
import { asrErrorRate, displayWords } from './text.js';

/** D4 mục 3 `AsrAlignInput` (audio là đường dẫn tương đối kênh). */
export interface AsrAlignInput {
  audio: string;
  language: string;
  expected_text: string;
  /** Hash nội dung audio (vào khóa cache thay đường dẫn). */
  audio_hash?: string | null;
}

export interface AsrWord {
  i: number;
  text: string;
  start_ms: number;
  end_ms: number;
  conf?: number;
}

export interface AsrAlignOutput {
  words: AsrWord[];
  transcript: string;
  wer: number;
}

export type AsrAdapter = ProviderAdapter<AsrAlignInput, AsrAlignOutput>;

export const asrCacheParts = (i: AsrAlignInput) => ({
  audio_hash: i.audio_hash ?? i.audio,
  language: i.language,
  expected_text: i.expected_text,
});

/** Thư mục cài whisper của app: `<app-data>/providers/whisper/` (010 R1). */
export function whisperDir(appDataDir = defaultAppDataDir()): string {
  return path.join(appDataDir, 'providers', 'whisper');
}

/** `whisper-cli.exe`: biến `HYPERFRAMES_WHISPER_PATH` → bản CUDA → bản CPU. */
export function whisperCli(appDataDir?: string): string | undefined {
  const env = process.env.HYPERFRAMES_WHISPER_PATH;
  if (env && existsSync(env)) return env;
  const dir = whisperDir(appDataDir);
  return [
    path.join(dir, 'cuda', 'Release', 'whisper-cli.exe'),
    path.join(dir, 'cpu', 'Release', 'whisper-cli.exe'),
  ].find((p) => existsSync(p));
}

/** CLI hyperframes ghim trong `node_modules` của core. */
export function hyperframesBin(): string {
  const req = createRequire(import.meta.url);
  return path.join(path.dirname(req.resolve('hyperframes/package.json')), 'bin', 'hyperframes.mjs');
}

function run(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, windowsHide: true, signal });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    p.on('error', (e) =>
      signal.aborted ? reject(new SfError('E_JOB_CANCELED', 'canceled')) : reject(e),
    );
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Lấy dòng JSON cuối của stdout (hyperframes in banner trước). */
function lastJson(stdout: string): Record<string, unknown> {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  for (const l of lines.reverse()) {
    try {
      return JSON.parse(l) as Record<string, unknown>;
    } catch {
      /* dòng khác */
    }
  }
  throw new SfError(
    'E_PROVIDER_FAILED',
    `hyperframes transcribe printed no JSON: ${stdout.slice(-300)}`,
  );
}

/** Từ của transcript hyperframes (`[{text, start, end}]`, giây) → mốc ms. */
export function parseTranscriptWords(raw: unknown): AsrWord[] {
  const arr = (Array.isArray(raw) ? raw : ((raw as { words?: unknown[] })?.words ?? [])) as Record<
    string,
    unknown
  >[];
  return arr
    .map((w) => ({
      text: String(w.text ?? w.word ?? '').trim(),
      start: Number(w.start ?? w.start_time ?? 0),
      end: Number(w.end ?? w.end_time ?? 0),
      conf: w.confidence ?? w.probability ?? w.conf,
    }))
    .filter((w) => w.text)
    .map((w, i) => ({
      i,
      text: w.text,
      start_ms: Math.round(w.start * 1000),
      end_ms: Math.round(w.end * 1000),
      ...(typeof w.conf === 'number' ? { conf: Math.round(w.conf * 1000) / 1000 } : {}),
    }));
}

/**
 * `asr.hf-transcribe` (D4 mục 4.3, 010 R1): `hyperframes transcribe --json --engine whisper` với
 * `whisper-cli` + model đa ngôn ngữ đặt sẵn trong `<app-data>/providers/whisper/`.
 */
export function createHfTranscribeProvider(opts: { appDataDir?: string } = {}): AsrAdapter {
  const manifest = loadProviderManifest('asr.hf-transcribe');
  const model = manifest.models?.[0] ?? 'large-v3-turbo';
  const dir = whisperDir(opts.appDataDir);
  // hyperframes đọc model ở `<home>/.cache/hyperframes/whisper/models` → home riêng cho tiến trình
  // con; `scripts/setup-engine.mjs asr` (014: trình cài) đặt model vào đó.
  const home = path.join(dir, 'home');
  const modelFile = path.join(
    home,
    '.cache',
    'hyperframes',
    'whisper',
    'models',
    `ggml-${model}.bin`,
  );
  return {
    manifest,
    async health() {
      const cli = whisperCli(opts.appDataDir);
      if (!cli)
        return {
          ok: false,
          detail: 'whisper-cli not installed; run node scripts/setup-engine.mjs asr',
        };
      if (!existsSync(modelFile))
        return {
          ok: false,
          detail: `model ${modelFile} missing; run node scripts/setup-engine.mjs asr`,
        };
      return { ok: true };
    },
    cacheKeyParts: asrCacheParts,
    async run(input, ctx) {
      const cli = whisperCli(opts.appDataDir);
      if (!cli || !existsSync(modelFile)) {
        throw new SfError(
          'E_PROVIDER_UNAVAILABLE',
          'asr.hf-transcribe is not installed; run node scripts/setup-engine.mjs asr',
        );
      }
      const audio = ctx.resolveInput(input.audio);
      const env = nodeChildEnv({
        ...process.env,
        HYPERFRAMES_WHISPER_PATH: cli,
        HYPERFRAMES_NO_TELEMETRY: '1',
        USERPROFILE: home,
        HOME: home,
      });
      const r = await run(
        process.execPath,
        [
          hyperframesBin(),
          'transcribe',
          audio,
          '--json',
          '--engine',
          'whisper',
          '--model',
          model,
          '--language',
          input.language,
          '--dir',
          ctx.workdir,
        ],
        env,
        ctx.signal,
      );
      const out = lastJson(r.stdout);
      if (out.ok !== true) {
        throw new SfError(
          'E_PROVIDER_FAILED',
          `hyperframes transcribe failed: ${String(out.error ?? out.reason ?? r.stderr.slice(-300))}`,
        );
      }
      const words = parseTranscriptWords(
        JSON.parse(readFileSync(String(out.transcriptPath), 'utf8')),
      );
      const transcript = words.map((w) => w.text).join(' ');
      ctx.progress(1, 1);
      return {
        words,
        transcript,
        wer: asrErrorRate(input.expected_text, transcript, input.language),
      };
    },
  };
}

/**
 * `asr.fake` (D12 mục 2, `SF_GPU=0`): từ của văn bản mong đợi rải đều trên thời lượng file, WER 0.
 */
export function createFakeAsrProvider(): AsrAdapter {
  return {
    manifest: loadProviderManifest('asr.fake'),
    health: async () => ({ ok: true }),
    cacheKeyParts: asrCacheParts,
    async run(input, ctx) {
      const ms = wavDurationMs(readFileSync(ctx.resolveInput(input.audio)));
      const shown = displayWords(input.expected_text);
      const step = shown.length ? ms / shown.length : 0;
      const words = shown.map((text, i) => ({
        i,
        text,
        start_ms: Math.round(i * step),
        end_ms: Math.round((i + 1) * step),
      }));
      ctx.progress(1, 1);
      return { words, transcript: input.expected_text, wer: 0 };
    },
  };
}
