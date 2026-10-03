import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SfError } from '../errors.js';

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
  o: { lufs: number; draft: boolean; crf: number; signal?: AbortSignal },
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
    : ['-c:v', 'copy'];
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
