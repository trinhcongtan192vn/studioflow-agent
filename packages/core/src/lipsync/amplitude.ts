import { readFileSync } from 'node:fs';
import type { ProviderAdapter } from '../capability/types.js';
import { decodeWav } from '../captions/voice.js';
import { loadProviderManifest } from '../providers/manifest.js';

export type Mouth = 'closed' | 'half' | 'open';

/** Ngưỡng mặc định (FN-032 mục 4, `[chờ S10]`): RMS chuẩn hóa theo đỉnh của line. */
export const DEFAULT_THRESHOLDS = { half: 0.15, open: 0.35 };
/** Trạng thái giữ tối thiểu (video frame) để miệng không nhấp nháy. */
export const MIN_HOLD = 2;

/**
 * Khẩu hình mức 1 (FN-032 mục 4): RMS theo cửa sổ = 1 video frame, chuẩn hóa theo RMS lớn nhất của
 * line, ngưỡng half/open, làm mượt (trạng thái giữ ≥ 2 frame). Trả cue ở các frame đổi trạng thái.
 */
export function computeCues(
  samples: Float32Array,
  sampleRate: number,
  fps: number,
  thresholds = DEFAULT_THRESHOLDS,
): { frame: number; mouth: Mouth }[] {
  const win = sampleRate / fps;
  const n = Math.ceil(samples.length / win);
  const rms: number[] = [];
  for (let f = 0; f < n; f++) {
    const a = Math.floor(f * win);
    const b = Math.min(samples.length, Math.floor((f + 1) * win));
    let s = 0;
    for (let i = a; i < b; i++) s += samples[i]! * samples[i]!;
    rms.push(b > a ? Math.sqrt(s / (b - a)) : 0);
  }
  const peak = Math.max(...rms, 1e-9);
  const raw: Mouth[] = rms.map((r) => {
    const x = r / peak;
    return x >= thresholds.open ? 'open' : x >= thresholds.half ? 'half' : 'closed';
  });
  // làm mượt: đoạn trạng thái ngắn hơn MIN_HOLD frame nhập vào đoạn trước (miệng không nhấp nháy)
  const runs: { frame: number; mouth: Mouth; len: number }[] = [];
  raw.forEach((m, f) => {
    const last = runs.at(-1);
    if (last && last.mouth === m) last.len++;
    else runs.push({ frame: f, mouth: m, len: 1 });
  });
  const merged: typeof runs = [];
  for (const r of runs) {
    const last = merged.at(-1);
    if (last && (r.len < MIN_HOLD || last.mouth === r.mouth)) last.len += r.len;
    else merged.push({ ...r });
  }
  const cues: { frame: number; mouth: Mouth }[] = merged.map((r) => ({
    frame: r.frame,
    mouth: r.mouth,
  }));
  if (cues.at(-1)?.mouth !== 'closed') cues.push({ frame: n, mouth: 'closed' });
  return cues;
}

export interface LipsyncAdapterInput {
  /** Đường dẫn audio (tương đối kênh). */
  audio: string;
  fps: number;
  thresholds?: { half: number; open: number };
  audio_hash: string;
}

/** Provider `lipsync.amplitude` (D4 mục 4.3: capability `lipsync.cues`, runtime node, CPU). */
export function createLipsyncAmplitudeProvider(): ProviderAdapter<
  LipsyncAdapterInput,
  Record<string, unknown>
> {
  return {
    manifest: loadProviderManifest('lipsync.amplitude'),
    health: async () => ({ ok: true }),
    cacheKeyParts: (i) => ({
      audio_hash: i.audio_hash,
      fps: i.fps,
      thresholds: i.thresholds ?? DEFAULT_THRESHOLDS,
    }),
    async run(input, ctx) {
      const d = decodeWav(readFileSync(ctx.resolveInput(input.audio)));
      return { cues: computeCues(d.samples, d.sampleRate, input.fps, input.thresholds) };
    },
  };
}
