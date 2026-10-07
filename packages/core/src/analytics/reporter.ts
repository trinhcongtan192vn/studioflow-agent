import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAppConfig, resolveConfig } from '../config/resolve.js';
import type { DailyReport } from '../contracts/types.js';
import { SfError } from '../errors.js';
import { readPlan, zoneParts, zonedMs } from '../autopilot/plan.js';
import type { QuotaLedger } from '../publish/quota.js';
import { YT_UNITS } from '../publish/quota.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';
import type { MetricsCollector } from './collector.js';
import { channelDays, videoViews } from './metrics-db.js';
import { composeReport, formatReportHtml } from './report.js';

/**
 * Báo cáo ngày (054, FR-AP-11): mỗi ngày một lần vào `report.time` (giờ địa phương của từng kênh), idempotent và
 * chịu khởi động lại nhờ file `autopilot/reports/<ngày>.json` (`delivered_at` = đã gửi). `/report` và IPC
 * `report.run` soạn lại theo yêu cầu mà không đánh dấu đã gửi.
 */
export interface ReportServiceDeps {
  db: Db;
  appDataDir: string;
  storeFor: (channelDir: string) => WriteStore;
  channels: () => string[];
  collector: Pick<MetricsCollector, 'collect' | 'collectAll'>;
  quota: QuotaLedger;
  /** Token Claude đã dùng từ đầu ngày địa phương `sinceMs` và ngân sách Autopilot trong ngày (null = chưa biết). */
  claude: (sinceMs: number) => { used_tokens: number; budget_tokens: number | null };
  /** Gửi tin HTML vào nhóm; trả false nếu Telegram chưa bật/chưa cấu hình. */
  send?: (html: string) => Promise<boolean>;
  clock?: () => Date;
}

export interface ChannelReportRun {
  channel: string;
  report: DailyReport;
  text: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Kiểm giá trị `report.time` / `report.enabled` khi đặt từ Cài đặt (054). */
export function checkReportValue(key: string, value: unknown): void {
  if (key === 'report.enabled' && typeof value !== 'boolean')
    throw new SfError('E_SCHEMA_INVALID', 'report.enabled must be boolean');
  if (key === 'report.time' && !(typeof value === 'string' && HHMM.test(value)))
    throw new SfError('E_SCHEMA_INVALID', 'report.time must be HH:MM (24h), e.g. 21:00');
}

export const REPORT_KEYS = ['report.time', 'report.enabled'] as const;
export const reportRel = (date: string) => `autopilot/reports/${date}.json`;

export class ReportService {
  constructor(private readonly d: ReportServiceDeps) {}

  /** Host nối kênh gửi (Telegram) sau khi dựng xong. */
  setSend(send: ReportServiceDeps['send']): void {
    this.d.send = send;
  }

  private now(): Date {
    return this.d.clock?.() ?? new Date();
  }

  private tz(channel: string): string {
    return resolveConfig<string>(
      'publish.timezone',
      { channelDir: channel },
      { appDataDir: this.d.appDataDir },
    ).value;
  }

  private meta(channel: string): { id: string; name: string } {
    const c = JSON.parse(readFileSync(path.join(channel, 'channel.json'), 'utf8')) as {
      id: string;
      name?: string;
    };
    return { id: c.id, name: c.name ?? path.basename(channel) };
  }

  private localDate(channel: string, now: Date): string {
    const p = zoneParts(now.getTime(), this.tz(channel));
    const z = (n: number) => String(n).padStart(2, '0');
    return `${p.y}-${z(p.mo)}-${z(p.d)}`;
  }

  /** Soạn báo cáo kênh từ số liệu hiện có (không ghi). Thu số liệu mới nếu cũ hơn 6 giờ. */
  async compose(channel: string, o: { now?: Date } = {}): Promise<DailyReport> {
    const now = o.now ?? this.now();
    const { id, name } = this.meta(channel);
    const date = this.localDate(channel, now);
    let fetch_error: string | undefined;
    let connected = true;
    // thu số liệu mới nếu cũ hơn 6 giờ (collector tự bỏ qua khi còn mới / chưa kết nối)
    const r = await this.d.collector.collect(channel);
    if (r.reason === 'not_connected') connected = false;
    if (r.reason === 'error') fetch_error = r.error;
    const upTo = date;
    const from = new Date(Date.parse(`${upTo}T00:00:00Z`) - 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const days = channelDays(this.d.db, id, 'youtube', from, upTo);
    const weekAgo = new Date(Date.parse(`${upTo}T00:00:00Z`) - 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const cfg = <T>(k: string) =>
      resolveConfig<T>(k, { channelDir: channel }, { appDataDir: this.d.appDataDir }).value;
    const startOfDay = zonedMs(date, 0, 0, this.tz(channel));
    return composeReport({
      channel_id: id,
      channel_name: name,
      date,
      now,
      connected,
      days,
      video_views: videoViews(this.d.db, id, 'youtube', weekAgo, upTo),
      plan: readPlan(channel, date),
      claude: this.d.claude(startOfDay),
      quota: { used: this.d.quota.usedToday(), limit: YT_UNITS.DAILY },
      max_per_day: Number(cfg('autopilot.max_per_day')),
      ...(fetch_error ? { fetch_error } : {}),
    });
  }

  private read(channel: string, date: string): DailyReport | undefined {
    try {
      const f = path.join(channel, reportRel(date));
      return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as DailyReport) : undefined;
    } catch {
      return undefined;
    }
  }

  private write(channel: string, r: DailyReport): void {
    this.d
      .storeFor(channel)
      .write(reportRel(r.date), `${JSON.stringify(r, null, 2)}\n`, { by: 'report' });
  }

  /** Báo cáo gần nhất đã lập của kênh (hôm nay, nếu chưa có thì ngày trước đó). */
  latest(channel: string, date?: string): DailyReport | undefined {
    if (date) return this.read(channel, date);
    const dir = path.join(channel, 'autopilot', 'reports');
    if (!existsSync(dir)) return undefined;
    const last = datesIn(dir).at(-1);
    return last ? this.read(channel, last) : undefined;
  }

  /** Lập báo cáo theo yêu cầu (lệnh /report, IPC): không ghi file, không đánh dấu đã gửi; `send` → gửi vào nhóm. */
  async run(
    o: { channel?: string; send?: boolean } = {},
  ): Promise<{ reports: DailyReport[]; text: string; runs: ChannelReportRun[] }> {
    const chans = o.channel ? [o.channel] : this.d.channels();
    const runs: ChannelReportRun[] = [];
    for (const channel of chans) {
      const report = await this.compose(channel);
      runs.push({ channel, report, text: formatReportHtml(report, this.tz(channel)) });
    }
    if (o.send && this.d.send) for (const r of runs) await this.d.send(r.text).catch(() => false);
    return { reports: runs.map((r) => r.report), text: runs.map((r) => r.text).join('\n\n'), runs };
  }

  /**
   * Một lượt định kỳ (gọi từ `tick`): kênh nào đã tới `report.time` (giờ địa phương) mà chưa có báo cáo đã gửi hôm
   * nay → thu số liệu, soạn, ghi file, gửi. Chưa gửi được (Telegram tắt/lỗi) thì file ở lại chưa `delivered_at`
   * và lượt sau chỉ thử gửi lại.
   */
  async process(now: Date = this.now()): Promise<{ sent: number }> {
    const enabled = resolveAppConfig<boolean>('report.enabled', { appDataDir: this.d.appDataDir });
    if (enabled === false) return { sent: 0 };
    const time = String(resolveAppConfig<string>('report.time', { appDataDir: this.d.appDataDir }));
    const m = HHMM.exec(time);
    if (!m) return { sent: 0 };
    let sent = 0;
    for (const channel of this.d.channels()) {
      const date = this.localDate(channel, now);
      const p = zoneParts(now.getTime(), this.tz(channel));
      if (p.h * 60 + p.mi < Number(m[1]) * 60 + Number(m[2])) continue;
      let report = this.read(channel, date);
      if (report?.delivered_at) continue;
      if (!this.d.send) continue;
      try {
        report ??= await this.compose(channel, { now });
        if (!this.read(channel, date)) this.write(channel, report);
        const ok = await this.d.send(formatReportHtml(report, this.tz(channel)));
        if (ok) {
          this.write(channel, { ...report, delivered_at: now.toISOString() });
          sent += 1;
        }
      } catch {
        /* lượt sau thử lại */
      }
    }
    return { sent };
  }

  /** Cho tool/IPC: báo cáo của ngày (file nếu có, không thì soạn ngay, không ghi). */
  async get(channel: string, date?: string): Promise<DailyReport> {
    const d = date ?? this.localDate(channel, this.now());
    const stored = this.read(channel, d);
    if (stored) return stored;
    if (date && date !== this.localDate(channel, this.now()))
      throw new SfError('E_FILE_NOT_FOUND', `no report for ${date}`);
    return this.compose(channel);
  }
}

function datesIn(dir: string): string[] {
  return readdirSync(dir)
    .map((n) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(n)?.[1])
    .filter((x): x is string => Boolean(x))
    .sort();
}
