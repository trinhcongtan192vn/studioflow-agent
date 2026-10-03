import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SfError } from '../errors.js';

export async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

/**
 * Tải một file (D4 mục 10, FN-014): báo dung lượng, tải tiếp khi đứt (`.part` + HTTP Range), file chỉ
 * xuất hiện ở đích sau khi khớp `sha256` (`E_DOWNLOAD_CHECKSUM`).
 */
export async function downloadFile(
  url: string,
  dest: string,
  o: {
    sha256: string;
    size: number;
    signal?: AbortSignal;
    progress?: (done: number, total: number) => void;
    retries?: number;
  },
): Promise<{ skipped: boolean }> {
  if (existsSync(dest) && statSync(dest).size === o.size && (await sha256File(dest)) === o.sha256)
    return { skipped: true };
  mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const retries = o.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    let start = existsSync(part) ? statSync(part).size : 0;
    if (start > o.size) {
      rmSync(part);
      start = 0;
    }
    try {
      if (start < o.size) {
        const res = await fetch(url, {
          headers: start ? { Range: `bytes=${start}-` } : {},
          ...(o.signal ? { signal: o.signal } : {}),
          redirect: 'follow',
        });
        if (!res.ok || !res.body)
          throw new SfError('E_PROVIDER_FAILED', `${url}: HTTP ${res.status}`);
        if (start && res.status !== 206) start = 0; // máy chủ không hỗ trợ Range → tải lại từ đầu
        let done = start;
        o.progress?.(done, o.size);
        const counter = new TransformCounter((n) => {
          done += n;
          o.progress?.(done, o.size);
        });
        const src = Readable.fromWeb(res.body as never);
        const out = createWriteStream(part, { flags: start ? 'a' : 'w' });
        if (o.signal) await pipeline(src, counter, out, { signal: o.signal });
        else await pipeline(src, counter, out);
      }
      const size = statSync(part).size;
      if (size < o.size)
        throw new SfError('E_PROVIDER_FAILED', `${url}: incomplete download (${size}/${o.size})`);
      const got = await sha256File(part);
      if (got !== o.sha256 || size !== o.size) {
        rmSync(part, { force: true });
        throw new SfError(
          'E_DOWNLOAD_CHECKSUM',
          `${path.basename(dest)}: sha256 ${got} ≠ ${o.sha256}`,
        );
      }
      renameSync(part, dest);
      return { skipped: false };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (o.signal?.aborted) throw new SfError('E_JOB_CANCELED', 'download canceled');
      if (code === 'E_DOWNLOAD_CHECKSUM' || attempt >= retries) throw e;
      // đứt mạng: tải tiếp từ phần đã có
    }
  }
}

class TransformCounter extends Transform {
  constructor(private readonly onBytes: (n: number) => void) {
    super();
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.onBytes(chunk.length);
    cb(null, chunk);
  }
}

/** bsdtar của Windows (GNU tar của Git trên PATH không đọc được zip). */
export function bsdtar(): string {
  const sys = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe');
  return process.platform === 'win32' && existsSync(sys) ? sys : 'tar';
}

/** Giải nén zip vào thư mục (bsdtar có sẵn trên Windows 10+). */
export function extractZip(zip: string, destDir: string, signal?: AbortSignal): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const p = spawn(bsdtar(), ['-xf', zip, '-C', destDir], {
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    p.on('error', (e) => reject(new SfError('E_PROVIDER_UNAVAILABLE', `tar: ${e.message}`)));
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new SfError('E_PROVIDER_FAILED', `tar exited ${code}: ${err.slice(-300)}`)),
    );
  });
}

/** File văn bản nhỏ trong app-data (ví dụ `refs/main` của cache Hugging Face). */
export function writeAppDataText(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
