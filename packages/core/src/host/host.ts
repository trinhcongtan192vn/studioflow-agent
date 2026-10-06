import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRuntime } from '../agent/index.js';
import { sessionOptionsFor } from '../agent/options.js';
import type {
  AgentRuntime,
  AgentSession,
  CaptionOverrides,
  ContextRef,
  MusicFindInput,
  SessionContext,
  SettingsConfig,
  VideoState,
} from '../contracts/types.js';
import { defaultAppDataDir, resolveConfig, setConfig } from '../config/resolve.js';
import { createCore, type Core, type CoreOptions } from '../core.js';
import { detectChannel, initChannel } from '../domain/channel.js';
import { newId } from '../domain/ids.js';
import { createVideo, listVideoIds } from '../domain/video.js';
import { isSfError, SfError } from '../errors.js';
import type { IpcEvents, IpcMethod, IpcMethods, ChatLine, ExplorerNode } from '../ipc/schema.js';
import { UPLOAD_LIMIT, UPLOAD_TYPES } from '../ipc/schema.js';
import { DEFAULT_SETTINGS, installPlan } from '../models/install.js';
import { validateChannel } from '../domain/channel-validate.js';
import { watchVideo } from '../studio/watch.js';
import { costCsv, costReport } from '../trace/cost.js';
import { diskUsage } from '../disk/usage.js';
import { cleanChannel, type CleanTarget } from '../disk/clean.js';
import { findMusic } from '../music/find.js';
import { appLibrary, readMusicManifest } from '../music/library.js';
import { WriteStore } from '../store/writer.js';
import { getTrace, listTraces } from '../trace/trace.js';
import { CORE_VERSION } from '../version.js';
import type { WorkflowEngine } from '../workflow/engine.js';

interface OpenSession {
  id: string;
  packDir?: string;
  session: AgentSession;
  chatRel: string;
}

const EXPLORER_SKIP = new Set(['cache', '.sf', 'node_modules', '.git']);

/**
 * Tiến trình `core` của app desktop (D4 mục 1, D10 mục 4, 008): một `createCore`, runtime agent,
 * phiên `main` theo video (lịch sử `chat/<session_id>.jsonl`), phương thức IPC và sự kiện.
 */
export class CoreHost extends EventEmitter {
  readonly core: Core;
  readonly runtime: AgentRuntime;
  private readonly sessions = new Map<string, OpenSession>();
  private readonly watched = new Set<string>();
  private readonly announced = new Set<string>();

  constructor(opts: CoreOptions & { runtime?: AgentRuntime } = {}) {
    super();
    const appDataDir = opts.appDataDir ?? defaultAppDataDir();
    this.core = createCore({ ...opts, appDataDir });
    this.runtime = opts.runtime ?? createRuntime({ gateway: this.core.gateway });
    this.core.queue.on('job.updated', (j) => this.send('job.updated', j));
    this.core.gateway.permissions.on('permission.requested', (r) =>
      this.send('permission.requested', r),
    );
    this.core.workflows.setAgentRuntime(this.runtime);
    // bước agent của workflow (storyboard…) chạy trong phiên `main` của video, hiện trong chat
    this.core.workflows.setAgentRunner(async (instruction, ctx) => {
      await this.chat(ctx.channelDir, ctx.videoId, instruction, [], 'system');
    });
  }

  private send<K extends keyof IpcEvents>(name: K, data: IpcEvents[K]): void {
    this.emit('event', name, data);
  }

  private watcher?: { close(): void };

  close(): void {
    this.watcher?.close();
    for (const s of this.sessions.values()) void s.session.close();
    this.core.close();
  }

  // ---------- kênh / video ----------

  private store(channel: string): WriteStore {
    return this.core.gateway.storeFor(path.resolve(channel));
  }

  private videos(channel: string) {
    return listVideoIds(channel)
      .map((id) => {
        const f = path.join(channel, 'videos', id, 'state.json');
        if (!existsSync(f)) return undefined;
        const st = JSON.parse(readFileSync(f, 'utf8')) as VideoState;
        const brief = path.join(channel, 'videos', id, 'BRIEF.md');
        const title = existsSync(brief)
          ? (/title_working:\s*(.*)/
              .exec(readFileSync(brief, 'utf8'))?.[1]
              ?.replace(/^['"]|['"]$/g, '') ?? '')
          : '';
        return { id, title: title || id, phase: st.phase, updated_at: st.updated_at };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  private settings(): SettingsConfig {
    const f = path.join(this.core.appDataDir, 'settings.json');
    return existsSync(f)
      ? (JSON.parse(readFileSync(f, 'utf8')) as SettingsConfig)
      : structuredClone(DEFAULT_SETTINGS);
  }

  private saveSettings(s: SettingsConfig): void {
    new WriteStore(this.core.appDataDir).write('settings.json', `${JSON.stringify(s, null, 2)}\n`, {
      by: 'settings',
    });
  }

  private rememberChannel(dir: string): void {
    const s = this.settings();
    s.recent_channels = [
      { path: dir, opened_at: new Date().toISOString() },
      ...s.recent_channels.filter((c) => c.path !== dir),
    ].slice(0, 10);
    this.saveSettings(s);
  }

  private engine(channel: string, video: string): WorkflowEngine {
    const e = this.core.workflows.engine(path.resolve(channel), video);
    const key = `${path.resolve(channel)}|${video}`;
    if (!this.watched.has(key)) {
      this.watched.add(key);
      e.on('workflow.updated', (summary: IpcEvents['workflow.updated']) => {
        this.send('workflow.updated', { ...summary, channel });
        this.announceApprovals(channel, video, e);
      });
      // 008 UI-04: tiến độ bước đang chạy (không lưu file)
      e.on('workflow.progress', (p: Omit<IpcEvents['workflow.progress'], 'channel' | 'video'>) =>
        this.send('workflow.progress', { ...p, channel, video }),
      );
    }
    return e;
  }

  /** Thẻ duyệt (D10 mục 3) cho điểm duyệt mới. */
  private announceApprovals(channel: string, video: string, e: WorkflowEngine): void {
    const st = e.readState();
    const manifest = this.core.workflows
      .packs()
      .find((p) => p.manifest.id === st.workflow?.id)?.manifest;
    for (const a of st.approvals.filter((x) => x.status === 'pending')) {
      if (this.announced.has(a.id)) continue;
      this.announced.add(a.id);
      this.send('approval.requested', {
        channel,
        video,
        approval_id: a.id,
        step_id: a.step_id,
        title:
          a.step_id === 'brief'
            ? 'Brief'
            : (manifest?.steps.find((s) => s.id === a.step_id)?.title ?? a.step_id),
        ...(a.note ? { note: a.note } : {}),
        files: Object.keys(a.artifact_hashes),
      });
    }
  }

  // ---------- chat ----------

  private chatDir(channel: string, video?: string): string {
    return video ? `videos/${video}/chat` : 'chat';
  }

  private latestChat(channel: string, video?: string): string | undefined {
    const dir = this.store(channel).abs(this.chatDir(channel, video));
    if (!existsSync(dir)) return undefined;
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    files.sort((a, b) => statSync(path.join(dir, b)).mtimeMs - statSync(path.join(dir, a)).mtimeMs);
    return files[0] ? `${this.chatDir(channel, video)}/${files[0]}` : undefined;
  }

  history(channel: string, video?: string): ChatLine[] {
    const rel = this.latestChat(channel, video);
    if (!rel) return [];
    return readFileSync(this.store(channel).abs(rel), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ChatLine)
      .filter((l) => !(l.role === 'system' && l.content.startsWith('sdk_session:')));
  }

  private workflowPackDir(channel: string, video: string): string | undefined {
    const f = path.join(path.resolve(channel), 'videos', video, 'state.json');
    if (!existsSync(f)) return undefined;
    const id = (JSON.parse(readFileSync(f, 'utf8')) as VideoState).workflow?.id;
    return id ? this.core.workflows.packs().find((p) => p.manifest.id === id)?.dir : undefined;
  }

  private async session(channel: string, video?: string): Promise<OpenSession> {
    const key = `${path.resolve(channel)}|${video ?? ''}`;
    // plugin gói workflow của video (D5 mục 3) — đổi workflow → mở phiên mới
    const packDir = video ? this.workflowPackDir(channel, video) : undefined;
    const open = this.sessions.get(key);
    if (open && open.packDir === packDir) return open;
    if (open) void open.session.close();
    const prev = this.latestChat(channel, video);
    const id = prev ? path.basename(prev, '.jsonl') : newId('ss');
    const resume = prev
      ? readFileSync(this.store(channel).abs(prev), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as ChatLine)
          .reverse()
          .find((l) => l.role === 'system' && l.content.startsWith('sdk_session:'))
          ?.content.slice('sdk_session:'.length)
      : undefined;
    const ctx: SessionContext = {
      session_id: id as SessionContext['session_id'],
      kind: 'main',
      channel_dir: path.resolve(channel),
      ...(video ? { video_id: video as SessionContext['video_id'] } : {}),
    };
    const session = await this.runtime.openSession(
      sessionOptionsFor('main', ctx, this.core.gateway, {
        ...(resume ? { resume } : {}),
        ...(packDir ? { plugins: [packDir] } : {}),
      }),
    );
    const s = {
      id,
      session,
      chatRel: `${this.chatDir(channel, video)}/${id}.jsonl`,
      ...(packDir ? { packDir } : {}),
    };
    this.sessions.set(key, s);
    return s;
  }

  private log(channel: string, rel: string, line: Omit<ChatLine, 'ts'>): void {
    this.store(channel).appendLine(rel, JSON.stringify({ ts: new Date().toISOString(), ...line }), {
      by: 'chat',
    });
  }

  /** `chat.send`: luồng sự kiện agent → `chat.event`; ghi lịch sử (D3 5.16). */
  async chat(
    channel: string,
    video: string | undefined,
    text: string,
    attachments: { path: string; mime: string }[] = [],
    role: 'user' | 'system' = 'user',
    contextRefs: ContextRef[] = [],
  ) {
    const s = await this.session(channel, video);
    this.log(channel, s.chatRel, {
      role,
      content: text,
      ...(contextRefs.length ? { context_refs: contextRefs } : {}),
    });
    let assistant = '';
    const tools = new Map<string, { name: string; input: unknown }>();
    for await (const e of s.session.send({
      text,
      ...(attachments.length ? { attachments } : {}),
      // FR-CH-04 (028): frame/mốc/phần tử/cụm phụ đề chọn trong xem trước
      ...(contextRefs.length ? { context_refs: contextRefs } : {}),
    })) {
      this.send('chat.event', {
        ...e,
        session_id: s.id,
        channel,
        ...(video ? { video } : {}),
      } as IpcEvents['chat.event']);
      if (e.type === 'text_delta') assistant += e.text;
      else if (e.type === 'tool_call') tools.set(e.id, { name: e.name, input: e.input });
      else if (e.type === 'tool_result') {
        if (assistant) {
          this.log(channel, s.chatRel, { role: 'assistant', content: assistant });
          assistant = '';
        }
        const t = tools.get(e.id);
        this.log(channel, s.chatRel, {
          role: 'tool',
          content: e.summary,
          tool: { name: t?.name ?? '?', input: t?.input, output_summary: e.summary },
        });
      } else if (e.type === 'error')
        this.log(channel, s.chatRel, { role: 'system', content: `${e.code}: ${e.message}` });
    }
    if (assistant) this.log(channel, s.chatRel, { role: 'assistant', content: assistant });
    const sdk = (s.session as { sdkSessionId?: string }).sdkSessionId;
    if (sdk) this.log(channel, s.chatRel, { role: 'system', content: `sdk_session:${sdk}` });
    return { session_id: s.id };
  }

  // ---------- explorer (chỉ đọc, FR-WS-02) ----------

  private tree(root: string, rel = '', depth = 0): ExplorerNode {
    const abs = path.join(root, rel);
    const name = rel ? path.basename(rel) : path.basename(root);
    if (!statSync(abs).isDirectory())
      return { name, path: rel.replaceAll('\\', '/'), kind: 'file', size: statSync(abs).size };
    const children =
      depth > 6
        ? []
        : readdirSync(abs, { withFileTypes: true })
            .filter((e) => !EXPLORER_SKIP.has(e.name))
            .sort(
              (a, b) =>
                Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
            )
            .map((e) => this.tree(root, path.join(rel, e.name), depth + 1));
    return { name, path: rel.replaceAll('\\', '/'), kind: 'dir', children };
  }

  // ---------- điều phối IPC ----------

  async call<M extends IpcMethod>(
    method: M,
    params: IpcMethods[M]['params'],
  ): Promise<IpcMethods[M]['result']> {
    const p = (params ?? {}) as Record<string, unknown> & { channel: string; video: string };
    const r = await this.dispatch(method, p);
    return r as IpcMethods[M]['result'];
  }

  private async dispatch(
    method: IpcMethod,
    p: Record<string, unknown> & { channel: string; video: string },
  ): Promise<unknown> {
    const c = this.core;
    switch (method) {
      case 'app.status': {
        const plan = installPlan(c.appDataDir, 'standard');
        return {
          core_version: CORE_VERSION,
          auth: await this.runtime
            .authStatus()
            .catch((e: Error) => ({ ok: false, method: 'none', detail: e.message })),
          install: {
            profile: this.settings().installed.profile,
            total_bytes: plan.total_bytes,
            missing: plan.entries.filter((e) => e.bytes > 0).map((e) => e.key),
          },
        };
      }
      case 'channel.open': {
        const d = detectChannel(path.resolve(p.channel));
        if (d.kind !== 'channel')
          throw new SfError('E_NOT_CHANNEL', `${p.channel} has no channel.json`);
        this.rememberChannel(path.resolve(p.channel));
        return {
          config: d.config,
          videos: this.videos(path.resolve(p.channel)),
          // D6 mục 6.3: kiểm hồ sơ kênh khi mở (022)
          validation: validateChannel(path.resolve(p.channel), { appDataDir: c.appDataDir }),
        };
      }
      case 'channel.init': {
        const config = initChannel(path.resolve(p.channel), {
          name: String(p.name),
          language: p.language as 'vi',
        });
        this.rememberChannel(path.resolve(p.channel));
        return { config };
      }
      case 'channel.list_recent':
        return { channels: this.settings().recent_channels };
      case 'video.list':
        return { videos: this.videos(path.resolve(p.channel)) };
      case 'video.create':
        return {
          video_id: createVideo(this.store(p.channel), p.title ? { title: String(p.title) } : {})
            .video_id,
        };
      case 'video.open': {
        const e = this.engine(p.channel, p.video);
        e.open();
        // FR-WS-06: theo dõi video đang mở; sửa ngoài app → cảnh báo
        this.watcher?.close();
        const store = this.store(p.channel);
        const watch = watchVideo(store, p.video, (rel) =>
          this.send('file.external_change', { channel: p.channel, video: p.video, path: rel }),
        );
        const prefix = `videos/${p.video}/`;
        const unsubscribe = store.subscribe((rel, hash) => {
          if (rel.startsWith(prefix) && !rel.startsWith(`${prefix}.sf/`))
            this.send('artifact.changed', { channel: p.channel, path: rel, hash });
          // 040: brief đề xuất workflow mà chưa có điểm duyệt → tạo (thẻ Duyệt hiện trong chat)
          if (rel === `${prefix}BRIEF.md`)
            void this.engine(p.channel, p.video)
              .ensureBriefApproval()
              .catch(() => {});
        });
        this.watcher = {
          close: () => {
            unsubscribe();
            watch.close();
          },
        };
        this.announceApprovals(p.channel, p.video, e);
        return { state: e.summary(), history: this.history(p.channel, p.video) };
      }
      case 'chat.send':
        return this.chat(
          p.channel,
          p.video || undefined,
          String(p.text),
          (p.attachments as { path: string; mime: string }[]) ?? [],
          'user',
          (p.context_refs as ContextRef[] | undefined) ?? [],
        );
      case 'chat.interrupt':
        await this.sessions.get(`${path.resolve(p.channel)}|${p.video ?? ''}`)?.session.interrupt();
        return {};
      case 'chat.history':
        return { history: this.history(p.channel, p.video || undefined) };
      case 'upload.ingest': {
        const src = String(p.path_on_disk);
        const ext = path.extname(src).toLowerCase();
        const mime = UPLOAD_TYPES[ext];
        if (!mime)
          throw new SfError('E_SCHEMA_INVALID', `file type ${ext || '(none)'} cannot be attached`);
        if (statSync(src).size > UPLOAD_LIMIT)
          throw new SfError('E_UPLOAD_TOO_LARGE', `${path.basename(src)} is larger than 200 MB`);
        const inner = `uploads/${crypto.randomUUID()}${ext}`;
        this.store(p.channel).importFile(src, p.video ? `videos/${p.video}/${inner}` : inner, {
          by: 'upload.ingest',
        });
        return { rel_path: inner, mime };
      }
      case 'approval.decide': {
        const e = this.engine(p.channel, p.video);
        if (p.decision === 'approve') await e.approve(String(p.approval_id));
        else await e.requestChanges(String(p.approval_id), String(p.note ?? ''));
        return e.summary();
      }
      case 'permission.decide':
        return {
          ok: c.gateway.permissions.decide({
            request_id: String(p.request_id),
            allow: Boolean(p.allow),
            ...(p.remember ? { remember: true } : {}),
          } as never),
        };
      case 'workflow.list':
        return {
          workflows: c.workflows
            .packs()
            .filter((x) => x.compatible)
            .map((x) => ({
              id: x.manifest.id,
              title: x.manifest.title,
              version: x.manifest.version,
            })),
        };
      case 'workflow.select': {
        const e = this.engine(p.channel, p.video);
        await e.select(String(p.workflow_id), String(p.output_profile));
        return e.summary();
      }
      case 'workflow.state':
        return this.engine(p.channel, p.video).summary();
      case 'workflow.run_to':
      case 'workflow.run_step': {
        const e = this.engine(p.channel, p.video);
        void e.runTo(String(p.step_id));
        return e.summary();
      }
      case 'workflow.recheck': {
        const e = this.engine(p.channel, p.video);
        const r = await e.recheck(String(p.step_id));
        return { ...r, state: e.summary() };
      }
      case 'workflow.pause': {
        const e = this.engine(p.channel, p.video);
        e.pause();
        return e.summary();
      }
      case 'workflow.rewind': {
        const e = this.engine(p.channel, p.video);
        await e.rewind(String(p.step_id));
        return e.summary();
      }
      case 'job.list':
        return {
          jobs: c.queue.list(p.video ? { video_id: p.video } : {}).slice(0, Number(p.limit ?? 100)),
        };
      case 'job.cancel':
        return { ok: c.queue.cancel(String(p.job_id)) !== undefined };
      case 'job.retry': {
        const j = c.queue.list({}).find((x) => x.id === p.job_id);
        if (!j) throw new SfError('E_ID_UNKNOWN', `job ${String(p.job_id)} not found`);
        const n = c.queue.enqueue(j.kind, {
          ...(j.video_id ? { video_id: j.video_id } : {}),
          ...(j.channel_dir ? { channel_dir: j.channel_dir } : {}),
          payload: j.payload,
        });
        return { job_id: n.id };
      }
      case 'render.start': {
        const ctx = {
          session_id: 'ss_ui000001',
          kind: 'main',
          channel_dir: path.resolve(p.channel),
          video_id: p.video,
        } as SessionContext;
        const r = await c.gateway.call(ctx, 'render.video', { mode: p.mode });
        if (!r.ok) throw new SfError(r.error.code, r.error.message);
        return { job_id: r.job_id };
      }
      case 'music.list':
        return {
          tracks: [
            ...readMusicManifest({ scope: 'channel', store: this.store(p.channel) }).tracks.map(
              (t) => ({ ...t, scope: 'channel' }),
            ),
            ...readMusicManifest(appLibrary(c.appDataDir)).tracks.map((t) => ({
              ...t,
              scope: 'app',
            })),
          ],
        };
      case 'music.find': {
        const { channel: _c, ...q } = p;
        void _c;
        return findMusic(
          { channel: this.store(p.channel), appDataDir: c.appDataDir },
          q as MusicFindInput,
        );
      }
      case 'music.add': {
        const store = this.store(p.channel);
        const files = (p.paths_on_disk as string[]).map((src) => {
          const inner = `uploads/${crypto.randomUUID()}${path.extname(src).toLowerCase()}`;
          store.importFile(src, inner, { by: 'upload.ingest' });
          return inner;
        });
        const job = c.queue.enqueue('music.library.add', {
          channel_dir: store.root,
          payload: {
            files,
            scope: p.scope,
            ...(p.tags ? { tags: p.tags } : {}),
            ...(p.attribution ? { attribution: p.attribution } : {}),
          },
        });
        return { job_id: job.id };
      }
      case 'settings.get':
        return this.settings();
      case 'settings.set': {
        const s = this.settings();
        s.config = { ...s.config, [String(p.key)]: p.value };
        this.saveSettings(s);
        return { ok: true };
      }
      case 'install.plan':
        return installPlan(c.appDataDir, p.profile as 'standard');
      case 'install.start': {
        const plan = installPlan(c.appDataDir, p.profile as 'standard');
        const ids = plan.entries
          .filter((e) => e.status === 'missing' || e.status === 'partial')
          .map(
            (e) =>
              c.queue.enqueue('download', {
                payload: {
                  key: e.key,
                  profile: p.profile,
                  ...(p.accept_licenses ? { accept_license: true } : {}),
                },
              }).id,
          );
        return { job_ids: ids };
      }
      case 'disk.usage':
        return diskUsage({
          appDataDir: c.appDataDir,
          ...(p.channel ? { channelDir: path.resolve(String(p.channel)) } : {}),
        });
      case 'disk.clean':
        return cleanChannel(
          { db: c.db, store: this.store(String(p.channel)) },
          p.targets as CleanTarget[],
        );
      case 'trace.list':
        return {
          traces: listTraces(c.db, {
            ...(p.video ? { videoId: p.video } : {}),
            ...(p.limit ? { limit: Number(p.limit) } : {}),
          }),
        };
      case 'trace.get':
        return { spans: getTrace(c.db, String(p.trace_id)) };
      case 'explorer.tree':
        return this.tree(path.resolve(p.channel));
      case 'explorer.read': {
        const store = this.store(p.channel);
        const abs = store.abs(String(p.path));
        const size = statSync(abs).size;
        const ext = path.extname(abs).toLowerCase();
        if (
          ['.md', '.txt', '.yaml', '.yml', '.html', '.jsonl', '.css', '.js'].includes(ext) &&
          size < 2_000_000
        )
          return { kind: 'text', content: readFileSync(abs, 'utf8'), size };
        if (ext === '.json' && size < 2_000_000)
          return { kind: 'json', content: readFileSync(abs, 'utf8'), size };
        return { kind: 'binary', size };
      }
      case 'studio.open':
        return p.mode === 'edit'
          ? c.edits.open(this.store(p.channel), p.video)
          : c.studio.open(this.store(p.channel), p.video);
      case 'studio.close':
        return c.edits.session(this.store(p.channel), p.video)
          ? c.edits.close(this.store(p.channel), p.video, { discard: Boolean(p.discard) })
          : { closed: c.studio.close(this.store(p.channel), p.video) };
      case 'studio.commit':
        return c.edits.commit(this.store(p.channel), p.video);
      case 'frame.pinned_decide':
        return c.pinned.decide(
          this.store(p.channel),
          p.video,
          String(p.frame_id),
          p.decision as 'keep' | 'reapply' | 'discard',
        );
      case 'cost.report': {
        const r = costReport(c.db, this.store(p.channel), p.video, c.appDataDir);
        return { ...r, csv: costCsv(r) };
      }
      case 'trace.phoenix': {
        const s = this.settings();
        if (p.enabled) await c.phoenix.enable();
        else c.phoenix.disable();
        s.trace = { ...s.trace, phoenix_enabled: Boolean(p.enabled) };
        this.saveSettings(s);
        return { enabled: Boolean(p.enabled), url: c.phoenix.url };
      }
      case 'captions.load':
        return c.captions.load(this.store(p.channel), p.video);
      case 'captions.save': {
        const r = await c.captions.save(
          this.store(p.channel),
          p.video,
          p.overrides as CaptionOverrides,
          p.base_hash ? String(p.base_hash) : null,
        );
        return { hash: r.hash };
      }
      case 'config.resolve': {
        const r = resolveConfig(
          String(p.key),
          { channelDir: path.resolve(p.channel), ...(p.video ? { videoId: p.video } : {}) },
          { appDataDir: c.appDataDir },
        );
        return { value: r.value, source: r.source };
      }
      case 'workflow.progress':
        return { steps: this.engine(p.channel, p.video).progress() };
      case 'workflow.set_autopilot': {
        setConfig(this.store(p.channel), 'workflow.autopilot', p.on === true, {
          tier: 'video',
          videoId: p.video,
        });
        return { on: p.on === true };
      }
      case 'asr.accept': {
        const ctx = {
          session_id: 'ss_ui000001',
          kind: 'main',
          channel_dir: path.resolve(p.channel),
          video_id: p.video,
        } as SessionContext;
        const r = await c.gateway.call(ctx, 'asr.accept', { line_ids: p.line_ids });
        if (!r.ok) throw new SfError(r.error.code, r.error.message);
        return {};
      }
    }
    throw new SfError('E_TOOL_DENIED', `unknown IPC method ${String(method)}`);
  }

  /** Bọc lỗi theo JSON-RPC (D4 mục 12: `{code, message}`). */
  async handle(req: { id: number; method: IpcMethod; params: unknown }): Promise<{
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: { code: string; message: string };
  }> {
    try {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: await this.call(req.method, req.params as never),
      };
    } catch (e) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: isSfError(e) ? e.code : 'E_INTERNAL',
          message: String((e as Error).message),
        },
      };
    }
  }
}
