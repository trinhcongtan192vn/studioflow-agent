import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SfError } from '../errors.js';
import { createScratchDir, writeOutsideProject } from '../store/scratch.js';

export interface MusicSegment {
  track_id: string;
  /** Đường dẫn tuyệt đối file nhạc. */
  file: string;
  start_ms: number;
  end_ms: number;
  /** Mức nhạc so với giọng (dB, khi không có lời); ví dụ −6 = nhỏ hơn giọng 6 dB. */
  volume_db: number;
}

/** Loudness giọng mặc định khi không đo được (LUFS tích hợp của lời đọc TTS điển hình). */
export const DEFAULT_VOICE_LUFS = -20;

export interface BedInput {
  segments: MusicSegment[];
  /** Khoảng có giọng (mốc tuyệt đối video). */
  voice: { start_ms: number; end_ms: number }[];
  total_ms: number;
  duck_db: number;
  fade_ms?: number;
  /** Loudness tích hợp của lời đọc (đo bằng `measureVoiceLufs`); không có → `DEFAULT_VOICE_LUFS`. */
  voice_lufs?: number;
}

const s3 = (ms: number) => (ms / 1000).toFixed(3);

/** Gộp khoảng giọng gần nhau (< 800 ms) để ducking không nhấp nhả giữa các câu. */
export function mergeIntervals(
  iv: { start_ms: number; end_ms: number }[],
  gap = 800,
): { start_ms: number; end_ms: number }[] {
  const out: { start_ms: number; end_ms: number }[] = [];
  for (const x of [...iv].sort((a, b) => a.start_ms - b.start_ms)) {
    const last = out[out.length - 1];
    if (last && x.start_ms - last.end_ms < gap) last.end_ms = Math.max(last.end_ms, x.end_ms);
    else out.push({ ...x });
  }
  return out;
}

/**
 * Biểu thức `volume` của FFmpeg cho ducking (FN-012 mục 4): trong khoảng giọng nhạc giảm `duck_db`,
 * vào 50 ms trước giọng (attack), nhả 400 ms sau giọng (release).
 */
export function duckExpression(
  voice: { start_ms: number; end_ms: number }[],
  duckDb: number,
): string {
  const D = Math.pow(10, duckDb / 20);
  const terms = mergeIntervals(voice).map((v) => {
    const a = v.start_ms / 1000;
    const b = v.end_ms / 1000;
    return `min(clip((t-${(a - 0.05).toFixed(3)})/0.05\\,0\\,1)\\,clip((${(b + 0.4).toFixed(3)}-t)/0.4\\,0\\,1))`;
  });
  if (!terms.length) return '1';
  const amount = terms.reduce((acc, t) => (acc ? `max(${acc}\\,${t})` : t), '');
  return `1-${(1 - D).toFixed(5)}*${amount}`;
}

/**
 * Mức chuẩn hóa nhạc (LUFS) = loudness giọng + `volume_db`, kẹp trong [−40, −10]. Trước đây nhạc chuẩn hóa −24 LUFS
 * rồi trừ tiếp `volume_db` (−18) và ducking (−12) → bed ≈ −54 dB, dưới giọng ~35 dB: không nghe thấy.
 */
export function musicTargetLufs(voiceLufs: number | undefined, volumeDb: number): number {
  const v = Number.isFinite(voiceLufs) ? voiceLufs! : DEFAULT_VOICE_LUFS;
  return Math.round(Math.min(-10, Math.max(-40, v + volumeDb)) * 10) / 10;
}

/** Dựng lệnh FFmpeg cho bed nhạc (đoạn theo scene, crossfade, chuẩn hóa theo giọng, ducking). */
export function bedFfmpegArgs(i: BedInput, out: string): string[] {
  const fade = (i.fade_ms ?? 1000) / 1000;
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  const filters: string[] = [];
  i.segments.forEach((s, n) => {
    // kéo dài nửa crossfade hai đầu (trừ biên video) để hai bài chồng lên nhau
    const start = Math.max(0, s.start_ms - (n > 0 ? 500 : 0));
    const end = Math.min(i.total_ms, s.end_ms + (n < i.segments.length - 1 ? 500 : 0));
    const dur = (end - start) / 1000;
    args.push('-stream_loop', '-1', '-i', s.file);
    filters.push(
      `[${n}:a]atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `loudnorm=I=${musicTargetLufs(i.voice_lufs, s.volume_db)}:TP=-2:LRA=11,aresample=48000,` +
        `afade=t=in:st=0:d=${Math.min(fade, dur / 2).toFixed(3)},afade=t=out:st=${Math.max(0, dur - fade).toFixed(3)}:d=${Math.min(fade, dur / 2).toFixed(3)},` +
        `adelay=${Math.round(start)}:all=1[m${n}]`,
    );
  });
  const mix = i.segments.map((_, n) => `[m${n}]`).join('');
  filters.push(
    `${mix}amix=inputs=${i.segments.length}:normalize=0:duration=longest,apad=whole_dur=${s3(i.total_ms)},atrim=0:${s3(i.total_ms)},` +
      `volume='${duckExpression(i.voice, i.duck_db)}':eval=frame[out]`,
  );
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[out]',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    out,
  );
  return args;
}

export function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.SF_FFMPEG ?? 'ffmpeg', args, {
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    p.on('error', (e) => reject(new SfError('E_PROVIDER_UNAVAILABLE', `ffmpeg: ${e.message}`)));
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new SfError('E_PROVIDER_FAILED', `ffmpeg exited ${code}: ${err.slice(-500)}`)),
    );
  });
}

/**
 * Loudness tích hợp (LUFS) của toàn bộ lời đọc: ghép các file line (concat demuxer) rồi đo bằng `loudnorm`.
 * Không có file / đo lỗi → undefined (bed dùng `DEFAULT_VOICE_LUFS`).
 */
export async function measureVoiceLufs(
  files: string[],
  signal?: AbortSignal,
): Promise<number | undefined> {
  if (!files.length) return undefined;
  const scratch = createScratchDir();
  try {
    const list = path.join(scratch.dir, 'voice.txt');
    writeOutsideProject(
      list,
      files.map((f) => `file '${f.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`).join('\n'),
    );
    const err = await runFfmpegCapture(
      [
        '-hide_banner',
        '-nostats',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-vn',
        '-af',
        'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
        '-f',
        'null',
        '-',
      ],
      signal,
    );
    const j = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(err)?.[0];
    const v = j ? Number((JSON.parse(j) as { input_i: string }).input_i) : NaN;
    return Number.isFinite(v) && v > -70 ? v : undefined;
  } catch {
    return undefined;
  } finally {
    scratch.cleanup();
  }
}

/** Như `runFfmpeg` nhưng trả stderr (đo loudness in JSON ra stderr). */
function runFfmpegCapture(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.SF_FFMPEG ?? 'ffmpeg', args, {
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    p.on('error', (e) => reject(new SfError('E_PROVIDER_UNAVAILABLE', `ffmpeg: ${e.message}`)));
    p.on('close', (code) =>
      code === 0
        ? resolve(err)
        : reject(new SfError('E_PROVIDER_FAILED', `ffmpeg exited ${code}: ${err.slice(-500)}`)),
    );
  });
}

/** Chạy FFmpeg dựng bed vào thư mục tạm, trả nội dung WAV. */
export async function renderBed(i: BedInput, signal?: AbortSignal): Promise<Buffer> {
  const scratch = createScratchDir();
  try {
    const out = path.join(scratch.dir, 'bed.wav');
    await runFfmpeg(bedFfmpegArgs(i, out), signal);
    return readFileSync(out);
  } finally {
    scratch.cleanup();
  }
}
