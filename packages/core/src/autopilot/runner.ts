import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { resolveAppConfig, resolveConfig } from '../config/resolve.js';
import type {
  AutopilotLogLine,
  PlanItem,
  PlanItemStatus,
  StepDecl,
  VideoState,
  WorkflowManifest,
} from '../contracts/types.js';
import { AUTOPILOT_APPROVAL_NOTE, AUTOPILOT_PARK_NOTE } from '../domain/autopilot.js';
import { newId } from '../domain/ids.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { createVideo, listVideoIds } from '../domain/video.js';
import { isSfError } from '../errors.js';
import type { PermissionBus } from '../gateway/permission.js';
import { loadVideoModel } from '../graph/model.js';
import type { WriteStore } from '../store/writer.js';
import type { AutoDecide, WorkflowEngine } from '../workflow/engine.js';
import { audioDurationReading } from '../workflow/duration.js';
import { executionOrder, STEP_LIBRARY } from '../workflow/library.js';
import type { WorkflowService } from '../workflow/service.js';
import type { BriefFn } from './brief.js';
import { workWindow } from './capacity.js';
import {
  decideBrief,
  decideDuration,
  decideFinalize,
  decideRefine,
  type Decision,
} from './gates.js';
import { limitResumeAt, parseLimit } from './limit.js';
import { markPlanItem, planDates, readPlan, type PlanTodayResult } from './plan.js';

/**
 * Bộ chạy Autopilot (052, FR-AP-07/08, NFR-11): mỗi lượt `tick` lập kế hoạch ngày nếu chưa có, rồi tạo video
 * và chạy workflow cho từng mục theo giờ đăng — một video một lúc trên máy này (GPU). Điểm chốt do cổng chất
 * lượng tự động quyết; không đạt → đỗ video (`needs_review`) và làm mục tiếp; lỗi → chạy lại một lần rồi báo;
 * chạm hạn mức Claude → chờ tới giờ reset. Mọi quyết định ghi `autopilot/log/<ngày>.jsonl` (D3 5.19).
 */
export const RUNNER_CONSTANTS = {
  /** Host gọi `tick` định kỳ (ms). */
  TICK_MS: 5 * 60_000,
  /** Mục `in_production` của kế hoạch những ngày trước (qua nửa đêm) vẫn được làm tiếp: số ngày xem lại. */
  RESUME_DAYS: 2,
  /** Số lần chạy lại một bước lỗi trước khi báo hỏng mục. */
  STEP_RETRIES: 1,
  /** Số lần chạy lại liên tiếp sau hạn mức đã qua giờ mà vẫn chạm hạn mức → chờ thêm 1 giờ. */
  LIMIT_RERUNS: 2,
} as const;

const C = RUNNER_CONSTANTS;
const done = (s: string | undefined) => s === 'done' || s === 'skipped';

// ---------- hàm thuần ----------

export interface QueueEntry {
  channel: string;
  date: string;
  /** Vị trí trong `items` của file kế hoạch. */
  index: number;
  item: PlanItem;
}

const QUEUED: ReadonlySet<PlanItemStatus> = new Set(['planned', 'in_production']);

/**
 * Thứ tự làm (FR-AP-07): mục `in_production` (làm tiếp) trước, rồi theo `publish_at` tăng dần giữa mọi kênh
 * (không có giờ đăng xếp cuối), cùng giờ thì theo kênh rồi thứ tự trong kế hoạch. Chỉ nhận `planned` / `in_production`.
 */
export function orderItems(entries: QueueEntry[]): QueueEntry[] {
  const at = (e: QueueEntry) => (e.item.publish_at ? Date.parse(e.item.publish_at) : Infinity);
  return entries
    .filter((e) => QUEUED.has(e.item.status))
    .sort(
      (a, b) =>
        Number(b.item.status === 'in_production') - Number(a.item.status === 'in_production') ||
        (at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1) ||
        a.channel.localeCompare(b.channel) ||
        a.index - b.index,
    );
}

export type GateReason = 'paused' | 'outside_window' | 'limit_wait';

/**
 * Được bắt đầu việc mới không (FR-AP-08): `autopilot.paused` và chờ hạn mức Claude luôn chặn; ngoài khung
 * `autopilot.work_window` thì chặn, trừ khi `force` (nút "chạy ngay").
 */
export function startGate(o: {
  now: Date;
  paused: boolean;
  window: string;
  timezone: string;
  waitingUntil?: Date;
  force?: boolean;
}): { ok: true } | { ok: false; reason: GateReason } {
  if (o.paused) return { ok: false, reason: 'paused' };
  if (o.waitingUntil && o.waitingUntil.getTime() > o.now.getTime())
    return { ok: false, reason: 'limit_wait' };
  if (!o.force && !workWindow(o.window, o.now.getTime(), o.timezone).inside)
    return { ok: false, reason: 'outside_window' };
  return { ok: true };
}

// ---------- bộ chạy ----------

export interface RunnerDeps {
  workflows: Pick<WorkflowService, 'engine' | 'packs'>;
  storeFor: (channelDir: string) => WriteStore;
  /** Thư mục các kênh Autopilot (host: kênh quản lý đang bật). */
  channels: () => string[];
  /** Lập kế hoạch hôm nay cho nhóm kênh (051 `planToday` kèm năng lực/nghiên cứu). */
  plan: (o: { channels: string[]; now: Date }) => Promise<PlanTodayResult>;
  /** Giao brief cho phiên `main` của video; mặc định lỗi `E_STEP_INCOMPLETE` (chưa có agent). */
  brief?: BriefFn;
  clock?: () => Date;
  appDataDir?: string;
  logger?: (line: AutopilotLogLine & { channel: string }) => void;
}

export type ItemOutcome = 'produced' | 'parked' | 'failed' | 'wait' | 'stopped';

/** Sự kiện `item.outcome` của bộ chạy: một mục xong/đỗ/hỏng/chờ/dừng (host báo vào chat video). */
export interface ItemOutcomeEvent {
  channel: string;
  video: string;
  item_id: string;
  title: string;
  outcome: ItemOutcome;
  reason?: string;
}

export interface TickResult {
  /** Lượt này không làm gì mới vì (chỉ khi không có mục nào được làm). */
  skipped?: GateReason;
  outcomes: {
    channel: string;
    item_id: string;
    video_id?: string;
    outcome: ItemOutcome;
    reason?: string;
  }[];
}

export interface AutopilotStatus {
  paused: boolean;
  running: boolean;
  waiting_until?: string;
  current?: { channel: string; video?: string; item_id: string; title: string; step_id?: string };
  today: {
    channel: string;
    name: string;
    date: string;
    items: {
      id: string;
      title: string;
      status: PlanItemStatus;
      video_id?: string;
      publish_at: string | null;
      note?: string;
    }[];
  }[];
}

interface Ctx {
  channel: string;
  store: WriteStore;
  date: string;
  item: PlanItem;
  video: string;
}

type Outcome =
  | { kind: 'produced'; outputs: string[] }
  | { kind: 'parked'; reason: string; step_id?: string }
  | { kind: 'failed'; reason: string; step_id?: string }
  | { kind: 'wait' }
  | { kind: 'stopped' };

const message = (e: unknown): string => String((e as Error)?.message ?? e).split('\n')[0]!;
const code = (e: unknown): string => (isSfError(e) ? e.code : 'E_INTERNAL');

/**
 * Khóa thư mục kênh ổn định: Windows có thể ghi cùng một thư mục bằng tên ngắn 8.3 (`C:\Users\TANTRI~1`)
 * hoặc tên dài (`C:\Users\tan trinh`) — `path.resolve` không gộp hai dạng này.
 */
export function canonicalDir(dir: string): string {
  const abs = path.resolve(dir);
  try {
    return realpathSync.native(abs);
  } catch {
    return abs;
  }
}

export class AutopilotRunner extends EventEmitter {
  private inflight?: Promise<TickResult>;
  private stopped = false;
  private restored = false;
  private waitUntil?: Date;
  private waitCtx?: { channel: string; date: string; item_id: string; video_id?: string };
  private current?: AutopilotStatus['current'];
  private readonly retries = new Map<string, number>();
  private readonly limitReruns = new Map<string, number>();
  private readonly voiceLogged = new Set<string>();
  private readonly blocked = new Map<string, { summary: string; ts: number }>();
  private channelsFn: () => string[];
  private briefFn?: BriefFn;

  constructor(private readonly d: RunnerDeps) {
    super();
    this.channelsFn = d.channels;
    this.briefFn = d.brief;
  }

  setChannels(fn: () => string[]): void {
    this.channelsFn = fn;
  }

  setBrief(fn: BriefFn | undefined): void {
    this.briefFn = fn;
  }

  /** Dừng (tắt app): không bắt đầu thêm việc; việc đang chạy dừng ở ranh giới bước gần nhất. */
  stop(): void {
    this.stopped = true;
  }

  /** Yêu cầu quyền có phí từ video Autopilot không treo chờ: ghi lại để đỗ mục với tóm tắt chi phí. */
  attachPermissions(bus: Pick<PermissionBus, 'on'>): void {
    // 052: lệnh có phí được tự cho phép trong ngân sách video → ghi nhật ký vận hành
    bus.on(
      'autopilot.paid_allowed',
      (e: {
        session: { channel_dir: string; video_id?: string };
        request: { summary: string };
        usd: number;
        approved_usd: number;
        limit_usd: number;
      }) => {
        const channel = canonicalDir(e.session.channel_dir);
        this.log(channel, this.dateOf(channel, this.now()), {
          level: 'info',
          event: 'paid.allowed',
          ...(e.session.video_id
            ? { video_id: e.session.video_id as AutopilotLogLine['video_id'] }
            : {}),
          message: `Tự cho phép lệnh có phí (~$${e.usd}): ${e.request.summary} — đã dùng $${e.approved_usd}/$${e.limit_usd} của video.`,
          data: { usd: e.usd, approved_usd: e.approved_usd, limit_usd: e.limit_usd },
        });
      },
    );
    bus.on(
      'autopilot.blocked',
      (e: {
        session: { channel_dir: string; video_id?: string };
        request: { summary: string };
      }) => {
        this.blocked.set(`${canonicalDir(e.session.channel_dir)}|${e.session.video_id ?? ''}`, {
          summary: e.request.summary,
          ts: Date.now(),
        });
      },
    );
  }

  // ---------- tiện ích ----------

  private now(): Date {
    return this.d.clock?.() ?? new Date();
  }

  private app<T>(key: string): T {
    return resolveAppConfig<T>(key, { appDataDir: this.d.appDataDir });
  }

  private cfg<T>(key: string, channel: string, video?: string): T {
    return resolveConfig<T>(
      key,
      { channelDir: channel, ...(video ? { videoId: video } : {}) },
      { appDataDir: this.d.appDataDir },
    ).value;
  }

  private dateOf(channel: string, now: Date): string {
    const tz = this.cfg<string>('publish.timezone', channel);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  private channels(): string[] {
    return this.channelsFn()
      .filter((c) => existsSync(path.join(c, 'channel.json')))
      .filter((c) => this.cfg<boolean>('autopilot.enabled', c) === true);
  }

  private changed(): void {
    this.emit('updated');
  }

  private log(channel: string, date: string, line: Omit<AutopilotLogLine, 'ts'>): void {
    const full = { ts: this.now().toISOString(), ...line } as AutopilotLogLine;
    try {
      this.d
        .storeFor(channel)
        .appendLine(`autopilot/log/${date}.jsonl`, JSON.stringify(full), { by: 'autopilot' });
    } catch {
      /* nhật ký là cố gắng tối đa — không làm hỏng việc đang chạy */
    }
    this.d.logger?.({ ...full, channel });
  }

  private logItem(
    c: Ctx,
    level: AutopilotLogLine['level'],
    event: string,
    msg: string,
    extra: { step_id?: string; data?: Record<string, unknown> } = {},
  ): void {
    this.log(c.channel, c.date, {
      level,
      event,
      item_id: c.item.id,
      video_id: c.video as AutopilotLogLine['video_id'],
      ...(extra.step_id ? { step_id: extra.step_id } : {}),
      message: msg,
      ...(extra.data ? { data: extra.data } : {}),
    });
  }

  // ---------- cổng chất lượng (engine gọi khi một điểm chốt xong) ----------

  /** Quyết định điểm chốt của video Autopilot (story/script/…: refine; finalize: ASR); ghi nhật ký. */
  readonly autoDecide: AutoDecide = (step, st, ctx) => {
    let d: Decision;
    if (step.id === 'finalize') {
      d = decideFinalize({ mismatched: mismatchedLines(ctx.store, ctx.videoId) });
    } else {
      const threshold =
        step.refine?.threshold ??
        Number(this.cfg<number>('refine.threshold', ctx.store.root, ctx.videoId));
      d = decideRefine(ctx.refine, { configured: Boolean(step.refine?.enabled), threshold });
    }
    const a = st.autopilot;
    if (a)
      this.log(ctx.store.root, a.plan_date, {
        level: d.approve ? 'info' : 'warn',
        event: 'gate.decision',
        item_id: a.item_id,
        video_id: ctx.videoId as AutopilotLogLine['video_id'],
        step_id: step.id,
        message: `Điểm chốt ${step.id}: ${d.approve ? 'duyệt' : 'không duyệt'} — ${d.reason}.`,
        data: { approve: d.approve },
      });
    return d;
  };

  // ---------- trạng thái ----------

  status(channel?: string): AutopilotStatus {
    const now = this.now();
    const chans = channel ? [path.resolve(channel)] : this.channels();
    return {
      paused: this.app<boolean>('autopilot.paused') === true,
      running: Boolean(this.inflight),
      ...(this.waitUntil && this.waitUntil > now
        ? { waiting_until: this.waitUntil.toISOString() }
        : {}),
      ...(this.current ? { current: this.current } : {}),
      today: chans
        .filter((c) => existsSync(path.join(c, 'channel.json')))
        .map((c) => {
          const date = this.dateOf(c, now);
          const meta = JSON.parse(readFileSync(path.join(c, 'channel.json'), 'utf8')) as {
            name?: string;
          };
          return {
            channel: c,
            name: meta.name ?? path.basename(c),
            date,
            items: (readPlan(c, date)?.items ?? []).map((i) => ({
              id: i.id,
              title: i.title,
              status: i.status,
              ...(i.video_id ? { video_id: i.video_id } : {}),
              publish_at: i.publish_at,
              ...(i.note ? { note: i.note } : {}),
            })),
          };
        }),
    };
  }

  /** 045: mục đang làm dở (`in_production`) của các kênh — cảnh báo khi đóng app. */
  activity(): { channel: string; video: string; item_id: string; title: string }[] {
    const now = this.now();
    return this.channels().flatMap((c) =>
      (readPlan(c, this.dateOf(c, now))?.items ?? [])
        .filter((i) => i.status === 'in_production' && i.video_id)
        .map((i) => ({ channel: c, video: i.video_id!, item_id: i.id, title: i.title })),
    );
  }

  /** 20 dòng nhật ký vận hành gần nhất của kênh (hôm nay, thiếu thì ngày trước). */
  recentLog(channel: string, limit = 20): AutopilotLogLine[] {
    const dir = path.resolve(channel);
    const lines: AutopilotLogLine[] = [];
    for (const date of [
      this.dateOf(dir, this.now()),
      ...planDatesBefore(dir, this.dateOf(dir, this.now())),
    ]) {
      lines.unshift(...readLog(dir, date));
      if (lines.length >= limit) break;
    }
    return lines.slice(-limit);
  }

  // ---------- một lượt ----------

  tick(opts: { force?: boolean } = {}): Promise<TickResult> {
    if (this.inflight) return this.inflight;
    this.inflight = this.run(opts).finally(() => {
      this.inflight = undefined;
      this.current = undefined;
      this.changed();
    });
    this.changed();
    return this.inflight;
  }

  private gate(now: Date, force?: boolean) {
    return startGate({
      now,
      paused: this.app<boolean>('autopilot.paused') === true,
      window: this.app<string>('autopilot.work_window'),
      timezone: this.app<string>('publish.timezone'),
      ...(this.waitUntil ? { waitingUntil: this.waitUntil } : {}),
      ...(force ? { force } : {}),
    });
  }

  private async run(opts: { force?: boolean }): Promise<TickResult> {
    const out: TickResult = { outcomes: [] };
    const now0 = this.now();
    if (!this.restored) {
      this.restored = true;
      this.restoreWait(now0);
    }
    // 052 (Tan): video bị đỗ mà người dùng đã làm xong bằng tay → nhận lại (rẻ, chạy cả khi tạm dừng)
    this.reclaimFinished(this.channels(), now0);
    const g0 = this.gate(now0, opts.force);
    if (!g0.ok) return { ...out, skipped: g0.reason };
    this.endWait(now0);

    const chans = this.channels();
    await this.ensurePlans(chans, now0);

    const entries: QueueEntry[] = [];
    for (const c of chans) {
      const today = this.dateOf(c, now0);
      const dates = [today, ...planDatesBefore(c, today).slice(0, C.RESUME_DAYS)];
      for (const date of dates) {
        (readPlan(c, date)?.items ?? []).forEach((item, index) => {
          if (date === today || item.status === 'in_production')
            entries.push({ channel: c, date, index, item });
        });
      }
    }
    for (const e of orderItems(entries)) {
      if (this.stopped) {
        out.outcomes.push({ channel: e.channel, item_id: e.item.id, outcome: 'stopped' });
        break;
      }
      const now = this.now();
      const g = this.gate(now, opts.force);
      if (!g.ok) {
        if (!out.outcomes.length) out.skipped = g.reason;
        break;
      }
      // người dùng có thể đã bỏ qua / sửa mục từ lúc xếp hàng
      const fresh = readPlan(e.channel, e.date)?.items.find((i) => i.id === e.item.id);
      if (!fresh || !QUEUED.has(fresh.status)) continue;
      const r = await this.produce({
        channel: e.channel,
        store: this.d.storeFor(e.channel),
        date: e.date,
        item: fresh,
        video: fresh.video_id ?? '',
      });
      out.outcomes.push({
        channel: e.channel,
        item_id: fresh.id,
        ...(r.video ? { video_id: r.video } : {}),
        outcome: r.outcome,
        ...(r.reason ? { reason: r.reason } : {}),
      });
      if (r.outcome === 'wait' || r.outcome === 'stopped') break;
    }
    return out;
  }

  private async ensurePlans(chans: string[], now: Date): Promise<void> {
    const missing = chans.filter((c) => !readPlan(c, this.dateOf(c, now)));
    if (!missing.length) return;
    try {
      const r = await this.d.plan({ channels: missing, now });
      for (const p of r.plans)
        if (p.added > 0)
          this.log(p.channel, p.plan.date, {
            level: 'info',
            event: 'plan.built',
            message: `Lập kế hoạch ngày ${p.plan.date}: ${p.plan.items.length} video (${p.added} mới${p.carried ? `, ${p.carried} chuyển từ hôm qua` : ''}).`,
            data: { items: p.plan.items.length, added: p.added, carried: p.carried },
          });
    } catch (e) {
      for (const c of missing)
        this.log(c, this.dateOf(c, now), {
          level: 'error',
          event: 'plan.error',
          message: `Không lập được kế hoạch ngày: ${message(e)}`,
        });
    }
  }

  // ---------- chờ hạn mức Claude ----------

  /** Sau khi khởi động lại: đọc nhật ký xem còn đang chờ hạn mức không. */
  private restoreWait(now: Date): void {
    let hit:
      | {
          ts: string;
          resume_at: string;
          channel: string;
          date: string;
          item_id?: string;
          video_id?: string;
        }
      | undefined;
    for (const c of this.channels()) {
      const today = this.dateOf(c, now);
      for (const date of [today, ...planDatesBefore(c, today).slice(0, 1)]) {
        for (const l of readLog(c, date)) {
          if (l.event === 'limit.hit' && typeof l.data?.resume_at === 'string') {
            if (!hit || l.ts > hit.ts)
              hit = {
                ts: l.ts,
                resume_at: l.data.resume_at,
                channel: c,
                date,
                ...(l.item_id ? { item_id: l.item_id } : {}),
                ...(l.video_id ? { video_id: l.video_id } : {}),
              };
          } else if (l.event === 'limit.resume' && hit && l.ts >= hit.ts) hit = undefined;
        }
      }
    }
    if (hit && Date.parse(hit.resume_at) > now.getTime()) {
      this.waitUntil = new Date(hit.resume_at);
      this.waitCtx = {
        channel: hit.channel,
        date: hit.date,
        item_id: hit.item_id ?? '',
        ...(hit.video_id ? { video_id: hit.video_id } : {}),
      };
    }
  }

  /** Hết giờ chờ → ghi `limit.resume` và làm tiếp. */
  private endWait(now: Date): void {
    if (!this.waitUntil || this.waitUntil > now) return;
    const w = this.waitCtx;
    this.waitUntil = undefined;
    this.waitCtx = undefined;
    if (w)
      this.log(w.channel, w.date, {
        level: 'info',
        event: 'limit.resume',
        ...(w.item_id ? { item_id: w.item_id as AutopilotLogLine['item_id'] } : {}),
        ...(w.video_id ? { video_id: w.video_id as AutopilotLogLine['video_id'] } : {}),
        message: 'Đã qua giờ hết hạn mức Claude — làm tiếp.',
      });
    this.changed();
  }

  private enterWait(c: Ctx, step_id: string | undefined, msg: string): Outcome {
    const now = this.now();
    const tz = this.app<string>('publish.timezone');
    const until = limitResumeAt(msg, now, tz);
    const parsed = parseLimit(msg, now, tz);
    this.waitUntil = until;
    this.waitCtx = { channel: c.channel, date: c.date, item_id: c.item.id, video_id: c.video };
    this.logItem(
      c,
      'warn',
      'limit.hit',
      `Chạm hạn mức Claude (${parsed?.kind === 'weekly' ? 'theo tuần' : parsed?.kind === 'session' ? 'theo phiên' : 'sử dụng'}) — tạm dừng tới ${until.toISOString()}${parsed?.resets_at ? '' : ' (không đọc được giờ hết hạn mức, chờ 1 giờ)'}, rồi làm tiếp đúng bước này.`,
      {
        ...(step_id ? { step_id } : {}),
        data: {
          resume_at: until.toISOString(),
          kind: parsed?.kind ?? 'usage',
          ...(parsed?.resets_at ? { resets_at: parsed.resets_at.toISOString() } : {}),
          message: msg,
        },
      },
    );
    this.changed();
    return { kind: 'wait' };
  }

  // ---------- làm một mục ----------

  private async produce(
    c: Ctx,
  ): Promise<{ outcome: ItemOutcome; video?: string; reason?: string }> {
    this.current = { channel: c.channel, item_id: c.item.id, title: c.item.title };
    const resuming = c.item.status === 'in_production' && Boolean(c.item.video_id);
    try {
      if (!resuming) {
        // chọn id video trước rồi mới tạo: sập giữa chừng vẫn nhận lại đúng video, không tạo hai lần
        const video = c.item.video_id ?? newId('vd', new Set(listVideoIds(c.channel)));
        c.item = markPlanItem(c.store, {
          date: c.date,
          item_id: c.item.id,
          patch: { status: 'in_production', video_id: video as PlanItem['video_id'], note: null },
          now: this.now(),
        });
        c.video = video;
        this.ensureVideo(c);
        this.logItem(
          c,
          'info',
          'item.start',
          `Bắt đầu làm "${c.item.title}" (${c.item.workflow_id} / ${c.item.output_profile}), video ${video}.`,
        );
      } else {
        c.video = c.item.video_id!;
        this.ensureVideo(c);
        this.logItem(c, 'info', 'item.resume', `Làm tiếp "${c.item.title}" ở video ${c.video}.`);
      }
      this.current = { ...this.current, video: c.video };
      this.changed();
      const briefed = await this.briefIfNeeded(c);
      const r = briefed ?? (await this.drive(c));
      return this.finish(c, r);
    } catch (e) {
      // lỗi ngoài dự kiến của bộ chạy: báo mục hỏng, mục sau vẫn chạy
      return this.finish(c, {
        kind: 'failed',
        reason: `Lỗi bộ chạy Autopilot: ${code(e)}: ${message(e)}`,
      });
    }
  }

  private finish(c: Ctx, r: Outcome): { outcome: ItemOutcome; video?: string; reason?: string } {
    const res = this.finishInner(c, r);
    // host ghi dòng hệ thống vào chat của video đỗ/hỏng để người mở video thấy lý do
    this.emit('item.outcome', {
      channel: c.channel,
      video: c.video,
      item_id: c.item.id,
      title: c.item.title,
      outcome: res.outcome,
      ...(res.reason ? { reason: res.reason } : {}),
    } satisfies ItemOutcomeEvent);
    return res;
  }

  /**
   * Mục `needs_review` (7 ngày gần nhất) có video đã xong mọi bước → `produced` để đi tiếp sang đăng (053).
   */
  private reclaimFinished(chans: string[], now: Date): void {
    for (const channel of chans) {
      const today = this.dateOf(channel, now);
      for (const date of [today, ...planDatesBefore(channel, today).slice(0, 7)]) {
        for (const item of readPlan(channel, date)?.items ?? []) {
          if (item.status !== 'needs_review' || !item.video_id) continue;
          let done = false;
          try {
            const steps = this.d.workflows.engine(channel, item.video_id).summary().steps;
            done =
              steps.length > 0 && steps.every((x) => x.status === 'done' || x.status === 'skipped');
          } catch {
            continue;
          }
          if (!done) continue;
          const c = { channel, store: this.d.storeFor(channel), date, item, video: item.video_id };
          markPlanItem(c.store, {
            date,
            item_id: item.id,
            patch: {
              status: 'produced',
              note: 'Bạn đã làm xong video bằng tay — Autopilot nhận lại để đăng',
            },
            now,
          });
          this.logItem(
            c,
            'info',
            'item.reclaimed',
            `"${item.title}" đã được làm xong bằng tay — chuyển lại Autopilot (đã làm xong).`,
          );
          this.changed();
        }
      }
    }
  }

  private finishInner(
    c: Ctx,
    r: Outcome,
  ): { outcome: ItemOutcome; video?: string; reason?: string } {
    const video = c.video || undefined;
    const base = { ...(video ? { video } : {}) };
    switch (r.kind) {
      case 'produced': {
        const note = `Đã làm xong${r.outputs.length ? `: ${r.outputs.join(', ')}` : ''}`;
        markPlanItem(c.store, {
          date: c.date,
          item_id: c.item.id,
          patch: { status: 'produced', note },
          now: this.now(),
        });
        this.logItem(c, 'info', 'item.produced', `Xong "${c.item.title}".`, {
          data: { outputs: r.outputs },
        });
        return { ...base, outcome: 'produced' };
      }
      case 'parked':
        markPlanItem(c.store, {
          date: c.date,
          item_id: c.item.id,
          patch: { status: 'needs_review', note: r.reason },
          now: this.now(),
        });
        this.logItem(c, 'warn', 'item.parked', `Đỗ "${c.item.title}", cần người xem: ${r.reason}`, {
          ...(r.step_id ? { step_id: r.step_id } : {}),
        });
        return { ...base, outcome: 'parked', reason: r.reason };
      case 'failed':
        markPlanItem(c.store, {
          date: c.date,
          item_id: c.item.id,
          patch: { status: 'failed', note: r.reason },
          now: this.now(),
        });
        this.logItem(c, 'error', 'item.failed', `Hỏng "${c.item.title}": ${r.reason}`, {
          ...(r.step_id ? { step_id: r.step_id } : {}),
        });
        return { ...base, outcome: 'failed', reason: r.reason };
      case 'wait':
        return { ...base, outcome: 'wait' };
      case 'stopped':
        return { ...base, outcome: 'stopped' };
    }
  }

  /** Tạo video (nếu chưa có) và đánh dấu `state.autopilot`; chạy lại an toàn. */
  private ensureVideo(c: Ctx): void {
    const rel = `videos/${c.video}/state.json`;
    if (!existsSync(c.store.abs(rel))) createVideo(c.store, { title: c.item.title, id: c.video });
    const st = JSON.parse(readFileSync(c.store.abs(rel), 'utf8')) as VideoState;
    if (st.autopilot) return;
    st.autopilot = {
      plan_date: c.date,
      item_id: c.item.id,
      channel_id: st.channel_id,
    };
    st.updated_at = this.now().toISOString();
    c.store.write(rel, `${JSON.stringify(st, null, 2)}\n`, { by: 'autopilot' });
  }

  private proposal(c: Ctx): boolean {
    try {
      const front = parseBlocksDoc(readFileSync(c.store.abs(`videos/${c.video}/BRIEF.md`), 'utf8'))
        .front as {
        proposed_workflow?: { id?: string } | null;
        proposed_output_profile?: string | null;
      };
      return Boolean(front.proposed_workflow?.id && front.proposed_output_profile);
    } catch {
      return false;
    }
  }

  /** Giao brief nếu video còn ở pha briefing và chưa có đề xuất; lỗi chạy lại một lần. */
  private async briefIfNeeded(c: Ctx): Promise<Outcome | undefined> {
    const e = this.d.workflows.engine(c.channel, c.video);
    if (e.readState().phase !== 'briefing' || this.proposal(c)) return undefined;
    for (;;) {
      if (this.stopped) return { kind: 'stopped' };
      try {
        if (!this.briefFn) throw new BriefMissing();
        await this.briefFn(c.channel, c.video, c.item);
        this.logItem(c, 'info', 'brief.done', 'Đã giao brief cho agent và nhận đề xuất workflow.');
        return undefined;
      } catch (err) {
        const msg = message(err);
        if (parseLimit(msg, this.now(), 'UTC')) return this.enterWait(c, 'brief', msg);
        const blocked = this.takeBlocked(c, 0);
        if (blocked)
          return { kind: 'parked', reason: `cần xác nhận chi phí: ${blocked}`, step_id: 'brief' };
        const r = this.retry(c, 'brief', code(err), msg);
        if (r) return r;
      }
    }
  }

  /** Còn lượt chạy lại → ghi nhật ký và trả `undefined` (gọi lại); hết lượt → báo mục hỏng. */
  private retry(c: Ctx, step: string, errCode: string, msg: string): Outcome | undefined {
    const key = `${c.channel}|${c.video}|${step}`;
    const n = this.retries.get(key) ?? 0;
    if (n >= C.STEP_RETRIES)
      return {
        kind: 'failed',
        step_id: step,
        reason: `Bước ${step} lỗi sau ${C.STEP_RETRIES} lần chạy lại: ${errCode}: ${msg}`,
      };
    this.retries.set(key, n + 1);
    this.logItem(
      c,
      'warn',
      'step.retry',
      `Bước ${step} lỗi (${errCode}: ${msg}) — chạy lại một lần.`,
      {
        step_id: step,
      },
    );
    return undefined;
  }

  private takeBlocked(c: Ctx, since: number): string | undefined {
    const key = `${canonicalDir(c.channel)}|${c.video}`;
    const b = this.blocked.get(key);
    if (!b || b.ts < since) return undefined;
    this.blocked.delete(key);
    return b.summary;
  }

  // ---------- chạy workflow tới bước cuối ----------

  private async drive(c: Ctx): Promise<Outcome> {
    const e = this.d.workflows.engine(c.channel, c.video);
    e.open();
    this.blocked.delete(`${canonicalDir(c.channel)}|${c.video}`);
    const attempt0 = Object.fromEntries(
      Object.entries(e.readState().steps).map(([id, s]) => [id, s.attempt]),
    );
    let last = '';
    let stall = 0;
    for (let n = 0; n < 500; n++) {
      if (this.stopped) return { kind: 'stopped' };
      const st = e.readState();
      if (st.phase === 'briefing') {
        const r = await this.decideBriefStep(c, e);
        if (r) return r;
        continue;
      }
      const manifest = this.d.workflows
        .packs()
        .find((p) => p.manifest.id === st.workflow?.id)?.manifest;
      if (!manifest)
        return {
          kind: 'failed',
          reason: `Workflow ${st.workflow?.id ?? '(chưa chọn)'} chưa được cài.`,
        };
      const order = executionOrder(manifest.steps).order;
      const status = (id: string) => st.steps[id]?.status ?? 'pending';
      this.logVoiceDefault(c, st, manifest);
      if (order.every((id) => done(status(id)))) {
        const outs = [...order]
          .reverse()
          .map((id) => st.steps[id]?.outputs ?? [])
          .find((o) => o.length);
        return { kind: 'produced', outputs: outs ?? [] };
      }
      const failedId = order.find((id) => status(id) === 'failed');
      if (failedId) {
        const r = await this.onFailed(c, e, st, manifest, failedId, attempt0);
        if (r) return r;
        continue;
      }
      const waitingId = order.find((id) => status(id) === 'waiting_approval');
      if (waitingId) {
        const r = await this.onWaiting(c, e, st, manifest, waitingId);
        if (r) return r;
        continue;
      }
      const next = order.find((id) => !done(status(id)))!;
      this.current = {
        ...(this.current ?? { channel: c.channel, item_id: c.item.id, title: c.item.title }),
        video: c.video,
        step_id: next,
      };
      this.changed();
      if (status(next) === 'running') await e.idle();
      else {
        try {
          await e.runTo(next);
        } catch (err) {
          return {
            kind: 'failed',
            step_id: next,
            reason: `Không chạy được bước ${next}: ${code(err)}: ${message(err)}`,
          };
        }
      }
      const sig = JSON.stringify([
        Object.entries(e.readState().steps).map(([id, s]) => [id, s.status, s.attempt]),
        e.readState().approvals.map((a) => [a.id, a.status]),
      ]);
      stall = sig === last ? stall + 1 : 0;
      last = sig;
      if (stall >= 3)
        return {
          kind: 'failed',
          step_id: next,
          reason: `Bước ${next} không tiến triển sau nhiều lần chạy.`,
        };
    }
    return { kind: 'failed', reason: 'Vòng điều phối quá dài, dừng để tránh chạy mãi.' };
  }

  /** Duyệt brief bằng cổng chất lượng: `BRIEF.md` phải đề xuất đúng workflow/dạng xuất của kế hoạch. */
  private async decideBriefStep(c: Ctx, e: WorkflowEngine): Promise<Outcome | undefined> {
    let st = e.readState();
    let ap = st.approvals.find((a) => a.step_id === 'brief' && a.status === 'pending');
    if (!ap) {
      await e.ensureBriefApproval();
      st = e.readState();
      ap = st.approvals.find((a) => a.step_id === 'brief' && a.status === 'pending');
    }
    if (!ap) {
      if (!this.proposal(c)) {
        // agent chưa chọn workflow: dùng đúng lựa chọn của kế hoạch (ghi nhật ký)
        await e.select(c.item.workflow_id, c.item.output_profile);
        this.logItem(
          c,
          'info',
          'brief.select',
          `BRIEF.md chưa đề xuất workflow — chọn theo kế hoạch: ${c.item.workflow_id} / ${c.item.output_profile}.`,
          { step_id: 'brief' },
        );
        return undefined;
      }
      return {
        kind: 'parked',
        step_id: 'brief',
        reason:
          'BRIEF.md đề xuất workflow hoặc dạng xuất không dùng được (chưa cài / không hợp lệ).',
      };
    }
    if (ap.note?.startsWith(AUTOPILOT_PARK_NOTE))
      return {
        kind: 'parked',
        step_id: 'brief',
        reason: ap.note.slice(AUTOPILOT_PARK_NOTE.length).trim(),
      };
    const front = parseBlocksDoc(readFileSync(c.store.abs(`videos/${c.video}/BRIEF.md`), 'utf8'))
      .front as Parameters<typeof decideBrief>[0];
    const plan = readPlan(c.channel, c.date)?.items.find((i) => i.id === c.item.id) ?? c.item;
    const d = decideBrief(front, plan);
    this.logItem(
      c,
      d.approve ? 'info' : 'warn',
      'gate.decision',
      `Brief: ${d.approve ? 'duyệt' : 'không duyệt'} — ${d.reason}.`,
      { step_id: 'brief', data: { approve: d.approve } },
    );
    if (!d.approve) {
      await e.annotate('brief', `${AUTOPILOT_PARK_NOTE} ${d.reason}`);
      return { kind: 'parked', step_id: 'brief', reason: d.reason };
    }
    await e.approve(ap.id, `${AUTOPILOT_APPROVAL_NOTE} ${d.reason}`);
    return undefined;
  }

  /** Điểm duyệt đang chờ: cổng đã đỗ từ trước (giữ nguyên) hoặc chưa quyết (khởi động lại giữa chừng) → quyết ngay. */
  private async onWaiting(
    c: Ctx,
    e: WorkflowEngine,
    st: VideoState,
    manifest: WorkflowManifest,
    stepId: string,
  ): Promise<Outcome | undefined> {
    const ap = [...st.approvals]
      .reverse()
      .find((a) => a.step_id === stepId && a.status === 'pending');
    if (!ap)
      return {
        kind: 'failed',
        step_id: stepId,
        reason: `Bước ${stepId} chờ duyệt nhưng không có điểm duyệt.`,
      };
    if (ap.note?.startsWith(AUTOPILOT_PARK_NOTE))
      return {
        kind: 'parked',
        step_id: stepId,
        reason: `Điểm chốt ${stepId}: ${ap.note.slice(AUTOPILOT_PARK_NOTE.length).trim()}`,
      };
    const decl = manifest.steps.find((s) => s.id === stepId) as StepDecl;
    const d = this.autoDecide(decl, st, {
      store: c.store,
      videoId: c.video,
      ...(this.d.appDataDir ? { appDataDir: this.d.appDataDir } : {}),
      refine: st.steps[stepId]?.refine,
    });
    if (d.approve) {
      await e.approve(ap.id, `${AUTOPILOT_APPROVAL_NOTE} ${d.reason}`);
      return undefined;
    }
    await e.annotate(stepId, `${AUTOPILOT_PARK_NOTE} ${d.reason}`);
    return { kind: 'parked', step_id: stepId, reason: `Điểm chốt ${stepId}: ${d.reason}` };
  }

  private async onFailed(
    c: Ctx,
    e: WorkflowEngine,
    st: VideoState,
    manifest: WorkflowManifest,
    stepId: string,
    attempt0: Record<string, number>,
  ): Promise<Outcome | undefined> {
    const s = st.steps[stepId]!;
    const errCode = s.error?.code ?? 'E_INTERNAL';
    const msg = s.error?.message ?? '';
    const fresh = s.attempt > (attempt0[stepId] ?? 0);
    const decl = manifest.steps.find((x) => x.id === stepId) as StepDecl;

    // 1. chạm hạn mức Claude
    if (parseLimit(msg, this.now(), 'UTC')) {
      const key = `${c.channel}|${c.video}|${stepId}`;
      const reruns = this.limitReruns.get(key) ?? 0;
      if (fresh || reruns >= C.LIMIT_RERUNS) {
        this.limitReruns.delete(key);
        return this.enterWait(c, stepId, fresh ? msg : "You've hit your limit"); // chạy lại sau hạn mức mà vẫn chạm: chờ 1 giờ
      }
      // lỗi cũ (từ trước khi chờ/khởi động lại), đã qua giờ reset: chạy lại đúng bước, không tính lần thử lại
      this.limitReruns.set(key, reruns + 1);
      return this.rerun(e, stepId);
    }
    // 2. yêu cầu quyền có phí không có người trả lời
    const started = s.started_at ? Date.parse(s.started_at) : 0;
    const blocked = this.takeBlocked(c, started);
    if (blocked)
      return { kind: 'parked', step_id: stepId, reason: `cần xác nhận chi phí: ${blocked}` };
    // 3. cảnh báo thời lượng (043): bỏ qua nếu lệch nhỏ
    if (errCode === 'E_GATE_WARNING' && /audio_duration/.test(msg)) {
      const gate = [...STEP_LIBRARY[decl.uses].gates(decl.params), ...(decl.gate ?? [])].find(
        (g) => g.kind === 'objective' && g.check === 'audio_duration',
      ) as { params?: { source?: string } } | undefined;
      const reading = audioDurationReading(
        c.store,
        c.video,
        gate?.params?.source === 'timeline' ? 'timeline' : 'audio',
      );
      const ratio = Number(this.cfg<number>('autopilot.duration_waive_ratio', c.channel, c.video));
      const d = reading
        ? decideDuration({ ...reading, ratio })
        : {
            approve: false,
            reason: 'không đo được thời lượng thật hoặc BRIEF.md không có thời lượng mục tiêu',
          };
      this.logItem(
        c,
        d.approve ? 'info' : 'warn',
        d.approve ? 'step.waive' : 'gate.decision',
        d.approve
          ? `Bước ${stepId}: bỏ qua cảnh báo thời lượng — ${d.reason}.`
          : `Bước ${stepId}: không bỏ qua cảnh báo thời lượng — ${d.reason}.`,
        { step_id: stepId, data: { approve: d.approve, ratio } },
      );
      if (!d.approve)
        return { kind: 'parked', step_id: stepId, reason: `Bước ${stepId}: ${d.reason}` };
      await e.waive(stepId, 'audio_duration');
      await e.idle();
      return undefined;
    }
    // 4. thiếu giọng đọc của kênh: không chờ người chọn
    if (/no voice for/i.test(msg))
      return { kind: 'parked', step_id: stepId, reason: `Kênh chưa có giọng đọc (${msg})` };
    // 5. lỗi khác: chạy lại một lần rồi báo
    if (errCode === 'E_WORKFLOW_INCOMPATIBLE')
      return { kind: 'failed', step_id: stepId, reason: `Bước ${stepId}: ${errCode}: ${msg}` };
    const r = this.retry(c, stepId, errCode, msg);
    if (r) return r;
    return this.rerun(e, stepId);
  }

  private async rerun(e: WorkflowEngine, stepId: string): Promise<Outcome | undefined> {
    try {
      await e.runTo(stepId);
    } catch (err) {
      return {
        kind: 'failed',
        step_id: stepId,
        reason: `Không chạy lại được bước ${stepId}: ${code(err)}: ${message(err)}`,
      };
    }
    return undefined;
  }

  /** Nhân vật chưa có giọng đã dùng giọng mặc định của kênh (video Autopilot không chờ người chọn). */
  private logVoiceDefault(c: Ctx, st: VideoState, manifest: WorkflowManifest): void {
    const voice = manifest.steps.find((s) => s.uses === 'voice');
    if (!voice || st.steps[voice.id]?.status !== 'done') return;
    const key = `${c.channel}|${c.video}`;
    if (this.voiceLogged.has(key)) return;
    this.voiceLogged.add(key);
    try {
      const m = loadVideoModel(c.channel, c.video, this.d.appDataDir);
      const who = [
        ...new Set(
          m.lines
            .filter(
              (l) =>
                l.speaker !== 'narrator' &&
                m.cast[l.speaker]?.role !== 'narrator' &&
                !m.cast[l.speaker]?.voice_id,
            )
            .map((l) => l.speaker),
        ),
      ];
      if (who.length)
        this.logItem(
          c,
          'info',
          'voice.default',
          `${who.join(', ')} chưa có giọng — dùng giọng mặc định của kênh (${String(m.config('voice.id'))}), không chờ người chọn.`,
          { step_id: voice.id, data: { speakers: who } },
        );
    } catch {
      /* chỉ để ghi nhật ký */
    }
  }
}

class BriefMissing extends Error {
  readonly code = 'E_STEP_INCOMPLETE';
  constructor() {
    super('no agent attached to write the brief');
  }
}

// ---------- đọc file ----------

/** Các line còn `asr_flag: mismatch` trong `audio_meta.json` (finalize chỉ duyệt khi không còn). */
function mismatchedLines(store: WriteStore, videoId: string): string[] {
  const f = store.abs(`videos/${videoId}/audio_meta.json`);
  if (!existsSync(f)) return [];
  try {
    const meta = JSON.parse(readFileSync(f, 'utf8')) as {
      lines?: { line_id: string; asr_flag?: string }[];
    };
    return (meta.lines ?? []).filter((l) => l.asr_flag === 'mismatch').map((l) => l.line_id);
  } catch {
    return [];
  }
}

const planDatesBefore = (channel: string, date: string): string[] =>
  planDates(channel).filter((d) => d < date);

function readLog(channel: string, date: string): AutopilotLogLine[] {
  const f = path.join(channel, 'autopilot', 'log', `${date}.jsonl`);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as AutopilotLogLine];
      } catch {
        return [];
      }
    });
}
