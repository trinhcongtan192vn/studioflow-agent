import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SfError } from '../errors.js';
import type { MediaInfo } from '../publish/limits.js';

const FFMPEG = () => process.env.SF_FFMPEG ?? 'ffmpeg';
const FFPROBE = () => process.env.SF_FFPROBE ?? 'ffprobe';

function run(
  cmd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...(signal ? { signal } : {}) });
    let out = '';
    let err = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    p.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    p.on('error', (e) =>
      reject(
        signal?.aborted
          ? new SfError('E_JOB_CANCELED', 'canceled')
          : new SfError('E_PROVIDER_UNAVAILABLE', `${cmd}: ${e.message}`),
      ),
    );
    p.on('close', (code) =>
      code === 0
        ? resolve({ out, err })
        : reject(new SfError('E_PROVIDER_FAILED', `${cmd} exited ${code}: ${err.slice(-600)}`)),
    );
  });
}

/** Đo loudness (loudnorm lượt 1). */
export async function measureLoudness(
  file: string,
  target: number,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const { err } = await run(
    FFMPEG(),
    [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-vn',
      '-af',
      `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`,
      '-f',
      'null',
      '-',
    ],
    signal,
  );
  const j = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(err)?.[0];
  if (!j) throw new SfError('E_PROVIDER_FAILED', 'loudnorm measurement printed no JSON');
  return JSON.parse(j) as Record<string, string>;
}

/** Font có dấu tiếng Việt cho drawtext (tránh phụ thuộc fontconfig trên Windows). */
function fontfile(): string | undefined {
  const f = 'C:/Windows/Fonts/arial.ttf';
  return process.platform === 'win32' && existsSync(f) ? f : undefined;
}

/**
 * Hậu kỳ (013 FR-002): loudnorm hai lượt về `lufs` của output profile; nháp → chữ "NHÁP" (video mã
 * lại), phát hành → giữ nguyên video.
 */
export async function finishVideo(
  src: string,
  dst: string,
  o: { lufs: number; draft: boolean; crf: number; fps?: number; signal?: AbortSignal },
): Promise<void> {
  const m = await measureLoudness(src, o.lufs, o.signal);
  const ln = `loudnorm=I=${o.lufs}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const ff = fontfile();
  const video = o.draft
    ? [
        '-vf',
        `drawtext=text='NHÁP':fontsize=h/12:fontcolor=white@0.4:x=w-tw-h/24:y=h/24${ff ? `:fontfile='${ff.replace(':', '\\:')}'` : ''}`,
        '-c:v',
        'libx264',
        '-crf',
        String(o.crf),
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
      ]
    : // phát hành: mã lại theo chuẩn đăng (Facebook Reels: GOP đóng 2–5 s, fps cố định; YouTube: H.264 High,
      // 4:2:0, faststart) — bản HyperFrames có keyframe tới ~8 s và bitrate thấp
      [
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-crf',
        String(o.crf),
        '-preset',
        'medium',
        '-pix_fmt',
        'yuv420p',
        ...(o.fps
          ? ['-r', String(o.fps), '-g', String(o.fps * 2), '-keyint_min', String(o.fps * 2)]
          : []),
        '-sc_threshold',
        '0',
        '-flags',
        '+cgop',
        '-bf',
        '2',
      ];
  await run(
    FFMPEG(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      src,
      ...video,
      '-af',
      ln,
      '-ar',
      '48000',
      '-ac',
      '2',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      dst,
    ],
    o.signal,
  );
}

/** Thời lượng (ms) bằng ffprobe. */
export async function probeDurationMs(file: string): Promise<number> {
  const { out } = await run(FFPROBE(), [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    file,
  ]);
  return Math.round(Number(out.trim()) * 1000);
}

/** Thông số file video để kiểm đăng được (`publish/limits.ts`): luồng hình/tiếng + khoảng cách keyframe. */
export async function probeMedia(file: string): Promise<MediaInfo> {
  const { out } = await run(FFPROBE(), [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,sample_rate,channels:format=duration,size',
    '-of',
    'json',
    file,
  ]);
  const j = JSON.parse(out) as {
    streams: {
      codec_type: string;
      codec_name: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      sample_rate?: string;
      channels?: number;
    }[];
    format: { duration: string; size: string };
  };
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  if (!v) throw new SfError('E_PROVIDER_FAILED', `${file}: no video stream`);
  const [n, d] = (v.avg_frame_rate ?? '0/1').split('/').map(Number);
  const keys = await run(FFPROBE(), [
    '-v',
    'error',
    '-select_streams',
    'v',
    '-skip_frame',
    'nokey',
    '-show_entries',
    'frame=pts_time',
    '-of',
    'csv=p=0',
    file,
  ]);
  const duration = Number(j.format.duration);
  const times = keys.out
    .split(/\r?\n/)
    .map((x) => x.replace(/,.*$/, '').trim())
    .filter(Boolean)
    .map(Number)
    .filter((x) => Number.isFinite(x));
  const gaps = [...times, duration].slice(1).map((t, i) => t - times[i]!);
  return {
    duration_ms: Math.round(duration * 1000),
    width: v.width ?? 0,
    height: v.height ?? 0,
    fps: d ? Math.round((n! / d) * 100) / 100 : 0,
    vcodec: v.codec_name,
    pix_fmt: v.pix_fmt ?? '',
    ...(a
      ? {
          acodec: a.codec_name,
          sample_rate: Number(a.sample_rate),
          ...(a.channels ? { channels: a.channels } : {}),
        }
      : {}),
    bytes: Number(j.format.size),
    ...(gaps.length ? { max_gop_s: Math.round(Math.max(...gaps) * 100) / 100 } : {}),
  };
}
