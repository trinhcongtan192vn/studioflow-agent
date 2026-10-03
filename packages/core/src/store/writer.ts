import { randomUUID } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { SfError } from '../errors.js';
import { artifactKind } from '../domain/artifacts.js';
import { sha256 } from '../domain/hash.js';
import { validateArtifact } from '../domain/validate.js';
import { resolveInside, splitVideoPath } from './paths.js';

export interface WriteLogEntry {
  path: string;
  hash: string;
  by: string;
  ts: string;
}

export interface WriteOptions {
  /** Lối vào ghi (D3 mục 8): `artifact.write`, `migration`, `video.create`, `config.set`… */
  by: string;
  /** Mặc định true: kiểm schema nếu đường dẫn thuộc loại artifact có schema. */
  validate?: boolean;
  /** `auto` (mặc định): sao lưu khi ghi đè artifact đã duyệt/frame ghim; `always`: luôn sao lưu bản cũ. */
  backup?: 'auto' | 'always';
}

export interface WriteResult {
  path: string;
  hash: string;
  backup?: string;
}

export const BACKUP_KEEP = 20;
const LOG_LIMIT = 10_000;
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stamp(): string {
  return new Date().toISOString().replaceAll(':', '-');
}

/**
 * Module ghi duy nhất của core (constitution Điều VI, D3 mục 8): chặn ra ngoài kênh, kiểm schema,
 * ghi nguyên tử (tạm → fsync → đổi tên), sao lưu, nhật ký `(path, hash, by, ts)`. Gateway (003)
 * bọc lớp này thành tool và thêm kiểm owner/base_hash/phạm vi phiên.
 */
export class WriteStore {
  readonly root: string;
  private readonly entries: WriteLogEntry[] = [];

  constructor(channelDir: string) {
    this.root = realpathSync.native(channelDir);
  }

  /** Đường dẫn tuyệt đối (đã kiểm phạm vi) — để đọc. */
  abs(rel: string): string {
    return resolveInside(this.root, rel).abs;
  }

  log(): WriteLogEntry[] {
    return [...this.entries];
  }

  ensureDir(rel: string): void {
    mkdirSync(resolveInside(this.root, rel).abs, { recursive: true });
  }

  write(rel: string, content: string | Buffer, opts: WriteOptions): WriteResult {
    const target = resolveInside(this.root, rel);
    if (opts.validate !== false && typeof content === 'string' && artifactKind(target.rel)) {
      const r = validateArtifact(target.rel, content);
      if (!r.valid) {
        const first = r.errors[0]!;
        throw new SfError(first.code, `${target.rel}: ${first.message}`, r.errors);
      }
    }
    const video = splitVideoPath(target.rel);
    const baseRel = video?.videoRel ?? '';
    const base = baseRel ? path.join(this.root, ...baseRel.split('/')) : this.root;
    let backup: string | undefined;
    if (existsSync(target.abs) && (opts.backup === 'always' || this.protectedReason(target.rel))) {
      backup = this.backup(base, baseRel, video?.inner ?? target.rel, target.abs);
    }
    this.atomicWrite(path.join(base, '.sf', 'tmp'), target.abs, content);
    const hash = sha256(content);
    this.entries.push({ path: target.rel, hash, by: opts.by, ts: new Date().toISOString() });
    if (this.entries.length > LOG_LIMIT) this.entries.splice(0, this.entries.length - LOG_LIMIT);
    return { path: target.rel, hash, ...(backup ? { backup } : {}) };
  }

  /**
   * Chép một file trong kênh sang đích (ví dụ cache → video, D4 mục 7): hard link nếu cùng ổ, nếu
   * không thì chép; luôn đổi tên nguyên tử vào đích. Không kiểm schema (nội dung đã được kiểm khi ghi gốc).
   */
  copyWithin(srcRel: string, dstRel: string, opts: { by: string }): WriteResult {
    const src = resolveInside(this.root, srcRel);
    const dst = resolveInside(this.root, dstRel);
    const video = splitVideoPath(dst.rel);
    const base = video ? path.join(this.root, ...video.videoRel.split('/')) : this.root;
    const tmpDir = path.join(base, '.sf', 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(path.dirname(dst.abs), { recursive: true });
    const tmp = path.join(tmpDir, randomUUID());
    try {
      linkSync(src.abs, tmp);
    } catch {
      copyFileSync(src.abs, tmp);
    }
    renameSync(tmp, dst.abs);
    const hash = sha256(readFileSync(dst.abs));
    this.entries.push({ path: dst.rel, hash, by: opts.by, ts: new Date().toISOString() });
    return { path: dst.rel, hash };
  }

  /**
   * Đưa một file ngoài project (thư mục tạm của công cụ, ví dụ MP4 vừa render) vào đích: chép vào
   * `.sf/tmp` rồi đổi tên nguyên tử (013).
   */
  importFile(absSrc: string, dstRel: string, opts: { by: string }): WriteResult {
    const dst = resolveInside(this.root, dstRel);
    const video = splitVideoPath(dst.rel);
    const base = video ? path.join(this.root, ...video.videoRel.split('/')) : this.root;
    const tmpDir = path.join(base, '.sf', 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(path.dirname(dst.abs), { recursive: true });
    const tmp = path.join(tmpDir, randomUUID());
    copyFileSync(absSrc, tmp);
    renameSync(tmp, dst.abs);
    const hash = sha256(readFileSync(dst.abs));
    this.entries.push({ path: dst.rel, hash, by: opts.by, ts: new Date().toISOString() });
    return { path: dst.rel, hash };
  }

  /** Xóa dữ liệu dẫn xuất (D4 mục 11): chỉ trong `cache/` hoặc `.sf/` (trừ `.sf/backups`). */
  removeDerived(rel: string): void {
    const t = resolveInside(this.root, rel);
    const derived =
      /^cache\//.test(t.rel) ||
      (/(^|\/)\.sf\//.test(t.rel) && !/(^|\/)\.sf\/backups(\/|$)/.test(t.rel));
    if (!derived)
      throw new SfError('E_PATH_OUTSIDE', `${t.rel} is not derived data; it cannot be removed`);
    rmSync(t.abs, { recursive: true, force: true });
  }

  private atomicWrite(tmpDir: string, abs: string, content: string | Buffer): void {
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = path.join(tmpDir, randomUUID());
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmp, abs);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? '';
        if (attempt >= 5 || !RETRY_CODES.has(code)) {
          rmSync(tmp, { force: true });
          throw e;
        }
        sleepSync(20 * (attempt + 1));
      }
    }
  }

  /** Artifact nằm trong một approval `approved`, hoặc HTML của frame đã ghim (D3 mục 8). */
  protectedReason(rel: string): 'overwrite_approved' | 'pinned_frame' | undefined {
    const video = splitVideoPath(rel);
    if (!video) return undefined;
    const statePath = path.join(this.root, ...video.videoRel.split('/'), 'state.json');
    if (!existsSync(statePath)) return undefined;
    let state: {
      approvals?: { status: string; artifact_hashes?: Record<string, string> }[];
      pinned_frames?: Record<string, unknown>;
    };
    try {
      state = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
      return undefined;
    }
    if (
      state.approvals?.some(
        (a) => a.status === 'approved' && a.artifact_hashes && video.inner in a.artifact_hashes,
      )
    ) {
      return 'overwrite_approved';
    }
    const frame = /^compositions\/frames\/(fr_[0-9a-z]{8})\.html$/.exec(video.inner)?.[1];
    return frame && state.pinned_frames && frame in state.pinned_frames
      ? 'pinned_frame'
      : undefined;
  }

  /** Chép bản cũ vào `<base>/.sf/backups/<ISO>/<inner>`; giữ BACKUP_KEEP bản mỗi file. */
  private backup(base: string, baseRel: string, inner: string, abs: string): string {
    const dir = path.join(base, '.sf', 'backups');
    let name = stamp();
    for (let n = 1; existsSync(path.join(dir, name, ...inner.split('/'))); n++) {
      name = `${stamp()}-${String(n).padStart(2, '0')}`;
    }
    const dest = path.join(dir, name, ...inner.split('/'));
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(abs, dest);
    const copies = readdirSync(dir)
      .filter((d) => existsSync(path.join(dir, d, ...inner.split('/'))))
      .sort();
    for (const old of copies.slice(0, Math.max(0, copies.length - BACKUP_KEEP))) {
      rmSync(path.join(dir, old, ...inner.split('/')), { force: true });
      try {
        rmdirSync(path.join(dir, old)); // chỉ xóa khi rỗng
      } catch {
        /* còn file khác */
      }
    }
    return [baseRel, '.sf', 'backups', name, inner].filter(Boolean).join('/');
  }
}
