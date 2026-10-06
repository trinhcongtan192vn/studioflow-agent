import { spawn, type ChildProcess } from 'node:child_process';
import { nodeChildEnv } from '../node-child.js';
import { existsSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SfError } from '../errors.js';
import { hfInstall } from '../hf/cli.js';
import { Logger } from '../log.js';
import { BRIDGE_PATH, startStudioProxy } from './proxy.js';
import { killTree } from '../render/hf-render.js';
import type { WriteStore } from '../store/writer.js';

/** File cảnh được chép vào bản chụp (D3 mục 1: file cảnh + caption + design system). */
const SCENE_FILES = [
  'index.html',
  'hyperframes.json',
  'frame.md',
  'caption_groups.json',
  'caption-overrides.json',
];
/** Thư mục media dùng chung bằng junction (không chép). */
const LINKED_DIRS = ['public', 'audio'];

export const snapshotRel = (videoId: string) => `videos/${videoId}/.sf/studio-preview/${videoId}`;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

function listFiles(dir: string, rel = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`],
  );
}

/**
 * Đồng bộ bản chụp chỉ đọc cho Studio (017 R1): chép file cảnh + `compositions/` qua module ghi,
 * junction `public/`, `audio/`. Studio có lưu cũng chỉ ghi vào bản chụp (bị ghi đè lần đồng bộ sau).
 */
export function syncSnapshot(store: WriteStore, videoId: string): string {
  const v = `videos/${videoId}`;
  const snap = snapshotRel(videoId);
  for (const f of SCENE_FILES)
    if (existsSync(store.abs(`${v}/${f}`)))
      store.copyWithin(`${v}/${f}`, `${snap}/${f}`, { by: 'studio.preview' });
  for (const f of listFiles(store.abs(`${v}/compositions`)))
    store.copyWithin(`${v}/compositions/${f}`, `${snap}/compositions/${f}`, {
      by: 'studio.preview',
    });
  for (const d of LINKED_DIRS) store.linkDir(`${v}/${d}`, `${snap}/${d}`);
  return store.abs(snap);
}

/**
 * `hyperframes preview` bản ghim trên một thư mục dự án (bản chụp 017 hoặc bản làm việc 025), cổng tự do
 * trên 127.0.0.1; chờ máy chủ trả lời.
 */
export async function startHfStudio(
  dir: string,
  o: { timeoutMs?: number } = {},
): Promise<{ child: ChildProcess; port: number; url: string }> {
  const port = await freePort();
  const { bin } = hfInstall();
  const child = spawn(
    process.execPath,
    [bin, 'preview', dir, '--port', String(port), '--no-open', '--foreground', '--force-new'],
    {
      // cwd ngoài thư mục dự án: Windows không xóa được thư mục đang là cwd của tiến trình (025)
      cwd: tmpdir(),
      env: nodeChildEnv({
        ...process.env,
        HYPERFRAMES_NO_TELEMETRY: '1',
        HYPERFRAMES_SKIP_SKILLS: '1',
        DO_NOT_TRACK: '1',
      }),
      windowsHide: true,
    },
  );
  let log = '';
  child.stdout?.on('data', (d: Buffer) => (log = (log + d.toString('utf8')).slice(-4000)));
  child.stderr?.on('data', (d: Buffer) => (log = (log + d.toString('utf8')).slice(-4000)));
  const url = `http://127.0.0.1:${port}/#project/${path.basename(dir)}`;
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode !== null)
      throw new SfError('E_STUDIO_PROCESS', `hyperframes preview exited: ${log.slice(-500)}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.ok) break;
    } catch {
      /* chưa sẵn sàng */
    }
    if (Date.now() - t0 > (o.timeoutMs ?? 60_000)) {
      if (child.pid) killTree(child.pid);
      throw new SfError(
        'E_STUDIO_PROCESS',
        `hyperframes preview did not start: ${log.slice(-500)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { child, port, url };
}

interface Running {
  child: ChildProcess;
  url: string;
  proxy?: { port: number; close(): Promise<void> };
  watcher?: FSWatcher;
  timer?: NodeJS.Timeout;
}

/**
 * `studio.open {mode:'preview'}` (D9 mục 2, 017): `hyperframes preview` bản ghim trên bản chụp,
 * cổng ngẫu nhiên trên 127.0.0.1; tự đồng bộ lại khi file cảnh của video đổi (Studio tự tải lại).
 */
export class StudioPreviews {
  private readonly running = new Map<string, Running>();
  constructor(private readonly logger = new Logger()) {}

  async open(
    store: WriteStore,
    videoId: string,
    o: { timeoutMs?: number } = {},
  ): Promise<{ url: string; port: number }> {
    const key = `${store.root}|${videoId}`;
    const cur = this.running.get(key);
    if (cur && cur.child.exitCode === null)
      return { url: cur.url, port: Number(new URL(cur.url).port) };
    if (!existsSync(store.abs(`videos/${videoId}/index.html`))) {
      throw new SfError(
        'E_FILE_NOT_FOUND',
        `video ${videoId} has no index.html yet; build the frames first`,
      );
    }
    const dir = syncSnapshot(store, videoId);
    const hf = await startHfStudio(dir, o);
    // 028: qua proxy chỉ đọc + trang cầu nối cùng origin (WebMCP: mốc đầu phát, phần tử đang chọn)
    const proxy = await startStudioProxy(hf.port, { readOnly: true });
    const child = hf.child;
    const port = proxy.port;
    const url = `http://127.0.0.1:${port}${BRIDGE_PATH}${new URL(hf.url).hash}`;
    const run: Running = { child, url, proxy };
    const videoDir = store.abs(`videos/${videoId}`);
    try {
      run.watcher = watch(videoDir, { recursive: true }, (_ev, file) => {
        const f = String(file ?? '').replaceAll('\\', '/');
        if (
          !/^(index\.html|hyperframes\.json|frame\.md|caption_groups\.json|caption-overrides\.json|compositions\/)/.test(
            f,
          )
        )
          return;
        clearTimeout(run.timer);
        run.timer = setTimeout(() => {
          try {
            syncSnapshot(store, videoId);
          } catch (e) {
            this.logger.write('warn', 'sf.studio.sync', {
              video_id: videoId,
              error: String((e as Error).message),
            });
          }
        }, 300);
      });
    } catch {
      /* không theo dõi được → vẫn xem được, tải lại khi mở lại */
    }
    this.running.set(key, run);
    this.logger.write('info', 'sf.studio.preview', { video_id: videoId, url });
    return { url, port };
  }

  close(store: WriteStore, videoId: string): boolean {
    const key = `${store.root}|${videoId}`;
    const r = this.running.get(key);
    if (!r) return false;
    this.stop(r);
    this.running.delete(key);
    return true;
  }

  closeAll(): void {
    for (const r of this.running.values()) this.stop(r);
    this.running.clear();
  }

  private stop(r: Running): void {
    clearTimeout(r.timer);
    r.watcher?.close();
    void r.proxy?.close();
    if (r.child.pid && r.child.exitCode === null) killTree(r.child.pid);
  }
}

/** Thời điểm sửa gần nhất của một file trong bản chụp (cho test đồng bộ). */
export function snapshotMtime(store: WriteStore, videoId: string, rel: string): number | undefined {
  const f = store.abs(`${snapshotRel(videoId)}/${rel}`);
  return existsSync(f) ? statSync(f).mtimeMs : undefined;
}
