import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfig } from '../config/resolve.js';
import type {
  AutopilotLogLine,
  PlanItem,
  PlatformPublish,
  PublishStatus,
} from '../contracts/types.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { SfError } from '../errors.js';
import { markPlanItem, planDates, readPlan } from '../autopilot/plan.js';
import type { WriteStore } from '../store/writer.js';
import { escapeHtml } from '../telegram/client.js';
import type { Notifier } from '../telegram/notifier.js';
import { findReleaseRender } from './youtube.js';
import type {
  Platform,
  PlatformPublisher,
  PreviewPort,
  PublishContext,
  PublishMeta,
} from './types.js';

/**
 * Bộ đăng (053/056, FR-AP-09/10): nhận mục `produced` của kế hoạch ngày, tải lên từng nền tảng đã kết nối
 * (một lúc một video), ghi `publish.<nền tảng>` vào kế hoạch, nhật ký vận hành, xem trước Telegram với nút
 * Hủy đăng / Đăng ngay trong cửa sổ phản đối. Gọi từ vòng `tick` của bộ chạy Autopilot (trong khung giờ làm việc).
 */
export const PUBLISH_CONSTANTS = { MAX_ATTEMPTS: 3, PLAN_DAYS: 3 } as const;
const C = PUBLISH_CONSTANTS;
export const PUBLISH_CALLBACK = 'pub';

export interface PublishServiceDeps {
  appDataDir: string;
  storeFor: (channelDir: string) => WriteStore;
  /** Kênh Autopilot đang bật. */
  channels: () => string[];
  clock?: () => Date;
  notifier?: Notifier;
}

type Ref = { channel: string; date: string; item: PlanItem };

const FINAL: ReadonlySet<PublishStatus> = new Set(['private', 'public', 'cancelled']);

const fmtLocal = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

export class PublishService {
  private readonly publishers = new Map<Platform, PlatformPublisher>();
  private preview?: PreviewPort;
  private running = false;
  private readonly warned = new Set<string>();

  constructor(private readonly d: PublishServiceDeps) {}

  private now(): Date {
    return this.d.clock?.() ?? new Date();
  }

  register(p: PlatformPublisher): void {
    this.publishers.set(p.platform, p);
  }

  setPreview(p: PreviewPort | undefined): void {
    this.preview = p;
  }

  setNotifier(n: Notifier | undefined): void {
    (this.d as { notifier?: Notifier }).notifier = n;
  }

  // ---------- nhật ký / thông báo ----------

  private emit(ref: { channel: string; date: string }, line: Omit<AutopilotLogLine, 'ts'>): void {
    const full = { ts: this.now().toISOString(), ...line } as AutopilotLogLine;
    try {
      this.d
        .storeFor(ref.channel)
        .appendLine(`autopilot/log/${ref.date}.jsonl`, JSON.stringify(full), {
          by: 'publish',
        });
    } catch {
      /* nhật ký là phụ */
    }
    if (this.d.notifier)
      void Promise.resolve(
        this.d.notifier.notify({
          kind: full.event,
          channel: ref.channel,
          channel_name: this.meta(ref.channel).name,
          level: full.level,
          message: full.message,
          ...(full.item_id ? { item_id: full.item_id } : {}),
          ...(full.data ? { data: full.data } : {}),
        }),
      ).catch(() => {});
  }

  private meta(channel: string): { id: string; name: string; language: string } {
    try {
      const c = JSON.parse(readFileSync(path.join(channel, 'channel.json'), 'utf8')) as {
        id: string;
        name?: string;
        language?: string;
      };
      return { id: c.id, name: c.name ?? path.basename(channel), language: c.language ?? 'vi' };
    } catch {
      return { id: path.basename(channel), name: path.basename(channel), language: 'vi' };
    }
  }

  private tz(channel: string): string {
    return resolveConfig<string>(
      'publish.timezone',
      { channelDir: channel },
      { appDataDir: this.d.appDataDir },
    ).value;
  }

  private dateOf(channel: string, now: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.tz(channel),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  // ---------- tìm / ghi trạng thái ----------

  private dates(channel: string, now: Date): string[] {
    const today = this.dateOf(channel, now);
    return [
      today,
      ...planDates(channel)
        .filter((x) => x < today)
        .slice(0, C.PLAN_DAYS - 1),
    ];
  }

  /** Mục theo ID trong các kế hoạch gần đây của các kênh Autopilot (hoặc một kênh). */
  find(itemId: string, o: { channel?: string; date?: string } = {}): Ref | undefined {
    const now = this.now();
    for (const channel of o.channel ? [o.channel] : this.d.channels()) {
      for (const date of o.date ? [o.date] : this.dates(channel, now)) {
        const item = readPlan(channel, date)?.items.find((i) => i.id === itemId);
        if (item) return { channel, date, item };
      }
    }
    return undefined;
  }

  private set(ref: Ref, platform: Platform, state: PlatformPublish): PlanItem {
    return markPlanItem(this.d.storeFor(ref.channel), {
      date: ref.date,
      item_id: ref.item.id,
      patch: { publish: { [platform]: state } },
      now: this.now(),
    });
  }

  // ---------- ngữ cảnh ----------

  private context(ref: Ref, platform: Platform, now: Date): PublishContext {
    const m = this.meta(ref.channel);
    const video = ref.item.video_id!;
    const render = findReleaseRender(ref.channel, video);
    if (!render)
      throw new SfError(
        'E_FILE_NOT_FOUND',
        'chưa có bản render phát hành (release) của video để đăng — chỉ bản nháp có chữ NHÁP',
      );
    const pf = path.join(ref.channel, 'videos', video, 'publish.md');
    let meta: PublishMeta = {
      title: ref.item.title,
      description: '',
      tags: [],
      chapters: [],
      language: m.language,
    };
    if (existsSync(pf)) {
      const b = parseBlocksDoc(readFileSync(pf, 'utf8'));
      meta = {
        title: String(b.front.title ?? ref.item.title),
        description: b.body.join('\n').trim(),
        tags: Array.isArray(b.front.tags) ? (b.front.tags as unknown[]).map(String) : [],
        chapters: Array.isArray(b.front.chapters)
          ? (b.front.chapters as { start_ms: number; title: string }[])
          : [],
        language: m.language,
      };
    }
    const store = this.d.storeFor(ref.channel);
    return {
      channel: ref.channel,
      channel_id: m.id,
      channel_name: m.name,
      store,
      date: ref.date,
      item: ref.item,
      video,
      render,
      meta,
      now,
      ...(ref.item.publish?.[platform] ? { prev: ref.item.publish[platform] } : {}),
      patch: (s) => void this.set(ref, platform, s),
      veto_hours: Number(
        resolveConfig<number>(
          'publish.veto_hours',
          { channelDir: ref.channel },
          { appDataDir: this.d.appDataDir },
        ).value,
      ),
    };
  }

  // ---------- vòng xử lý ----------

  /** Một lượt: tải lên mục chưa đăng, làm mới trạng thái hẹn giờ. Một lượt tại một thời điểm. */
  async process(now: Date = this.now()): Promise<{ uploaded: number }> {
    if (this.running) return { uploaded: 0 };
    this.running = true;
    let uploaded = 0;
    try {
      for (const channel of this.d.channels()) {
        for (const date of this.dates(channel, now)) {
          for (const item of readPlan(channel, date)?.items ?? []) {
            if (item.status !== 'produced' || !item.video_id) continue;
            for (const pf of item.platforms as Platform[]) {
              const p = this.publishers.get(pf);
              if (!p) continue;
              const fresh = readPlan(channel, date)?.items.find((i) => i.id === item.id) ?? item;
              if (await this.step({ channel, date, item: fresh }, p, now)) uploaded += 1;
            }
          }
        }
      }
    } finally {
      this.running = false;
    }
    return { uploaded };
  }

  /** Xử lý một mục × nền tảng; true nếu vừa tải lên. */
  private async step(ref: Ref, p: PlatformPublisher, now: Date): Promise<boolean> {
    const st = ref.item.publish?.[p.platform];
    if (st && FINAL.has(st.status)) return false;
    if (st?.status === 'scheduled') {
      await this.refresh(ref, p, st, now);
      return false;
    }
    if (st?.status === 'failed' && (st.attempts ?? 0) >= C.MAX_ATTEMPTS) return false;
    const m = this.meta(ref.channel);
    const log = (
      level: AutopilotLogLine['level'],
      event: string,
      message: string,
      data?: Record<string, unknown>,
    ) =>
      this.emit(ref, {
        level,
        event,
        item_id: ref.item.id,
        video_id: ref.item.video_id,
        message,
        ...(data
          ? { data: { platform: p.platform, ...data } }
          : { data: { platform: p.platform } }),
      });
    let ctx: PublishContext;
    try {
      ctx = this.context(ref, p.platform, now);
    } catch (e) {
      this.set(ref, p.platform, {
        status: 'failed',
        attempts: C.MAX_ATTEMPTS,
        error: (e as Error).message,
      });
      log(
        'error',
        'publish.failed',
        `Không đăng được “${ref.item.title}” lên ${p.label}: ${(e as Error).message}`,
      );
      return false;
    }
    const el = p.eligible(ctx);
    if (!el.ok) {
      // không phù hợp nền tảng này (ví dụ video ngang lên Reels): bỏ qua có ghi chú, không phải lỗi
      if (st?.note !== el.reason) {
        this.set(ref, p.platform, { status: 'cancelled', note: `Bỏ qua ${p.label}: ${el.reason}` });
        log('info', 'publish.skipped', `Bỏ qua ${p.label} cho “${ref.item.title}”: ${el.reason}`);
      }
      return false;
    }
    if (!(await p.connected({ channel: ref.channel, channel_id: m.id }))) {
      const error = `Kênh ${m.name} chưa kết nối ${p.label} — kết nối trong Cài đặt kênh rồi video sẽ tự được đăng`;
      if (st?.error !== error) this.set(ref, p.platform, { status: 'pending', error });
      const key = `${ref.item.id}:${p.platform}`;
      if (!this.warned.has(key)) {
        this.warned.add(key);
        log('warn', 'publish.pending', error);
      }
      return false;
    }
    const attempts = (st?.attempts ?? 0) + 1;
    this.set(ref, p.platform, {
      ...(st ?? {}),
      status: 'uploading',
      attempts,
      error: undefined,
    } as PlatformPublish);
    ctx = { ...ctx, prev: { ...(st ?? {}), status: 'uploading', attempts } };
    log(
      'info',
      'publish.upload',
      `Đang tải “${ref.item.title}” lên ${p.label} (lần ${attempts}/${C.MAX_ATTEMPTS}).`,
    );
    try {
      const done = await p.upload(ctx);
      const clean = { ...done };
      delete clean.error;
      this.set(ref, p.platform, clean);
      this.afterUpload(ref, p, clean, ctx, log);
      return true;
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      const cur = this.find(ref.item.id, { channel: ref.channel, date: ref.date })?.item.publish?.[
        p.platform
      ];
      this.set(ref, p.platform, { ...(cur ?? {}), status: 'failed', attempts, error: msg });
      log(
        'error',
        'publish.failed',
        `Tải “${ref.item.title}” lên ${p.label} lỗi (lần ${attempts}/${C.MAX_ATTEMPTS}): ${msg}${attempts >= C.MAX_ATTEMPTS ? ' — dừng thử lại, cần bạn xem.' : ' — sẽ thử lại.'}`,
      );
      return false;
    }
  }

  private afterUpload(
    ref: Ref,
    p: PlatformPublisher,
    st: PlatformPublish,
    ctx: PublishContext,
    log: (l: AutopilotLogLine['level'], e: string, m: string, d?: Record<string, unknown>) => void,
  ): void {
    const tz = this.tz(ref.channel);
    const when =
      st.status === 'scheduled' && st.publish_at
        ? `Tự công khai lúc ${fmtLocal(st.publish_at, tz)} (${tz}).`
        : 'Chế độ riêng tư — hãy công khai thủ công khi sẵn sàng.';
    log(
      'info',
      st.status === 'scheduled' ? 'publish.scheduled' : 'publish.private',
      `Đã tải “${ref.item.title}” lên ${p.label} (${st.status === 'scheduled' ? 'hẹn giờ công khai' : 'riêng tư'}). ${when}`,
      { video_id_platform: st.video_id, ...(st.publish_at ? { publish_at: st.publish_at } : {}) },
    );
    if (!this.preview) return;
    const veto = st.veto_until ? `Bạn có tới ${fmtLocal(st.veto_until, tz)} để hủy.` : '';
    const text = [
      `📤 <b>${escapeHtml(ctx.channel_name)}</b> · ${escapeHtml(p.label)}`,
      `“${escapeHtml(ref.item.title)}”`,
      `🕒 ${escapeHtml(when)}`,
      ...(veto ? [`⏳ ${escapeHtml(veto)}`] : []),
      ...(st.url ? [`🔗 ${escapeHtml(st.url)}`] : []),
      ...(st.note && st.status === 'scheduled' ? [`ℹ️ ${escapeHtml(st.note)}`] : []),
    ].join('\n');
    const id = ref.item.id;
    void this.preview
      .send({
        text,
        buttons: [
          [
            { text: '🛑 Hủy đăng', data: `${PUBLISH_CALLBACK}:c:${p.platform}:${id}` },
            ...(st.status === 'scheduled'
              ? [{ text: '🚀 Đăng ngay', data: `${PUBLISH_CALLBACK}:n:${p.platform}:${id}` }]
              : []),
          ],
        ],
      })
      .catch(() => {});
  }

  private async refresh(
    ref: Ref,
    p: PlatformPublisher,
    st: PlatformPublish,
    now: Date,
  ): Promise<void> {
    if (!p.refresh) return;
    try {
      const next = await p.refresh(this.context(ref, p.platform, now), st);
      if (next.status !== st.status) {
        this.set(ref, p.platform, next);
        this.emit(ref, {
          level: 'info',
          event: 'publish.public',
          item_id: ref.item.id,
          video_id: ref.item.video_id,
          message: `“${ref.item.title}” đã công khai trên ${p.label}${next.url ? `: ${next.url}` : ''}.`,
          data: { platform: p.platform },
        });
      }
    } catch {
      /* làm mới thất bại không phải lỗi đăng — lượt sau thử lại */
    }
  }

  // ---------- hành động của người dùng ----------

  private target(o: { channel: string; item_id: string; date?: string; platform?: Platform }) {
    const ref = this.find(o.item_id, { channel: o.channel, ...(o.date ? { date: o.date } : {}) });
    if (!ref) throw new SfError('E_ID_UNKNOWN', `plan item ${o.item_id} not found`);
    const platform = o.platform ?? ('youtube' as Platform);
    const p = this.publishers.get(platform);
    if (!p) throw new SfError('E_PROVIDER_UNAVAILABLE', `chưa hỗ trợ đăng lên ${platform}`);
    const st = ref.item.publish?.[platform];
    if (!st)
      throw new SfError(
        'E_SCHEMA_INVALID',
        `item ${o.item_id} has no ${platform} publish state yet`,
      );
    return { ref, p, st, platform };
  }

  /** Hủy đăng (Hủy trong cửa sổ phản đối): video ở lại riêng tư. */
  async cancel(o: {
    channel: string;
    item_id: string;
    date?: string;
    platform?: Platform;
  }): Promise<{
    status: PublishStatus;
    note?: string;
  }> {
    const { ref, p, st, platform } = this.target(o);
    if (st.status === 'public')
      throw new SfError(
        'E_SCHEMA_INVALID',
        'video đã công khai — không hủy được, hãy đổi trạng thái trong YouTube Studio',
      );
    if (st.status === 'cancelled') return { status: 'cancelled', note: st.note };
    const next = p.cancel
      ? await p.cancel(this.context(ref, platform, this.now()), st)
      : { ...st, status: 'cancelled' as const };
    this.set(ref, platform, next);
    this.emit(ref, {
      level: 'info',
      event: 'publish.cancelled',
      item_id: ref.item.id,
      video_id: ref.item.video_id,
      message: `Đã hủy đăng “${ref.item.title}” trên ${p.label} (video ở lại riêng tư).`,
      data: { platform },
    });
    return { status: next.status, ...(next.note ? { note: next.note } : {}) };
  }

  /** Đăng ngay (khi nền tảng cho phép). */
  async publishNow(o: {
    channel: string;
    item_id: string;
    date?: string;
    platform?: Platform;
  }): Promise<{
    status: PublishStatus;
    url?: string;
    note?: string;
  }> {
    const { ref, p, st, platform } = this.target(o);
    if (st.status === 'public') return { status: 'public', ...(st.url ? { url: st.url } : {}) };
    if (st.status === 'cancelled')
      throw new SfError('E_SCHEMA_INVALID', 'bản đăng đã bị hủy — không đăng ngay được');
    if (!p.publishNow)
      throw new SfError('E_PROVIDER_UNAVAILABLE', `${p.label} không hỗ trợ đăng ngay`);
    const r = await p.publishNow(this.context(ref, platform, this.now()), st);
    if (r.state.status !== st.status || r.state.note !== st.note) this.set(ref, platform, r.state);
    if (r.state.status === 'public')
      this.emit(ref, {
        level: 'info',
        event: 'publish.public',
        item_id: ref.item.id,
        video_id: ref.item.video_id,
        message: `Đã đăng ngay “${ref.item.title}” lên ${p.label}.`,
        data: { platform },
      });
    return {
      status: r.state.status,
      ...(r.state.url ? { url: r.state.url } : {}),
      ...(r.note ? { note: r.note } : {}),
    };
  }

  /** Nút inline `pub:<c|n>:<nền tảng>:<item_id>` của tin xem trước Telegram. */
  async handleCallback(
    data: string,
  ): Promise<{ text: string; alert?: boolean; clear_markup?: boolean }> {
    const [action, platform, itemId] = data.split(':');
    const ref = itemId ? this.find(itemId) : undefined;
    if (!ref || !platform)
      return { text: 'Không tìm thấy bản đăng này.', alert: true, clear_markup: true };
    try {
      if (action === 'c') {
        const r = await this.cancel({
          channel: ref.channel,
          item_id: ref.item.id,
          date: ref.date,
          platform: platform as Platform,
        });
        return { text: r.note ?? 'Đã hủy đăng.', clear_markup: true };
      }
      if (action === 'n') {
        const r = await this.publishNow({
          channel: ref.channel,
          item_id: ref.item.id,
          date: ref.date,
          platform: platform as Platform,
        });
        return {
          text:
            r.note ?? (r.status === 'public' ? 'Đã đăng công khai.' : `Trạng thái: ${r.status}`),
          alert: Boolean(r.note),
          clear_markup: !r.note,
        };
      }
    } catch (e) {
      return { text: String((e as Error).message).slice(0, 190), alert: true };
    }
    return { text: 'Nút không hợp lệ.', alert: true };
  }

  /** Trạng thái đăng của các mục đã làm xong trong ngày (cho tool/IPC). */
  status(
    channel: string,
    date?: string,
  ): {
    date: string;
    items: { id: string; title: string; status: string; publish?: PlanItem['publish'] }[];
  } {
    const d = date ?? this.dateOf(channel, this.now());
    return {
      date: d,
      items: (readPlan(channel, d)?.items ?? [])
        .filter((i) => i.status === 'produced' || i.publish)
        .map((i) => ({
          id: i.id,
          title: i.title,
          status: i.status,
          ...(i.publish ? { publish: i.publish } : {}),
        })),
    };
  }
}
