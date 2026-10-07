import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeOutsideProject } from '../store/scratch.js';
import { YOUTUBE_QUOTA_UNITS, YOUTUBE_UPLOAD_UNITS } from '../autopilot/capacity.js';

/** Đơn vị quota YouTube Data API v3 theo lời gọi (D4 9.6, 053). */
export const YT_UNITS = {
  DAILY: YOUTUBE_QUOTA_UNITS,
  INSERT: YOUTUBE_UPLOAD_UNITS,
  CAPTION: 400,
  UPDATE: 50,
  THUMBNAIL: 50,
  LIST: 1,
} as const;

/** Google đặt lại quota lúc nửa đêm giờ Thái Bình Dương. */
export function quotaDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const file = (appDataDir: string) => path.join(appDataDir, 'youtube', 'quota.json');

/** Số đơn vị đã dùng hôm nay (ngày Thái Bình Dương); không có file / ngày khác → 0. */
export function readQuotaUsed(appDataDir: string, now: Date): number {
  try {
    if (!existsSync(file(appDataDir))) return 0;
    const q = JSON.parse(readFileSync(file(appDataDir), 'utf8')) as {
      date?: string;
      units?: number;
    };
    return q.date === quotaDate(now) && typeof q.units === 'number' ? q.units : 0;
  } catch {
    return 0;
  }
}

/** Sổ quota bền theo ngày (dữ liệu app). Google tính quota cả khi lời gọi lỗi → đếm trước khi gọi. */
export class QuotaLedger {
  constructor(
    private readonly appDataDir: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  usedToday(): number {
    return readQuotaUsed(this.appDataDir, this.clock());
  }

  add(units: number): number {
    const now = this.clock();
    const used = readQuotaUsed(this.appDataDir, now) + units;
    writeOutsideProject(
      file(this.appDataDir),
      `${JSON.stringify({ date: quotaDate(now), units: used })}\n`,
    );
    return used;
  }

  left(): number {
    return Math.max(0, YT_UNITS.DAILY - this.usedToday());
  }
}
