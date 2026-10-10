import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { SfError } from '../errors.js';
import { artifactKind } from '../domain/artifacts.js';
import { sha256 } from '../domain/hash.js';
import { validateArtifact } from '../domain/validate.js';
import { resolveInside, splitVideoPath } from './paths.js';
import { isAutoApproval } from '../domain/autopilot.js';

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

/**
 * Đổi tên tệp tạm thành đích; Windows: đích đang được đọc (phát trong app, diệt virus quét, tiến trình lõi cũ
 * chưa thoát) → EPERM/EBUSY tạm thời → thử lại (~2,4 s), hết lượt thì xóa tệp tạm và báo lỗi.
 */
function renameRetry(tmp: string, abs: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, abs);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (attempt >= 15 || !RETRY_CODES.has(code)) {
        rmSync(tmp, { force: true });
        throw e;
      }
      sleepSync(20 * (attempt + 1));
    }
  }
}

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

  private readonly listeners = new Set<(rel: string, hash: string) => void>();

  /** Nghe mọi lần ghi của module ghi (file watcher phân biệt ghi của app với sửa ngoài app, 025). */
  subscribe(fn: (rel: string, hash: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private record(rel: string, hash: string, by: string): void {
    this.entries.push({ path: rel, hash, by, ts: new Date().toISOString() });
    if (this.entries.length > LOG_LIMIT) this.entries.splice(0, this.entries.length - LOG_LIMIT);
    for (const fn of this.listeners) fn(rel, hash);
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
    this.record(target.rel, hash, opts.by);
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
    renameRetry(tmp, dst.abs);
    const hash = sha256(readFileSync(dst.abs));
    this.record(dst.rel, hash, opts.by);
    return { path: dst.rel, hash };
  }

  /**
   * Liên kết thư mục (junction trên Windows) trong dữ liệu dẫn xuất `.sf/` tới thư mục của project —
   * bản chụp xem trước Studio dùng chung `public/`, `audio/` mà không chép (017).
   */
  linkDir(targetRel: string, linkRel: string): void {
    const target = resolveInside(this.root, targetRel);
    const link = resolveInside(this.root, linkRel);
    if (!/(^|\/)\.sf\//.test(link.rel))
      throw new SfError('E_PATH_OUTSIDE', `${link.rel}: links only inside .sf/`);
    if (existsSync(link.abs)) return;
    mkdirSync(path.dirname(link.abs), { recursive: true });
    mkdirSync(target.abs, { recursive: true });
    symlinkSync(target.abs, link.abs, 'junction');
  }

  /** Ghi nối một dòng vào file chỉ-nối-đuôi (chat log `chat/<session_id>.jsonl`, D3 5.16). */
  appendLine(rel: string, line: string, opts: { by: string }): void {
    const target = resolveInside(this.root, rel);
    mkdirSync(path.dirname(target.abs), { recursive: true });
    appendFileSync(target.abs, `${line.replace(/\r?\n/g, ' ')}\n`);
    this.record(target.rel, '', opts.by);
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
    renameRetry(tmp, dst.abs);
    const hash = sha256(readFileSync(dst.abs));
    this.record(dst.rel, hash, opts.by);
    return { path: dst.rel, hash };
  }

  /**
   * 064 (constitution 1.1, Điều VI ngoại lệ): chuyển cả thư mục trong project (video ↔ thùng rác `.trash/`).
   * Chỉ cho `videos/<vd>` → `.trash/<vd>-<thời điểm>` và ngược lại; đích phải chưa tồn tại.
   */
  moveDir(srcRel: string, dstRel: string, opts: { by: string }): void {
    const src = resolveInside(this.root, srcRel);
    const dst = resolveInside(this.root, dstRel);
    const VIDEO = /^videos\/vd_[0-9a-z]{8}$/;
    const TRASH = /^\.trash\/vd_[0-9a-z]{8}-\d{14}$/;
    if (!(
      (VIDEO.test(src.rel) && TRASH.test(dst.rel)) ||
      (TRASH.test(src.rel) && VIDEO.test(dst.rel))
    ))
      throw new SfError('E_PATH_OUTSIDE', `moving ${src.rel} → ${dst.rel} is not allowed`);
    if (!existsSync(src.abs)) throw new SfError('E_FILE_NOT_FOUND', `${src.rel} does not exist`);
    if (existsSync(dst.abs)) throw new SfError('E_ID_DUPLICATE', `${dst.rel} already exists`);
    mkdirSync(path.dirname(dst.abs), { recursive: true });
    // Windows: tiến trình vừa đóng có thể còn giữ file vài trăm ms → thử lại
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(src.abs, dst.abs);
        break;
      } catch (e) {
        if (
          attempt >= 15 ||
          !['EBUSY', 'EPERM', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')
        )
          throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
    }
    this.record(dst.rel, '', opts.by);
  }

  /**
   * Dọn rác do agent yêu cầu: giọng `voices/<vo>` hoặc tệp thư viện `assets/files/<as>.<ext>` → `.trash/voices|assets/`
   * (khôi phục tay được). Chỉ hai loại nguồn này; đích phải chưa tồn tại.
   */
  moveToTrash(srcRel: string, dstRel: string, opts: { by: string }): void {
    const src = resolveInside(this.root, srcRel);
    const dst = resolveInside(this.root, dstRel);
    const ok =
      (/^voices\/vo_[0-9a-z]{8}$/.test(src.rel) &&
        /^\.trash\/voices\/vo_[0-9a-z]{8}-\d{14}$/.test(dst.rel)) ||
      (/^assets\/files\/as_[0-9a-z]{8}\.[a-z0-9]+$/.test(src.rel) &&
        /^\.trash\/assets\/as_[0-9a-z]{8}-\d{14}\.[a-z0-9]+$/.test(dst.rel));
    if (!ok) throw new SfError('E_PATH_OUTSIDE', `moving ${src.rel} → ${dst.rel} is not allowed`);
    if (!existsSync(src.abs)) throw new SfError('E_FILE_NOT_FOUND', `${src.rel} does not exist`);
    if (existsSync(dst.abs)) throw new SfError('E_ID_DUPLICATE', `${dst.rel} already exists`);
    mkdirSync(path.dirname(dst.abs), { recursive: true });
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(src.abs, dst.abs);
        break;
      } catch (e) {
        if (attempt >= 15 || !RETRY_CODES.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
        sleepSync(200);
      }
    }
    this.record(dst.rel, '', opts.by);
  }

  /** 064: xóa hẳn một mục trong thùng rác của kênh (`.trash/<id>`) — chỉ ở đây, không nơi nào khác. */
  purgeTrash(rel: string): void {
    const t = resolveInside(this.root, rel);
    if (!/^\.trash\/vd_[0-9a-z]{8}-\d{14}$/.test(t.rel))
      throw new SfError('E_PATH_OUTSIDE', `${t.rel} is not a trash entry; it cannot be removed`);
    rmSync(t.abs, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  }

  /**
   * Xóa dữ liệu dẫn xuất (D4 mục 11): `cache/`, `.sf/` (sao lưu `.sf/backups` chỉ khi người dùng chọn),
   * render nháp `videos/<vd>/renders/<rd>` (không bao giờ render phát hành) (024).
   */
  removeDerived(rel: string, opts: { userRequested?: boolean } = {}): void {
    const t = resolveInside(this.root, rel);
    const backups = /(^|\/)\.sf\/backups(\/|$)/.test(t.rel);
    const render = /^videos\/vd_[0-9a-z]{8}\/renders\/rd_[0-9a-z]{8}$/.exec(t.rel);
    let draftRender = false;
    if (render) {
      try {
        const rec = JSON.parse(readFileSync(path.join(t.abs, 'render.json'), 'utf8')) as {
          mode?: string;
        };
        draftRender = rec.mode !== 'release';
      } catch {
        draftRender = false;
      }
    }
    const derived =
      /^cache\//.test(t.rel) ||
      (/(^|\/)\.sf\//.test(t.rel) && (!backups || Boolean(opts.userRequested))) ||
      draftRender;
    if (!derived)
      throw new SfError('E_PATH_OUTSIDE', `${t.rel} is not derived data; it cannot be removed`);
    // Windows: tiến trình vừa dừng (Studio) có thể còn giữ file vài trăm ms → thử lại
    rmSync(t.abs, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
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
    renameRetry(tmp, abs);
  }

  /** Artifact nằm trong một approval `approved`, hoặc HTML của frame đã ghim (D3 mục 8). */
  protectedReason(rel: string): 'overwrite_approved' | 'pinned_frame' | undefined {
    const video = splitVideoPath(rel);
    if (!video) return undefined;
    const statePath = path.join(this.root, ...video.videoRel.split('/'), 'state.json');
    if (!existsSync(statePath)) return undefined;
    let state: {
      approvals?: { status: string; note?: string; artifact_hashes?: Record<string, string> }[];
      pinned_frames?: Record<string, unknown>;
    };
    try {
      state = JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {
      return undefined;
    }
    if (
      state.approvals?.some(
        (a) =>
          a.status === 'approved' &&
          !isAutoApproval(a) && // 034: approval tự duyệt không khóa file
          a.artifact_hashes &&
          video.inner in a.artifact_hashes,
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
