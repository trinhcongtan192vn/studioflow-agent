import type { ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { VideoState } from '../contracts/types.js';
import { setConfig } from '../config/resolve.js';
import { sha256 } from '../domain/hash.js';
import { newId } from '../domain/ids.js';
import { parseStoryboard, serializeStoryboard } from '../domain/markdown/storyboard.js';
import { lookFromGrading } from '../finish/grading.js';
import { styleIds } from '../finish/styles.js';
import { SfError } from '../errors.js';
import { BuildGraph, type BuilderRegistry } from '../graph/graph.js';
import { hfLint } from '../hf/cli.js';
import type { JobQueue } from '../jobs/queue.js';
import { killTree } from '../render/hf-render.js';
import type { WriteStore } from '../store/writer.js';
import { diffHtml, stripStudioMarks, type StudioChange } from './diff.js';
import { startHfStudio } from './preview.js';
import { BRIDGE_PATH, startStudioProxy } from './proxy.js';

/** File cảnh chép vào bản làm việc (D9 3.1); `public/`, `audio/` là junction chỉ đọc. */
const WORK_FILES = [
  'index.html',
  'hyperframes.json',
  'frame.md',
  'caption_groups.json',
  'caption-overrides.json',
];
const LINKED = ['public', 'audio'];

interface EditSession {
  id: string;
  /** `videos/<vd>/.sf/studio-work/<ss>` */
  work: string;
  /** Hash file gốc lúc mở (D9 3.1 bước 4) — tương đối video. */
  base: Record<string, string>;
  child: ChildProcess;
  proxy: { port: number; close(): Promise<void> };
  url: string;
  /** Id dự án do Studio đặt (`/api/projects`). */
  project: string;
}

function listFiles(dir: string, rel = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`],
  );
}

const FRAME_FILE = /^compositions\/frames\/fr_[0-9a-z]{8}\.html$/;

export interface CommitResult {
  changed_files: string[];
  pinned_frames: string[];
  /** 094: frame nhận nguyên khối (có thay đổi ngoài danh sách D9 3.3) — sinh lại không áp lại tự động. */
  whole_frames: string[];
  readback_changes: { kind: string; target: string; value: unknown }[];
}

/**
 * Studio chế độ chỉnh (D9 mục 3, 025): bản làm việc + proxy chặn API ghi ngoài danh sách; `commit` lọc
 * diff DOM theo danh sách cho phép, read-back, ghi qua module ghi, cập nhật frame ghim; `close`.
 */
export class StudioEdits {
  private readonly sessions = new Map<string, EditSession>();

  constructor(
    private readonly d: { queue?: JobQueue; builders?: BuilderRegistry; appDataDir?: string },
  ) {}

  private key(store: WriteStore, videoId: string) {
    return `${store.root}|${videoId}`;
  }

  private readState(store: WriteStore, videoId: string): VideoState {
    return JSON.parse(
      readFileSync(store.abs(`videos/${videoId}/state.json`), 'utf8'),
    ) as VideoState;
  }

  private writeState(store: WriteStore, videoId: string, st: VideoState): void {
    store.write(`videos/${videoId}/state.json`, `${JSON.stringify(st, null, 2)}\n`, {
      by: 'studio',
    });
  }

  /** File cảnh hiện có của video (tương đối video). */
  private sceneFiles(store: WriteStore, videoId: string): string[] {
    const v = `videos/${videoId}`;
    return [
      ...WORK_FILES.filter((f) => existsSync(store.abs(`${v}/${f}`))),
      ...listFiles(store.abs(`${v}/compositions`)).map((f) => `compositions/${f}`),
    ];
  }

  /** 045: phiên sửa Studio đang mở (`<kênh>|<video>`). */
  openKeys(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * 045: khóa `owner = studio` còn sót khi không có phiên Studio nào đang chạy trong app (app tắt lúc
   * Studio mở) → nhả khóa để agent ghi được. Bản làm việc không có thay đổi chưa commit thì xóa; có thì
   * giữ lại (không mất chỉnh sửa) và báo danh sách file.
   */
  recoverStale(
    store: WriteStore,
    videoId: string,
  ): { released: boolean; kept: { work: string; files: string[] }[] } {
    if (this.sessions.has(this.key(store, videoId))) return { released: false, kept: [] };
    const st = this.readState(store, videoId);
    if (st.owner !== 'studio') return { released: false, kept: [] };
    const root = `videos/${videoId}/.sf/studio-work`;
    const kept: { work: string; files: string[] }[] = [];
    const dirs = existsSync(store.abs(root))
      ? readdirSync(store.abs(root), { withFileTypes: true }).filter((e) => e.isDirectory())
      : [];
    for (const d of dirs) {
      const work = `${root}/${d.name}`;
      let base: Record<string, string> = {};
      try {
        base = JSON.parse(readFileSync(store.abs(`${work}/base.json`), 'utf8')) as Record<
          string,
          string
        >;
      } catch {
        /* thiếu base.json → so toàn bộ file cảnh trong bản làm việc */
      }
      const files = this.pending(store, videoId, { base, work });
      if (files.length) kept.push({ work, files });
      else
        try {
          store.removeDerived(work);
        } catch {
          /* file còn bị giữ → dọn ở lần dọn đĩa sau */
        }
    }
    st.owner = 'agent';
    delete st.owner_since;
    this.writeState(store, videoId, st);
    return { released: true, kept };
  }

  session(
    store: WriteStore,
    videoId: string,
  ): { id: string; url: string; project: string } | undefined {
    const s = this.sessions.get(this.key(store, videoId));
    return s ? { id: s.id, url: s.url, project: s.project } : undefined;
  }

  /** `studio.open {mode:'edit'}` (D9 3.1). */
  async open(
    store: WriteStore,
    videoId: string,
    o: { timeoutMs?: number } = {},
  ): Promise<{ url: string; session_id: string; project_id: string }> {
    const existing = this.sessions.get(this.key(store, videoId));
    if (existing)
      return { url: existing.url, session_id: existing.id, project_id: existing.project };
    const v = `videos/${videoId}`;
    if (!existsSync(store.abs(`${v}/index.html`)))
      throw new SfError(
        'E_FILE_NOT_FOUND',
        `video ${videoId} has no index.html yet; build the frames first`,
      );
    const busy = (this.d.queue?.list({ status: 'running', video_id: videoId }) ?? []).filter(
      (j) => j.channel_dir === undefined || j.channel_dir === store.root,
    );
    if (busy.length)
      throw new SfError(
        'E_STUDIO_BUSY',
        `jobs are writing this video (${busy.map((j) => j.kind).join(', ')}); wait for them to finish`,
      );
    const st = this.readState(store, videoId);
    st.owner = 'studio';
    st.owner_since = new Date().toISOString() as VideoState['owner_since'];
    this.writeState(store, videoId, st);
    const id = newId('ss');
    const work = `${v}/.sf/studio-work/${id}`;
    const base: Record<string, string> = {};
    try {
      for (const f of this.sceneFiles(store, videoId)) {
        store.copyWithin(`${v}/${f}`, `${work}/${f}`, { by: 'studio.edit' });
        base[f] = sha256(readFileSync(store.abs(`${v}/${f}`)));
      }
      for (const d of LINKED)
        if (existsSync(store.abs(`${v}/${d}`))) store.linkDir(`${v}/${d}`, `${work}/${d}`);
      store.write(`${work}/base.json`, `${JSON.stringify(base, null, 2)}\n`, {
        by: 'studio.edit',
        validate: false,
      });
      const studio = await startHfStudio(store.abs(work), o);
      const proxy = await startStudioProxy(studio.port);
      // Studio tự đặt id dự án (025 R1) → lấy từ /api/projects
      const listed = (await (
        await fetch(`http://127.0.0.1:${studio.port}/api/projects`)
      ).json()) as {
        projects?: { id: string }[];
      };
      const project = listed.projects?.[0]?.id ?? id;
      const url = `http://127.0.0.1:${proxy.port}${BRIDGE_PATH}#project/${project}`;
      this.sessions.set(this.key(store, videoId), {
        id,
        work,
        base,
        child: studio.child,
        proxy,
        url,
        project,
      });
      return { url, session_id: id, project_id: project };
    } catch (e) {
      st.owner = 'agent';
      delete st.owner_since;
      this.writeState(store, videoId, st);
      throw e;
    }
  }

  /** Nội dung bản làm việc đã bỏ đánh dấu Studio (HTML, 025 R1). */
  private workContent(abs: string): string {
    const t = readFileSync(abs, 'utf8');
    return abs.endsWith('.html') ? stripStudioMarks(t) : t;
  }

  /** Thay đổi giữa bản làm việc và bản gốc (tương đối video) — không phân loại. */
  private pending(
    store: WriteStore,
    videoId: string,
    s: Pick<EditSession, 'base' | 'work'>,
  ): string[] {
    const files = new Set([
      ...Object.keys(s.base),
      ...listFiles(store.abs(`${s.work}/compositions`)).map((f) => `compositions/${f}`),
    ]);
    return [...files].filter((f) => {
      const w = store.abs(`${s.work}/${f}`);
      const o = store.abs(`videos/${videoId}/${f}`);
      if (!existsSync(w)) return existsSync(o);
      if (!existsSync(o)) return true;
      const work = this.workContent(w);
      const orig = readFileSync(o, 'utf8');
      if (work === orig) return false;
      // HTML: Studio chuẩn hóa định dạng bất kỳ lúc nào (017 R1) → chỉ thay đổi DOM mới tính
      return f.endsWith('.html') ? diffHtml(orig, work, f).length > 0 : true;
    });
  }

  /** `studio.commit` (D9 3.2). */
  async commit(store: WriteStore, videoId: string): Promise<CommitResult> {
    const s = this.sessions.get(this.key(store, videoId));
    if (!s)
      throw new SfError(
        'E_STUDIO_PROCESS',
        'no Studio edit session for this video; open it with studio.open {mode: "edit"}',
      );
    const v = `videos/${videoId}`;
    // 1. file gốc đổi ngoài phiên
    const moved = Object.entries(s.base).filter(([f, h]) => {
      const o = store.abs(`${v}/${f}`);
      return !existsSync(o) || sha256(readFileSync(o)) !== h;
    });
    if (moved.length)
      throw new SfError(
        'E_BASE_HASH_MISMATCH',
        `changed outside Studio while editing: ${moved.map(([f]) => f).join(', ')}`,
      );
    // 2–3. diff DOM theo danh sách cho phép
    const files = this.pending(store, videoId, s);
    const changes: StudioChange[] = [];
    for (const f of files) {
      const w = store.abs(`${s.work}/${f}`);
      const o = store.abs(`${v}/${f}`);
      if (!existsSync(w) || !existsSync(o)) {
        changes.push({
          file: f,
          element_id: '*',
          attr: 'file',
          before: null,
          after: null,
          allowed: false,
          reason: existsSync(w) ? 'thêm file không được phép' : 'xóa file không được phép',
        });
        continue;
      }
      if (!f.endsWith('.html')) {
        changes.push({
          file: f,
          element_id: '*',
          attr: 'file',
          before: null,
          after: null,
          allowed: false,
          reason: `${f} chỉ sửa qua chat/bảng caption`,
        });
        continue;
      }
      changes.push(...diffHtml(readFileSync(o, 'utf8'), this.workContent(w), f));
    }
    // 094: file frame có thay đổi ngoài danh sách → nhận nguyên frame (D9 3.4 c, ghim '*'); file khác giữ luật cũ
    const isFrame = (f: string) => FRAME_FILE.test(f);
    const whole = new Set(
      changes.filter((c) => !c.allowed && c.attr !== 'file' && isFrame(c.file)).map((c) => c.file),
    );
    const bad = changes.filter((c) => !c.allowed && !whole.has(c.file));
    if (bad.length)
      throw new SfError(
        'E_STUDIO_DISALLOWED_CHANGE',
        `${bad.length} change(s) are not allowed: ${bad
          .slice(0, 5)
          .map((c) => `${c.file} ${c.element_id} ${c.attr}: ${c.reason}`)
          .join('; ')}`,
        bad,
      );
    if (!files.length)
      return { changed_files: [], pinned_frames: [], whole_frames: [], readback_changes: [] };
    // 4. data-sf-id không trùng; lint bản làm việc
    for (const f of files) {
      const ids = [
        ...this.workContent(store.abs(`${s.work}/${f}`)).matchAll(
          /data-sf-id\s*=\s*["']([^"']+)["']/g,
        ),
      ].map((m) => m[1]!);
      const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
      if (dup.length)
        throw new SfError(
          'E_STUDIO_DISALLOWED_CHANGE',
          `${f}: duplicate data-sf-id ${[...new Set(dup)].join(', ')}`,
        );
    }
    const lint = await hfLint(store.abs(s.work));
    if (!lint.ok)
      throw new SfError(
        'E_GATE_FAILED',
        `hyperframes lint: ${lint.findings
          .filter((f) => f.severity === 'error')
          .slice(0, 5)
          .map((f) => `${f.code}: ${f.message}`)
          .join('; ')}`,
      );
    // 5. read-back (D9 4)
    const readback: CommitResult['readback_changes'] = [];
    for (const c of changes) {
      const fr = /^compositions\/frames\/(fr_[0-9a-z]{8})\.html$/.exec(c.file)?.[1];
      // preset grade đổi trong Studio → look có cùng preset (027); grade tự do → chỉ là manual delta
      const look =
        fr && c.attr === 'data-color-grading' && c.after
          ? lookFromGrading(c.after, styleIds(this.d.appDataDir), this.d.appDataDir)
          : undefined;
      if (fr && look && !readback.some((x) => x.kind === 'look' && x.target === fr)) {
        const sbRel = `${v}/STORYBOARD.md`;
        const p = parseStoryboard(readFileSync(store.abs(sbRel), 'utf8'));
        const blk = p.blocks.find(
          (b) => b.tag === 'sf-frame' && (b.data as { id?: string }).id === fr,
        );
        if (blk) {
          const data = blk.data as { config?: Record<string, unknown> };
          data.config = { ...(data.config ?? {}), 'look.id': look };
          store.write(sbRel, serializeStoryboard(p), { by: 'studio.commit' });
          readback.push({ kind: 'look', target: fr, value: look });
        }
      }
      // mức nhạc nền (phần tử `#el-music` của index, D8 mục 3) → `music.volume_db` tầng video
      if (
        c.file === 'index.html' &&
        c.element_id === '#el-music' &&
        c.attr === 'data-volume-db' &&
        c.after !== null
      ) {
        setConfig(store, 'music.volume_db', Number(c.after), { tier: 'video', videoId });
        readback.push({ kind: 'music.volume_db', target: videoId, value: Number(c.after) });
      }
    }
    // 6. ghi file + frame ghim
    const st = this.readState(store, videoId);
    const pinned: string[] = [];
    for (const f of files) {
      const before = readFileSync(store.abs(`${v}/${f}`));
      store.write(`${v}/${f}`, this.workContent(store.abs(`${s.work}/${f}`)), {
        by: 'studio.commit',
        validate: false,
      });
      s.base[f] = sha256(readFileSync(store.abs(`${v}/${f}`)));
      const fr = /^compositions\/frames\/(fr_[0-9a-z]{8})\.html$/.exec(f)?.[1];
      if (!fr) continue;
      // nhận nguyên frame: thay đổi trong danh sách vẫn ghi từng mục (áp lại được), phần còn lại gộp vào '*'
      const mine = changes.filter((c) => c.file === f && c.allowed);
      if (whole.has(f))
        mine.push({
          file: f,
          element_id: '*',
          attr: 'frame',
          before: null,
          after: null,
          allowed: true,
        });
      const prev = (st.pinned_frames ?? {})[fr as keyof VideoState['pinned_frames']] as
        | {
            pinned_at: string;
            base_hash: string;
            changes: {
              element_id: string;
              attr: string;
              before: string | null;
              after: string | null;
            }[];
          }
        | undefined;
      const merged = new Map((prev?.changes ?? []).map((c) => [`${c.element_id}|${c.attr}`, c]));
      for (const c of mine) {
        const k = `${c.element_id}|${c.attr}`;
        merged.set(k, {
          element_id: c.element_id,
          attr: c.attr,
          before: merged.get(k)?.before ?? c.before,
          after: c.after,
        });
      }
      st.pinned_frames = {
        ...(st.pinned_frames ?? {}),
        [fr]: {
          pinned_at: new Date().toISOString(),
          base_hash: prev?.base_hash ?? sha256(before),
          changes: [...merged.values()],
        },
      } as VideoState['pinned_frames'];
      pinned.push(fr);
    }
    this.writeState(store, videoId, st);
    if (pinned.length && this.d.builders)
      new BuildGraph({ store, appDataDir: this.d.appDataDir, builders: this.d.builders }).markBuilt(
        videoId,
        pinned.map((fr) => `frame_html:${fr}`),
      );
    return {
      changed_files: files,
      pinned_frames: pinned,
      whole_frames: pinned.filter((fr) => whole.has(`compositions/frames/${fr}.html`)),
      readback_changes: readback,
    };
  }

  /** `studio.close` (D9 3.5): còn thay đổi chưa commit → `E_STUDIO_UNCOMMITTED` trừ khi `discard`. */
  async close(
    store: WriteStore,
    videoId: string,
    o: { discard?: boolean } = {},
  ): Promise<{ closed: boolean }> {
    const s = this.sessions.get(this.key(store, videoId));
    if (!s) return { closed: false };
    const left = this.pending(store, videoId, s);
    if (left.length && !o.discard)
      throw new SfError(
        'E_STUDIO_UNCOMMITTED',
        `uncommitted Studio changes in ${left.join(', ')}; commit them or close with discard`,
      );
    await this.stop(s);
    this.sessions.delete(this.key(store, videoId));
    try {
      store.removeDerived(s.work);
    } catch {
      /* tiến trình con còn giữ file: bản làm việc (dẫn xuất) được dọn ở lần dọn đĩa sau */
    }
    const st = this.readState(store, videoId);
    st.owner = 'agent';
    delete st.owner_since;
    this.writeState(store, videoId, st);
    return { closed: true };
  }

  /** Dừng proxy + Studio và chờ tiến trình thoát (còn giữ file thì xóa bản làm việc lỗi EBUSY). */
  private async stop(s: EditSession): Promise<void> {
    await s.proxy.close();
    if (s.child.pid && s.child.exitCode === null) {
      const exited = new Promise<void>((r) => s.child.once('exit', () => r()));
      killTree(s.child.pid);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
  }

  async closeAll(): Promise<void> {
    for (const s of this.sessions.values()) await this.stop(s);
    this.sessions.clear();
  }
}
