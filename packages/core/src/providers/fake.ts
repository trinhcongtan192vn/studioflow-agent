import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProviderAdapter } from '../capability/types.js';
import { sha256 } from '../domain/hash.js';
import { SfError } from '../errors.js';
import { loadProviderManifest } from './manifest.js';
import { encodeWav, wavDurationMs } from './wav.js';

export const FAKE_MS_PER_CHAR = 60;

export interface TtsAdapterInput {
  text: string;
  language?: string;
  voice_id?: string;
  emotion?: string;
  speed?: number;
  /** Đường dẫn tuyệt đối `voices/<vo>/voice.pt` (không vào khóa cache). */
  voice_file?: string;
  /** Hash nội dung `voice.pt` (vào khóa cache). */
  voice_hash?: string | null;
  /** Seed sinh (sinh lại khi ASR lệch, 010); vào khóa cache qua `runCapability`. */
  seed?: number;
}

export interface VoiceAdapterInput {
  name: string;
  language: string;
  /** Đường dẫn tương đối kênh của file mẫu. */
  ref_audio: string;
  ref_text?: string;
}

/** Giọng gợi ý (033): sinh câu mẫu theo `instruct` rồi clone. */
export interface VoiceDesignAdapterInput {
  name: string;
  language: string;
  instruct: string;
  sample_text: string;
  seed?: number;
}

export type AdapterInput = TtsAdapterInput | VoiceAdapterInput | VoiceDesignAdapterInput;
export const isVoiceProfile = (i: AdapterInput): i is VoiceAdapterInput => 'ref_audio' in i;
export const isVoiceDesign = (i: AdapterInput): i is VoiceDesignAdapterInput => 'instruct' in i;
export const designCacheParts = (i: VoiceDesignAdapterInput) => ({
  instruct: i.instruct,
  sample_text: i.sample_text,
  language: i.language,
  seed: i.seed ?? 0,
});

export const ttsCacheParts = (i: TtsAdapterInput) => ({
  text: i.text,
  voice_id: i.voice_id ?? null,
  voice_hash: i.voice_hash ?? null,
  emotion: i.emotion ?? null,
  speed: i.speed ?? null,
  language: i.language ?? null,
});

/**
 * `tts.fake` (D4 mục 4.3, D12 mục 2): sóng sin dài theo số ký tự — xác định, không cần GPU. Chỉ
 * đăng ký khi `SF_GPU=0`. Ghi vào workdir tạm (ngoài project).
 */
export function createFakeTtsProvider(): ProviderAdapter<AdapterInput, Record<string, unknown>> {
  return {
    manifest: loadProviderManifest('tts.fake'),
    health: async () => ({ ok: true }),
    cacheKeyParts: (i) =>
      isVoiceDesign(i)
        ? designCacheParts(i)
        : isVoiceProfile(i)
          ? { ref_audio: i.ref_audio, ref_text: i.ref_text ?? null }
          : ttsCacheParts(i),
    run: async (input, ctx) => {
      if (isVoiceDesign(input)) {
        writeFileSync(
          path.join(ctx.workdir, 'ref.wav'),
          encodeWav(Math.max(3000, input.sample_text.length * FAKE_MS_PER_CHAR)),
        );
        writeFileSync(
          path.join(ctx.workdir, 'voice.pt'),
          `fake-design:${sha256(JSON.stringify(designCacheParts(input)))}`,
        );
        ctx.progress(1, 1);
        return { voice: 'voice.pt', ref: 'ref.wav', ref_text: input.sample_text };
      }
      if (isVoiceProfile(input)) {
        const ref = ctx.resolveInput(input.ref_audio);
        const ms = wavDurationMs(readFileSync(ref));
        if (ms < 3000 || ms > 10000) {
          throw new SfError(
            'E_AUDIO_UNSUPPORTED',
            `ref audio must be 3-10 s, got ${(ms / 1000).toFixed(1)} s`,
          );
        }
        copyFileSync(ref, path.join(ctx.workdir, 'ref.wav'));
        writeFileSync(
          path.join(ctx.workdir, 'voice.pt'),
          `fake-voice:${sha256(readFileSync(ref))}`,
        );
        ctx.progress(1, 1);
        return { voice: 'voice.pt', ref: 'ref.wav', ref_text: input.ref_text ?? '' };
      }
      if (!input.text.trim()) throw new SfError('E_SCHEMA_INVALID', 'text is empty');
      const duration = Math.max(200, input.text.length * FAKE_MS_PER_CHAR);
      writeFileSync(path.join(ctx.workdir, 'out.wav'), encodeWav(duration));
      ctx.progress(1, 1);
      return { file: 'out.wav', duration_ms: duration, sample_rate: 48000 };
    },
  };
}
