import { readFileSync } from 'node:fs';
import type { WriteStore } from '../store/writer.js';
import { SfError } from '../errors.js';
import { resolveConfig, setConfig } from './resolve.js';

/** 085: tính năng nâng cao — mặc định tắt; đặt ở app, kênh hoặc từng video (D3 7.2). */
export const ADVANCED_KEYS = ['advanced.refine', 'advanced.music', 'advanced.reasoning'] as const;
export type AdvancedKey = (typeof ADVANCED_KEYS)[number];

export interface AdvancedFlag {
  value: boolean;
  /** Tầng cho giá trị: `default` | `app` | `channel` | `video`. */
  source: string;
  /** Giá trị kênh sẽ cho nếu video bỏ ghi đè (hiển thị "Theo kênh"). */
  inherited: boolean;
}

export function isAdvancedKey(k: string): k is AdvancedKey {
  return (ADVANCED_KEYS as readonly string[]).includes(k);
}

/** Giá trị đã giải của mọi khóa `advanced.*` cho kênh (và video nếu có). */
export function advancedFlags(
  channelDir: string,
  videoId: string | undefined,
  appDataDir: string | undefined,
): Record<AdvancedKey, AdvancedFlag> {
  const out = {} as Record<AdvancedKey, AdvancedFlag>;
  for (const k of ADVANCED_KEYS) {
    const r = resolveConfig<boolean>(
      k,
      { channelDir, ...(videoId ? { videoId } : {}) },
      { appDataDir },
    );
    const up = videoId ? resolveConfig<boolean>(k, { channelDir }, { appDataDir }).value : r.value;
    out[k] = { value: r.value === true, source: r.source, inherited: up === true };
  }
  return out;
}

/** Bật/tắt ở tầng kênh hoặc video; `null` = bỏ ghi đè ở tầng đó (theo tầng trên). */
export function setAdvanced(
  store: WriteStore,
  key: string,
  value: boolean | null,
  videoId?: string,
): void {
  if (!isAdvancedKey(key)) throw new SfError('E_CONFIG_SCOPE', `${key} is not an advanced feature`);
  if (value !== null && typeof value !== 'boolean')
    throw new SfError('E_SCHEMA_INVALID', `${key} must be true, false or null`);
  if (value !== null) {
    setConfig(store, key, value, videoId ? { tier: 'video', videoId } : { tier: 'channel' });
    return;
  }
  const rel = videoId ? `videos/${videoId}/state.json` : 'channel.json';
  const doc = JSON.parse(readFileSync(store.abs(rel), 'utf8')) as Record<string, unknown>;
  const field = videoId ? 'config_overrides' : 'config';
  const cfg = { ...((doc[field] as Record<string, unknown>) ?? {}) };
  if (!(key in cfg)) return;
  delete cfg[key];
  doc[field] = cfg;
  if (videoId) doc.updated_at = new Date().toISOString();
  store.write(rel, `${JSON.stringify(doc, null, 2)}\n`, { by: 'config.set' });
}
