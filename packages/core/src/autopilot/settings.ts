import { requireKey, typeMatches } from '../config/keys.js';
import { resolveConfig, setConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';

/**
 * Cài đặt Autopilot (M6, 047) — khóa D3 7.2 `autopilot.*` / `publish.*`. Bảng D3 lo kiểu và tầng; ở đây
 * kiểm thêm dạng giá trị (ID kênh, khung giờ, tỉ lệ…) để lỗi hiện ngay lúc người dùng nhập.
 */
export const CHANNEL_AUTOPILOT_KEYS = [
  'autopilot.enabled',
  'autopilot.competitors',
  'autopilot.pillars',
  'autopilot.workflows',
  'autopilot.max_per_day',
  'autopilot.min_score',
  'autopilot.duration_waive_ratio',
  'publish.platforms',
  'publish.slots',
  'publish.timezone',
  'publish.veto_hours',
  'publish.ai_disclosure',
] as const;

export const APP_AUTOPILOT_KEYS = [
  'autopilot.paused',
  'autopilot.background',
  'autopilot.work_window',
  'autopilot.duration_waive_ratio',
  'autopilot.budget_share',
  'autopilot.daily_tokens',
  'publish.timezone',
  'publish.veto_hours',
] as const;

export const PLATFORMS = ['youtube', 'tiktok', 'facebook'] as const;

const HHMM = '(?:[01]\\d|2[0-3]):[0-5]\\d';
const DAY = '(?:mon|tue|wed|thu|fri|sat|sun)';
const SLOT = new RegExp(`^(?:${DAY}(?:-${DAY})? )?${HHMM}$`);
const WINDOW = new RegExp(`^(${HHMM})-(${HHMM})$`);
const CHANNEL_ID = /^UC[\w-]{22}$/;

const invalid = (key: string, why: string) => new SfError('E_SCHEMA_INVALID', `${key}: ${why}`);

/** Kiểm kiểu (bảng D3) và dạng giá trị của một khóa Autopilot; sai → `E_SCHEMA_INVALID`. */
export function checkAutopilotValue(key: string, value: unknown): void {
  const spec = requireKey(key);
  // 050: null = tự học ngân sách Claude từ lần chạm hạn mức (FN-050)
  if (key === 'autopilot.daily_tokens' && value === null) return;
  if (!typeMatches(spec.type, value)) throw invalid(key, `must be ${spec.type}`);
  const list = value as string[];
  const n = value as number;
  switch (key) {
    case 'autopilot.competitors': {
      const bad = list.filter((x) => !CHANNEL_ID.test(x));
      if (bad.length)
        throw invalid(
          key,
          `not YouTube channel ids (UC…): ${bad.join(', ')} — resolve URLs/@handles first`,
        );
      return;
    }
    case 'publish.slots': {
      const bad = list.filter((x) => !SLOT.test(x));
      if (bad.length) throw invalid(key, `use "HH:MM" or "<mon…sun> HH:MM": ${bad.join(', ')}`);
      return;
    }
    case 'publish.platforms': {
      const bad = list.filter((x) => !(PLATFORMS as readonly string[]).includes(x));
      if (bad.length)
        throw invalid(key, `unknown platform: ${bad.join(', ')} (${PLATFORMS.join(', ')})`);
      return;
    }
    case 'autopilot.work_window': {
      const m = WINDOW.exec(value as string);
      if (!m || m[1] === m[2]) throw invalid(key, 'use "HH:MM-HH:MM" (start ≠ end)');
      return;
    }
    case 'autopilot.budget_share':
      if (n < 0 || n > 1) throw invalid(key, 'must be between 0 and 1');
      return;
    case 'autopilot.max_per_day':
      if (!Number.isInteger(n) || n < 0 || n > 20)
        throw invalid(key, 'must be a whole number 0–20');
      return;
    case 'autopilot.min_score':
      if (n < 0 || n > 100) throw invalid(key, 'must be between 0 and 100');
      return;
    case 'autopilot.duration_waive_ratio':
      if (n < 0 || n > 1) throw invalid(key, 'must be between 0 and 1');
      return;
    case 'autopilot.daily_tokens':
      if (!Number.isInteger(n) || n <= 0)
        throw invalid(key, 'must be a positive whole number of tokens (or null = learn)');
      return;
    case 'publish.veto_hours':
      if (n < 0 || n > 72) throw invalid(key, 'must be 0–72 hours');
      return;
    case 'publish.timezone':
      try {
        new Intl.DateTimeFormat('en', { timeZone: value as string });
      } catch {
        throw invalid(key, `unknown IANA time zone "${String(value)}"`);
      }
      return;
  }
}

export type ResolvedSetting = { value: unknown; source: string };

/** Giá trị đã giải của các khóa Autopilot tầng kênh (kèm nguồn: default / app / channel). */
export function channelAutopilot(
  channelDir: string,
  appDataDir?: string,
): Record<string, ResolvedSetting> {
  return Object.fromEntries(
    CHANNEL_AUTOPILOT_KEYS.map((k) => {
      const r = resolveConfig(k, { channelDir }, { appDataDir });
      return [k, { value: r.value, source: r.source }];
    }),
  );
}

/** Ghi một khóa Autopilot ở tầng kênh (qua module ghi, `channel.json`). */
export function setChannelAutopilot(store: WriteStore, key: string, value: unknown): void {
  checkAutopilotValue(key, value);
  setConfig(store, key, value, { tier: 'channel' });
}
