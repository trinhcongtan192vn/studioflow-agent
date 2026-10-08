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
import { detectChannel, initChannel, updateChannelInfo } from '../domain/channel.js';
import { newId } from '../domain/ids.js';
import { createVideo, listVideoIds } from '../domain/video.js';
import { isSfError, SfError } from '../errors.js';
import { isLimitHit } from '../autopilot/capacity.js';
import type { ChannelConfig, PlanItem } from '../contracts/types.js';
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
import { noticeText, workflowNotices, type WorkflowNotice } from '../workflow/notices.js';
import {
  APP_AUTOPILOT_KEYS,
  autopilotDoneToday,
  capacityRun,
  channelAutopilot,
  checkAutopilotValue,
  enqueuePlanRun,
  installedWorkflows,
  planDateOf,
  readPlan,
  type PlanPatch,
  updatePlanItem,
  asrFixInstruction,
  briefInstruction,
  canonicalDir,
  RUNNER_CONSTANTS,
  type ItemOutcomeEvent,
  resolveYouTubeChannel,
  setChannelAutopilot,
} from '../autopilot/index.js';
import { getSecretDefault } from '../secrets/credman.js';
import { getOpsSession, getSession, listOpsSessions, listSessions } from '../agent/session-log.js';
import { emptyTrash, listTrash, restoreVideo, trashVideo } from '../domain/trash.js';
import { videoCard, type VideoCard } from '../domain/video-card.js';
import type { VideoCreated } from '../gateway/tools/video.js';
import { exportVideo, listRenders, renderLibrary, type ExportInclude } from '../render/export.js';
import { publishQueue } from '../publish/queue-view.js';
import { recordSessions } from '../agent/recorder.js';
import type { SecretStore } from '../secrets/store.js';
import { PUBLISH_CALLBACK } from '../publish/index.js';
import {
  checkTelegramValue,
  OpsAgent,
  TELEGRAM_KEYS,
  TelegramService,
  type FetchLike,
} from '../telegram/index.js';
import { checkReportValue, REPORT_KEYS } from '../analytics/index.js';
import { YOUTUBE_SECRET } from '../youtube/index.js';
import { readResearch } from '../research/index.js';

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
  /** 045: phiên chat đang trả lời (`<kênh>|<video>`) — để cảnh báo khi đóng app. */
  private readonly replying = new Map<string, number>();
  private readonly watched = new Set<string>();
  private readonly announced = new Set<string>();
  /** 052: lỗi cuối của lượt agent theo video (hạn mức Claude…) — để bước agent/brief báo đúng lỗi. */
  private readonly agentErrors = new Map<string, { code: string; message: string }>();
  private autopilotTimer?: ReturnType<typeof setInterval>;
  readonly telegram: TelegramService;
  private readonly clock: () => Date;
  private readonly ops: OpsAgent;

  constructor(
    opts: CoreOptions & {
      runtime?: AgentRuntime;
      /** 052: bật bộ chạy Autopilot theo chu kỳ (mặc định tắt — test và CLI không tự tạo video). */
      autopilot?: { tick_ms?: number };
      /** 055: cổng bí mật (app: nối `main`); mặc định kho bộ nhớ. */
      secrets?: SecretStore;
      /** 055: `fetch` của bot Telegram (test không chạm mạng). */
      telegramFetch?: FetchLike;
      telegramSleep?: (ms: number) => Promise<void>;
    } = {},
  ) {
    super();
    const appDataDir = opts.appDataDir ?? defaultAppDataDir();
    this.core = createCore({ ...opts, appDataDir });
    this.clock = opts.clock ?? (() => new Date());
    this.runtime = opts.runtime ?? createRuntime({ gateway: this.core.gateway });
    this.core.queue.on('job.updated', (j) => this.send('job.updated', j));
    this.core.gateway.permissions.on('permission.requested', (r) =>
      this.send('permission.requested', r),
    );
    this.core.workflows.setAgentRuntime(this.runtime);
    // bước agent của workflow (storyboard…) chạy trong phiên `main` của video, hiện trong chat
    this.core.workflows.setAgentRunner(async (instruction, ctx) => {
      await this.chat(ctx.channelDir, ctx.videoId, instruction, [], 'system');
      this.throwLimit(ctx.channelDir, ctx.videoId);
    });
    // 055: Telegram — thông báo vận hành + hỏi đáp qua agent `ops` (nhật ký phiên ở ops/sessions/)
    this.ops = new OpsAgent({
      runtime: recordSessions(this.runtime, (dir) => this.core.gateway.storeFor(dir)),
      gateway: this.core.gateway,
      appDataDir,
    });
    this.telegram = new TelegramService({
      appDataDir,
      secrets: this.core.secrets,
      runner: this.core.autopilot,
      ops: this.ops,
      ...(opts.telegramFetch ? { fetch: opts.telegramFetch } : {}),
      ...(opts.telegramSleep ? { sleep: opts.telegramSleep } : {}),
      log: (level, msg) => this.core.gateway.logger.write(level, 'sf.telegram', { message: msg }),
      // 054: /report soạn báo cáo ngay cho mọi kênh (không đánh dấu đã gửi)
      report: async () => {
        const r = await this.core.reports.run();
        return {
          text: r.text || 'Chưa có kênh nào bật Autopilot.',
          parse_mode: 'HTML' as const,
        };
      },
    });
    this.core.reports.setSend((html) => this.telegram.sendText(html));
    this.core.autopilot.setNotifier(this.telegram.notifier);
    // 053: bản xem trước + nút Hủy đăng / Đăng ngay trong nhóm Telegram
    this.core.publisher.setNotifier(this.telegram.notifier);
    this.core.publisher.setPreview({ send: (m) => this.telegram.sendPreview(m) });
    this.telegram.onCallback(PUBLISH_CALLBACK, (data) => this.core.publisher.handleCallback(data));
    this.core.youtube.onChange = (channel) => this.send('publish.updated', { channel });
    if (opts.autopilot) void this.telegram.reconfigure();
    // 081: agent ở chat kênh tạo video → app mở video; yêu cầu chuyển sang phiên của video khi lượt kênh xong
    this.core.videoEvents.on('created', (e: VideoCreated) => {
      this.send('video.created', { channel: e.channel, video: e.video, title: e.title });
      const k = canonicalDir(e.channel);
      this.handoffs.set(k, [...(this.handoffs.get(k) ?? []), e]);
    });
    // 052: Autopilot — kênh quản lý đang bật, brief qua phiên `main`, sự kiện, vòng lặp định kỳ
    const ap = this.core.autopilot;
    ap.setChannels(() => this.autopilotChannels());
    ap.setPauseHandler((paused) => this.writePaused(paused));
    ap.setBrief(async (channel, video, item) => {
      await this.chat(
        channel,
        video,
        briefInstruction(item as PlanItem, this.planDateOfVideo(channel, video)),
        [],
        'system',
      );
      this.throwLimit(channel, video);
    });
    // 079: dòng đọc sai nhiều → nhờ agent của video sửa cách đọc rồi sinh lại (trước khi đỗ)
    ap.setFixAsr(async (channel, video, lines) => {
      await this.chat(channel, video, asrFixInstruction(lines), [], 'system');
      this.throwLimit(channel, video);
      // job sinh lại/nghe lại có thể còn chạy khi agent dừng → chờ xong rồi bộ chạy mới kiểm tra lại
      await this.core.queue.idle(15 * 60_000).catch(() => {});
    });
    ap.on('updated', () => this.send('autopilot.updated', ap.status()));
    ap.on('item.outcome', (e: ItemOutcomeEvent) => {
      if (!e.video || !e.reason) return;
      if (e.outcome === 'parked')
        this.postSystem(
          e.channel,
          e.video,
          `Autopilot đã dừng video này để chờ bạn: ${e.reason}. Xem điểm duyệt đang chờ rồi sửa hoặc duyệt bằng tay.`,
        );
      else if (e.outcome === 'failed')
        this.postSystem(e.channel, e.video, `Autopilot không làm xong video này: ${e.reason}`);
    });
    if (opts.autopilot) {
      const tick = () => void ap.tick().catch(() => {});
      setTimeout(tick, 0).unref();
      this.autopilotTimer = setInterval(tick, opts.autopilot.tick_ms ?? RUNNER_CONSTANTS.TICK_MS);
      this.autopilotTimer.unref();
    }
  }

  /** Lượt agent vừa kết thúc bằng lỗi hạn mức Claude → ném để bước/brief báo đúng lỗi (Autopilot chờ tới giờ reset). */
  private throwLimit(channel: string, video: string): void {
    const key = `${path.resolve(channel)}|${video}`;
    const err = this.agentErrors.get(key);
    this.agentErrors.delete(key);
    if (err && isLimitHit(err.message)) throw new SfError('E_RUNTIME_RATE_LIMIT', err.message);
  }

  private planDateOfVideo(channel: string, video: string): string {
    try {
      const st = JSON.parse(
        readFileSync(path.join(path.resolve(channel), 'videos', video, 'state.json'), 'utf8'),
      ) as VideoState;
      if (st.autopilot) return st.autopilot.plan_date;
    } catch {
      /* dùng ngày hôm nay */
    }
    return planDateOf(path.resolve(channel), new Date(), this.core.appDataDir);
  }

  private setPaused(paused: boolean): { paused: boolean } {
    return this.core.autopilot.setPaused(paused);
  }

  private writePaused(paused: boolean): void {
    const s = this.settings();
    s.config = { ...s.config, 'autopilot.paused': paused };
    this.saveSettings(s);
  }

  private send<K extends keyof IpcEvents>(name: K, data: IpcEvents[K]): void {
    this.emit('event', name, data);
  }

  private watcher?: { close(): void };
  // 081: yêu cầu chờ chuyển sang video vừa tạo, theo kênh
  private readonly handoffs = new Map<string, VideoCreated[]>();

  close(): void {
    void this.telegram.close();
    void this.ops.close();
    if (this.autopilotTimer) clearInterval(this.autopilotTimer);
    this.core.autopilot.stop();
    this.watcher?.close();
    for (const s of this.sessions.values()) void s.session.close();
    this.core.close();
  }

  // ---------- kênh / video ----------

  private store(channel: string): WriteStore {
    return this.core.gateway.storeFor(path.resolve(channel));
  }

  /** 070: thẻ video (trạng thái, tiến độ bước, loại, ảnh đại diện) — mới sửa trước. */
  private videos(channel: string): VideoCard[] {
    const titles = new Map<string, Record<string, string> | undefined>();
    const stepTitles = (wf: string) => {
      if (!titles.has(wf)) {
        const m = this.core.workflows.packs().find((p) => p.manifest.id === wf)?.manifest;
        titles.set(
          wf,
          m ? Object.fromEntries(m.steps.map((s) => [s.id, s.title ?? s.id])) : undefined,
        );
      }
      return titles.get(wf);
    };
    return listVideoIds(channel)
      .map((id) => videoCard(channel, id, stepTitles))
      .filter((x): x is VideoCard => Boolean(x))
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
    // 047: mở kênh lần đầu → vào danh sách kênh quản lý (mặc định Manual)
    if (!(s.managed_channels ?? []).some((c) => c.path === dir))
      s.managed_channels = [
        ...(s.managed_channels ?? []),
        { path: dir, added_at: new Date().toISOString() },
      ];
    this.saveSettings(s);
  }

  /** 047: kênh quản lý + chế độ Autopilot/Manual, số đối thủ (đọc `channel.json`). */
  private managedChannels(): IpcMethods['channels.managed']['result']['channels'] {
    return (this.settings().managed_channels ?? []).map((m) => {
      const d = detectChannel(m.path);
      const ch =
        d.kind === 'channel'
          ? ((d.config as
              { config?: Record<string, unknown>; name?: string; language?: string } | undefined) ??
            {})
          : {};
      const competitors = ch.config?.['autopilot.competitors'];
      return {
        path: m.path,
        name: ch.name ?? path.basename(m.path),
        exists: d.kind === 'channel',
        autopilot: ch.config?.['autopilot.enabled'] === true,
        language: ch.language ?? 'vi',
        competitors: Array.isArray(competitors) ? competitors.length : 0,
        added_at: m.added_at,
      };
    });
  }

  /**
   * 050 (FR-AP-05): năng lực hôm nay cho các kênh (mặc định: kênh quản lý đang bật Autopilot). Video đang có
   * bước `running` của các kênh đó trừ phần việc còn lại vào quỹ thời gian/token.
   */
  private capacity(dirs?: string[]): IpcMethods['autopilot.capacity']['result'] {
    const app = this.core.appDataDir;
    const now = this.clock().getTime();
    const list = dirs?.length ? dirs.map((d) => path.resolve(d)) : this.autopilotChannels();
    const channels = list
      .flatMap((d) => {
        const det = detectChannel(d);
        return det.kind === 'channel' ? [{ d, det }] : [];
      })
      .map(({ d, det }) => {
        const v = channelAutopilot(d, app);
        const name = (det.config as { name?: string } | undefined)?.name;
        return {
          channel: d,
          ...(name ? { name } : {}),
          workflows: v['autopilot.workflows']!.value as string[],
          max_per_day: Number(v['autopilot.max_per_day']!.value),
          // 051: trần chỉ đếm video do Autopilot tạo — kế hoạch ngày là nguồn sự thật
          done_today: autopilotDoneToday(d, new Date(now), app),
          platforms: v['publish.platforms']!.value as string[],
        };
      });
    return capacityRun({
      db: this.core.db,
      appDataDir: app,
      workflows: this.core.workflows,
      channels,
      now,
    });
  }

  /** 051: thư mục các kênh quản lý đang bật Autopilot. */
  private autopilotChannels(): string[] {
    return this.managedChannels()
      .filter((m) => m.exists && m.autopilot)
      .map((m) => m.path);
  }

  private engine(channel: string, video: string): WorkflowEngine {
    const e = this.core.workflows.engine(path.resolve(channel), video);
    const key = `${path.resolve(channel)}|${video}`;
    if (!this.watched.has(key)) {
      this.watched.add(key);
      // 041: trạng thái bước lần trước → thông báo khi đổi
      let prev: Record<string, string> = Object.fromEntries(
        e.summary().steps.map((s) => [s.id, s.status]),
      );
      e.on('workflow.updated', (summary: IpcEvents['workflow.updated']) => {
        this.send('workflow.updated', { ...summary, channel });
        this.announceApprovals(channel, video, e);
        const notices = workflowNotices(prev, summary.steps, e.readState());
        prev = Object.fromEntries(summary.steps.map((s) => [s.id, s.status]));
        for (const notice of notices) this.postNotice(channel, video, notice);
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

  /** 041: agent báo tình trạng workflow — ghi vào lịch sử chat của video và đẩy lên giao diện. */
  private postNotice(channel: string, video: string, notice: WorkflowNotice): void {
    const rel =
      this.latestChat(channel, video) ?? `${this.chatDir(channel, video)}/${newId('ss')}.jsonl`;
    const line: ChatLine = {
      ts: new Date().toISOString(),
      role: 'assistant',
      content: noticeText(notice),
      notice,
    };
    try {
      this.store(channel).appendLine(rel, JSON.stringify(line), { by: 'chat' });
    } catch {
      /* ghi lịch sử là cố gắng tối đa */
    }
    this.send('workflow.notice', { channel, video, line });
  }

  /** 045: việc đang chạy dở (phiên Studio sửa, bước workflow, job, agent đang trả lời) — cảnh báo khi đóng app. */
  activity(): IpcMethods['app.activity']['result'] {
    const c = this.core;
    const split = (key: string) => {
      const i = key.lastIndexOf('|');
      return { channel: key.slice(0, i), video: key.slice(i + 1) };
    };
    return {
      studio: c.edits.openKeys().map(split),
      steps: c.workflows.runningSteps(),
      jobs: c.queue
        .list({ status: 'running' })
        .map((j) => ({ kind: j.kind, ...(j.video_id ? { video: j.video_id } : {}) })),
      chats: [...this.replying.keys()].map(split),
      autopilot: c.autopilot.activity(),
    };
  }

  /** 045: ghi chú của app vào lịch sử chat của video (dòng `system`). */
  private postSystem(channel: string, video: string, content: string): void {
    const rel =
      this.latestChat(channel, video) ?? `${this.chatDir(channel, video)}/${newId('ss')}.jsonl`;
    try {
      this.log(channel, rel, { role: 'system', content });
    } catch {
      /* ghi lịch sử là cố gắng tối đa */
    }
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
    const busyKey = `${path.resolve(channel)}|${video ?? ''}`;
    this.replying.set(busyKey, (this.replying.get(busyKey) ?? 0) + 1);
    try {
      const s = await this.session(channel, video);
      this.log(channel, s.chatRel, {
        role,
        content: text,
        ...(contextRefs.length ? { context_refs: contextRefs } : {}),
      });
      return await this.chatTurn(s, channel, video, text, attachments, contextRefs);
    } finally {
      const n = (this.replying.get(busyKey) ?? 1) - 1;
      if (n > 0) this.replying.set(busyKey, n);
      else this.replying.delete(busyKey);
      // 081: video agent vừa tạo ở lượt kênh này → chuyển yêu cầu sang phiên chat của video
      if (!video) this.flushHandoffs(channel);
    }
  }

  /** 081: video được tạo từ chat kênh → gửi yêu cầu vào phiên chat của video (agent của video làm tiếp). */
  private flushHandoffs(channel: string): void {
    const k = canonicalDir(channel);
    const list = this.handoffs.get(k);
    if (!list?.length) return;
    this.handoffs.delete(k);
    for (const e of list)
      void this.chat(channel, e.video, `[Từ chat kênh] ${e.instruction}`).catch(() => {});
  }

  private async chatTurn(
    s: OpenSession,
    channel: string,
    video: string | undefined,
    text: string,
    attachments: { path: string; mime: string }[],
    contextRefs: ContextRef[],
  ) {
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
      } else if (e.type === 'error') {
        if (video) this.agentErrors.set(`${path.resolve(channel)}|${video}`, e);
        this.log(channel, s.chatRel, { role: 'system', content: `${e.code}: ${e.message}` });
      }
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
          // 071: trang Giới thiệu mở được thư mục dữ liệu app
          app_data_dir: c.appDataDir,
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
        // 064: thùng rác quá hạn (trash.retention_days) được dọn khi mở kênh
        try {
          emptyTrash(this.store(p.channel), {
            retentionDays: Number(
              resolveConfig(
                'trash.retention_days',
                { channelDir: path.resolve(p.channel) },
                { appDataDir: c.appDataDir },
              ).value,
            ),
          });
        } catch {
          /* dọn là cố gắng tối đa */
        }
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
      case 'channels.managed':
        return { channels: this.managedChannels() };
      // 082: thông tin kênh — tên, ngôn ngữ mặc định
      case 'channel.info.get': {
        const store = this.store(p.channel);
        const c = JSON.parse(readFileSync(store.abs('channel.json'), 'utf8')) as ChannelConfig;
        return {
          id: c.id,
          name: c.name,
          language: c.language,
          created_at: c.created_at,
          path: store.root,
          videos: listVideoIds(store.root).length,
        };
      }
      case 'channel.info.set': {
        const c = updateChannelInfo(this.store(p.channel), {
          ...(p.name !== undefined ? { name: String(p.name) } : {}),
          ...(p.language !== undefined ? { language: String(p.language) } : {}),
        });
        return { name: c.name, language: c.language };
      }
      case 'channels.managed.add': {
        const dir = path.resolve(p.channel);
        if (detectChannel(dir).kind !== 'channel')
          throw new SfError('E_NOT_CHANNEL', `${p.channel} has no channel.json`);
        const s = this.settings();
        if (!(s.managed_channels ?? []).some((m) => m.path === dir))
          s.managed_channels = [
            ...(s.managed_channels ?? []),
            { path: dir, added_at: new Date().toISOString() },
          ];
        this.saveSettings(s);
        return { ok: true };
      }
      case 'channels.managed.remove': {
        const dir = path.resolve(p.channel);
        const s = this.settings();
        s.managed_channels = (s.managed_channels ?? []).filter((m) => m.path !== dir);
        this.saveSettings(s);
        return { ok: true };
      }
      case 'channel.autopilot.get':
        return { settings: channelAutopilot(path.resolve(p.channel), c.appDataDir) };
      case 'channel.autopilot.set':
        setChannelAutopilot(this.store(p.channel), String(p.key), p.value);
        return { ok: true };
      case 'autopilot.capacity':
        return this.capacity(Array.isArray(p.channels) ? p.channels.map(String) : undefined);
      case 'youtube.resolve_channel':
        return resolveYouTubeChannel(String(p.input), {
          apiKey: getSecretDefault(YOUTUBE_SECRET),
        });
      case 'sessions.list':
        // 055: không có kênh → nhật ký phiên ops (Telegram) trong dữ liệu app
        if (!p.channel)
          return {
            sessions: listOpsSessions(c.appDataDir, p.limit ? { limit: Number(p.limit) } : {}),
          };
        return {
          sessions: listSessions(this.store(p.channel), c.db, {
            ...(p.video ? { video: String(p.video) } : {}),
            ...(p.limit ? { limit: Number(p.limit) } : {}),
          }),
        };
      case 'sessions.get':
        if (!p.channel) return { lines: getOpsSession(c.appDataDir, String(p.id)) };
        return {
          lines: getSession(this.store(p.channel), c.db, {
            id: String(p.id),
            ...(p.video ? { video: String(p.video) } : {}),
          }),
        };
      // 074: màn Duyệt trước khi đăng
      case 'publish.queue':
        return { items: publishQueue(path.resolve(p.channel)) };
      case 'publish.youtube.connect':
        return c.youtube.connect(path.resolve(p.channel));
      case 'publish.youtube.status':
        return c.youtube.status(path.resolve(p.channel));
      case 'publish.youtube.disconnect':
        return c.youtube.disconnect(path.resolve(p.channel));
      case 'publish.tiktok.set_token':
      case 'publish.facebook.set_token': {
        const pf = String(method).split('.')[1] as 'tiktok' | 'facebook';
        return c.social.setToken(pf, path.resolve(p.channel), String(p.token), {
          ...(pf === 'facebook' && p.page_id !== undefined ? { page_id: String(p.page_id) } : {}),
        });
      }
      case 'publish.tiktok.status':
      case 'publish.facebook.status':
        return c.social.status(
          String(method).split('.')[1] as 'tiktok' | 'facebook',
          path.resolve(p.channel),
        );
      case 'publish.tiktok.disconnect':
      case 'publish.facebook.disconnect':
        return c.social.disconnect(
          String(method).split('.')[1] as 'tiktok' | 'facebook',
          path.resolve(p.channel),
        );
      case 'publish.cancel':
        return c.publisher.cancel({
          channel: path.resolve(p.channel),
          item_id: String(p.item_id),
          date: String(p.date),
          ...(p.platform ? { platform: p.platform as 'youtube' | 'tiktok' | 'facebook' } : {}),
        });
      case 'publish.now':
        return c.publisher.publishNow({
          channel: path.resolve(p.channel),
          item_id: String(p.item_id),
          date: String(p.date),
          ...(p.platform ? { platform: p.platform as 'youtube' | 'tiktok' | 'facebook' } : {}),
        });
      case 'learning.get': {
        const chans = p.channel ? [path.resolve(p.channel)] : c.autopilot.channelDirs();
        return { learning: chans.map((d) => c.learning.get(d)) };
      }
      case 'report.latest': {
        const chans = p.channel ? [path.resolve(p.channel)] : c.autopilot.channelDirs();
        return {
          reports: chans.flatMap((d) => {
            const r = c.reports.latest(d);
            return r ? [r] : [];
          }),
        };
      }
      case 'report.run': {
        const r = await c.reports.run({
          ...(p.channel ? { channel: path.resolve(p.channel) } : {}),
          send: p.send === true,
        });
        return { reports: r.reports, text: r.text };
      }
      case 'telegram.status':
        return this.telegram.status();
      case 'telegram.test':
        return this.telegram.test();
      case 'telegram.set_token':
        return this.telegram.setToken(String(p.token));
      case 'autopilot.status':
        return c.autopilot.status();
      case 'autopilot.run_now': {
        const s = c.autopilot.status();
        if (s.paused) return { started: false, reason: 'paused' };
        if (s.waiting_until) return { started: false, reason: 'limit_wait' };
        if (s.running) return { started: false, reason: 'running' };
        void c.autopilot.tick({ force: true }).catch(() => {});
        return { started: true };
      }
      case 'autopilot.pause':
        return this.setPaused(true);
      case 'autopilot.resume':
        return this.setPaused(false);
      case 'autopilot.plan.get': {
        const dirs = p.channel ? [path.resolve(p.channel)] : this.autopilotChannels();
        return {
          plans: dirs.flatMap((dir) => {
            const det = detectChannel(dir);
            if (det.kind !== 'channel') return [];
            const date = p.date ? String(p.date) : planDateOf(dir, new Date(), c.appDataDir);
            const name = (det.config as { name?: string } | undefined)?.name ?? path.basename(dir);
            return [{ channel: dir, name, date, plan: readPlan(dir, date) ?? null }];
          }),
        };
      }
      case 'autopilot.plan.run':
        return enqueuePlanRun(
          { queue: c.queue, appDataDir: c.appDataDir },
          this.autopilotChannels(),
          p.date ? String(p.date) : undefined,
        );
      case 'autopilot.plan.update':
        return {
          item: updatePlanItem(this.store(p.channel), {
            date: String(p.date),
            item_id: String(p.item_id),
            patch: p.patch as PlanPatch,
            installed: installedWorkflows(c.workflows),
            appDataDir: c.appDataDir,
          }),
        };
      case 'research.latest':
        return { doc: readResearch(path.resolve(p.channel)) ?? null };
      case 'video.delete': {
        const dir = path.resolve(p.channel);
        const act = this.activity();
        const same = (x: { channel: string; video?: string }) =>
          path.resolve(x.channel) === dir && x.video === p.video;
        const why = [
          ...act.steps.filter(same).map((x) => `bước "${x.title}" đang chạy`),
          ...act.studio.filter(same).map(() => 'Studio đang mở để sửa'),
          ...act.chats.filter(same).map(() => 'agent đang trả lời'),
          ...(act.autopilot ?? []).filter(same).map(() => 'Autopilot đang làm video này'),
        ];
        if (why.length)
          throw new SfError(
            'E_VIDEO_BUSY',
            `video ${p.video} is busy (${why.join('; ')}); try again later`,
          );
        const title = this.videos(dir).find((v) => v.id === p.video)?.title ?? String(p.video);
        this.watcher?.close();
        this.watcher = undefined;
        c.workflows.forget(dir, String(p.video));
        this.watched.delete(`${dir}|${p.video}`);
        return trashVideo(this.store(p.channel), String(p.video), { title });
      }
      case 'trash.list':
        return { entries: listTrash(this.store(p.channel)) };
      case 'trash.restore':
        return restoreVideo(this.store(p.channel), String(p.trash_id));
      case 'trash.empty':
        return emptyTrash(this.store(p.channel), { all: true });
      // 066: xuất video ra thư mục người dùng chọn (constitution 1.2)
      // 073: thư viện — mọi bản render của kênh
      case 'render.library':
        return { renders: renderLibrary(this.store(p.channel).root) };
      case 'render.list':
        return { renders: listRenders(this.store(p.channel).root, String(p.video)) };
      case 'video.export':
        return exportVideo({
          channel: this.store(p.channel).root,
          video: String(p.video),
          dest_dir: String(p.dest_dir),
          ...(p.render_id ? { render_id: String(p.render_id) } : {}),
          ...(p.include ? { include: p.include as ExportInclude } : {}),
          ...(p.name ? { name: String(p.name) } : {}),
        });
      case 'channel.list_recent':
        return { channels: this.settings().recent_channels };
      case 'video.list':
        return { videos: this.videos(path.resolve(p.channel)) };
      case 'video.create':
        return {
          video_id: createVideo(this.store(p.channel), p.title ? { title: String(p.title) } : {})
            .video_id,
        };
      case 'app.activity':
        return this.activity();
      case 'video.open': {
        // 045: khóa Studio còn sót (app tắt khi Studio mở) → nhả để agent ghi được frame
        const stale = c.edits.recoverStale(this.store(p.channel), p.video);
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
        for (const k of stale.kept)
          this.postSystem(
            p.channel,
            p.video,
            `Phiên sửa Studio trước bị đóng giữa chừng (app tắt khi Studio đang mở). Đã mở khóa để agent dựng tiếp; ${k.files.length} file sửa trong Studio chưa lưu được giữ lại ở ${k.work} (${k.files.slice(0, 5).join(', ')}${k.files.length > 5 ? '…' : ''}).`,
          );
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
      case 'workflow.waive': {
        const e = this.engine(p.channel, p.video);
        const r = await e.waive(String(p.step_id), String(p.check));
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
        // 047: khóa Autopilot tầng app được kiểm dạng giá trị (khung giờ, tỉ lệ…)
        if ((APP_AUTOPILOT_KEYS as readonly string[]).includes(String(p.key)))
          checkAutopilotValue(String(p.key), p.value);
        if ((REPORT_KEYS as readonly string[]).includes(String(p.key)))
          checkReportValue(String(p.key), p.value);
        const tg = (TELEGRAM_KEYS as readonly string[]).includes(String(p.key));
        if (tg) checkTelegramValue(String(p.key), p.value);
        const s = this.settings();
        s.config = { ...s.config, [String(p.key)]: p.value };
        this.saveSettings(s);
        if (tg) await this.telegram.reconfigure();
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
