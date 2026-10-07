import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAppConfig, resolveConfig, setConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';
import type { SecretStore } from '../secrets/store.js';
import type { WriteStore } from '../store/writer.js';
import { socialTokenSecret, type SocialPlatform } from './social.js';

/**
 * Kết nối TikTok / Facebook theo kênh (056): người dùng dán token trong Cài đặt kênh (OAuth đầy đủ để sau).
 * Token vào kho bí mật (qua `main`, D5 5.4), không bao giờ trả lại giao diện và không vào file/log.
 */
export interface SocialAccountsDeps {
  secrets: SecretStore;
  storeFor: (channelDir: string) => WriteStore;
  appDataDir: string;
  onChange?: (channelDir: string) => void;
}

export interface SocialStatus {
  connected: boolean;
  audited?: boolean;
  page_id?: string;
}

const idOf = (dir: string): string => {
  try {
    return (JSON.parse(readFileSync(path.join(dir, 'channel.json'), 'utf8')) as { id: string }).id;
  } catch {
    throw new SfError('E_NOT_CHANNEL', `${dir} has no channel.json`);
  }
};

export class SocialAccounts {
  /** Host đặt để phát sự kiện `publish.updated`. */
  onChange?: (channelDir: string) => void;
  constructor(private readonly d: SocialAccountsDeps) {
    this.onChange = d.onChange;
  }

  async setToken(
    platform: SocialPlatform,
    channelDir: string,
    token: string,
    o: { page_id?: string } = {},
  ): Promise<{ ok: true }> {
    const t = String(token ?? '').trim();
    if (t.length < 20 || t.length > 2000 || /\s/.test(t))
      throw new SfError(
        'E_SCHEMA_INVALID',
        'token không hợp lệ (20–2000 ký tự, không có khoảng trắng)',
      );
    const id = idOf(channelDir);
    if (platform === 'facebook' && o.page_id !== undefined) {
      const page = String(o.page_id).trim();
      if (!/^\d{5,25}$/.test(page))
        throw new SfError('E_SCHEMA_INVALID', 'ID Trang Facebook là một dãy số');
      setConfig(this.d.storeFor(channelDir), 'publish.facebook.page_id', page, { tier: 'channel' });
    }
    await this.d.secrets.set(socialTokenSecret(platform, id), t);
    this.onChange?.(channelDir);
    return { ok: true };
  }

  async status(platform: SocialPlatform, channelDir: string): Promise<SocialStatus> {
    const connected = Boolean(
      await this.d.secrets.get(socialTokenSecret(platform, idOf(channelDir))),
    );
    if (platform === 'tiktok')
      return {
        connected,
        audited:
          resolveAppConfig<boolean>('publish.tiktok.audited', { appDataDir: this.d.appDataDir }) ===
          true,
      };
    const page = resolveConfig<string | undefined>(
      'publish.facebook.page_id',
      { channelDir },
      { appDataDir: this.d.appDataDir },
    ).value;
    return { connected, ...(page ? { page_id: page } : {}) };
  }

  async disconnect(platform: SocialPlatform, channelDir: string): Promise<{ ok: true }> {
    await this.d.secrets.delete(socialTokenSecret(platform, idOf(channelDir)));
    this.onChange?.(channelDir);
    return { ok: true };
  }
}
