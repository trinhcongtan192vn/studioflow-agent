import { existsSync, readFileSync } from 'node:fs';
import type { AudioMeta } from '../contracts/types.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import type { WriteStore } from '../store/writer.js';

/** WAV PCM 16/24/32-bit hoặc float 32-bit, mọi số kênh → mono Float32 [-1, 1]. */
export function decodeWav(buf: Buffer): { sampleRate: number; samples: Float32Array } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    return { sampleRate: 48000, samples: new Float32Array(0) };
  let off = 12;
  let fmt = 1;
  let ch = 1;
  let sr = 48000;
  let bits = 16;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = buf.readUInt16LE(body);
      ch = buf.readUInt16LE(body + 2);
      sr = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
      if (fmt === 0xfffe && size >= 26) fmt = buf.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      const bytes = bits / 8;
      const len = Math.min(size, buf.length - body);
      const n = Math.floor(len / (bytes * ch));
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let c = 0; c < ch; c++) {
          const p = body + (i * ch + c) * bytes;
          sum +=
            fmt === 3
              ? buf.readFloatLE(p)
              : bits === 16
                ? buf.readInt16LE(p) / 32768
                : bits === 24
                  ? buf.readIntLE(p, 3) / 8388608
                  : bits === 32
                    ? buf.readInt32LE(p) / 2147483648
                    : (buf.readUInt8(p) - 128) / 128;
        }
        out[i] = sum / ch;
      }
      return { sampleRate: sr, samples: out };
    }
    off = body + size + (size % 2);
  }
  return { sampleRate: sr, samples: new Float32Array(0) };
}

function encodePcm16(samples: Float32Array, sr: number): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  return buf;
}

export const previewVoiceRel = (videoId: string) => `videos/${videoId}/.sf/preview/voice.wav`;
export const previewWaveRel = (videoId: string) => `videos/${videoId}/.sf/preview/waveform.json`;

export interface Waveform {
  schema_version: 1;
  source_hash: string;
  step_ms: 10;
  duration_ms: number;
  /** Đỉnh |biên độ| mỗi 10 ms, 0..1 (3 chữ số). */
  peaks: number[];
}

/**
 * `.sf/preview/voice.wav` + `waveform.json` (D9 6, dẫn xuất): ghép `audio/lines` theo mốc chuỗi lời đọc
 * của `audio_meta.json`, đỉnh mỗi 10 ms. Chỉ sinh lại khi audio các line đổi (`source_hash`).
 */
export function ensurePreviewVoice(store: WriteStore, videoId: string, meta: AudioMeta): Waveform {
  const v = `videos/${videoId}`;
  const source_hash = sha256(
    canonicalJson(meta.lines.map((l) => [l.line_id, l.file, l.start_ms, l.content_hash])),
  );
  const wf = store.abs(previewWaveRel(videoId));
  if (existsSync(wf) && existsSync(store.abs(previewVoiceRel(videoId)))) {
    try {
      const cur = JSON.parse(readFileSync(wf, 'utf8')) as Waveform;
      if (cur.source_hash === source_hash) return cur;
    } catch {
      /* hỏng → sinh lại */
    }
  }
  const sr = 48000;
  const total = Math.max(
    meta.total_duration_ms,
    ...meta.lines.map((l) => l.start_ms + l.duration_ms),
    0,
  );
  const mix = new Float32Array(Math.ceil((total * sr) / 1000));
  for (const l of meta.lines) {
    const f = store.abs(`${v}/${l.file}`);
    if (!existsSync(f)) continue;
    const d = decodeWav(readFileSync(f));
    const ratio = d.sampleRate / sr;
    const at = Math.round((l.start_ms * sr) / 1000);
    const n = Math.min(Math.floor(d.samples.length / ratio), mix.length - at);
    for (let i = 0; i < n; i++) mix[at + i]! += d.samples[Math.floor(i * ratio)]!;
  }
  const step = sr / 100;
  const peaks: number[] = [];
  for (let s = 0; s < mix.length; s += step) {
    let m = 0;
    for (let i = s; i < Math.min(s + step, mix.length); i++) m = Math.max(m, Math.abs(mix[i]!));
    peaks.push(Math.round(Math.min(1, m) * 1000) / 1000);
  }
  const out: Waveform = { schema_version: 1, source_hash, step_ms: 10, duration_ms: total, peaks };
  store.write(previewVoiceRel(videoId), encodePcm16(mix, sr), {
    by: 'captions.load',
    validate: false,
  });
  store.write(previewWaveRel(videoId), JSON.stringify(out), {
    by: 'captions.load',
    validate: false,
  });
  return out;
}
