import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAppConfig, setConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';
import type { YouTubeAuth } from './oauth.js';
import { YT_UNITS, type QuotaLedger } from './quota.js';
import type { YouTubeApi } from './youtube-api.js';

/**
 * Kết nối YouTube theo kênh StudioFlow (053): bắt đầu OAuth, đọc trạng thái, ngắt. Khóa `publish.youtube.channel_id`
 * (tầng kênh, không bí mật) ghi lại kênh YouTube mà token thuộc về.
 */
export interface YouTubeAccountsDeps {
  auth: YouTubeAuth;
  api: (channelId: string) => YouTubeApi;
  storeFor: (channelDir: string) => WriteStore;
  quota: QuotaLedger;
  appDataDir: string;
  /** Sau khi kết nối xong/ngắt (host phát sự kiện). */
  onChange?: (channelDir: string) => void;
  log?: (msg: string) => void;
}

const idOf = (dir: string): string => {
  try {
    return (JSON.parse(readFileSync(path.join(dir, 'channel.json'), 'utf8')) as { id: string }).id;
  } catch {
    throw new SfError('E_NOT_CHANNEL', `${dir} has no channel.json`);
  }
};

export class YouTubeAccounts {
  /** Host đặt để phát sự kiện `publish.updated`. */
  onChange?: (channelDir: string) => void;

  constructor(private readonly d: YouTubeAccountsDeps) {
    this.onChange = d.onChange;
  }

  async connect(channelDir: string): Promise<{ auth_url: string }> {
    const id = idOf(channelDir);
    const { auth_url, done } = await this.d.auth.begin(id);
    void done.then(
      async () => {
        try {
          const me = await this.d.api(id).channelsMine();
          setConfig(this.d.storeFor(channelDir), 'publish.youtube.channel_id', me.id, {
            tier: 'channel',
          });
        } catch (e) {
          this.d.log?.(
            `youtube: kết nối xong nhưng chưa đọc được kênh: ${String((e as Error).message)}`,
          );
        }
        this.onChange?.(channelDir);
      },
      (e: Error) => this.d.log?.(`youtube: kết nối không hoàn tất: ${e.message}`),
    );
    return { auth_url };
  }

  async status(channelDir: string): Promise<{
    connected: boolean;
    audited: boolean;
    youtube_channel_id?: string;
    channel_title?: string;
    quota: { used: number; limit: number };
    error?: string;
  }> {
    const id = idOf(channelDir);
    const base = {
      audited:
        resolveAppConfig<boolean>('publish.youtube.audited', { appDataDir: this.d.appDataDir }) ===
        true,
      quota: { used: this.d.quota.usedToday(), limit: YT_UNITS.DAILY },
    };
    if (!(await this.d.auth.connected(id))) return { connected: false, ...base };
    try {
      const me = await this.d.api(id).channelsMine();
      return { connected: true, ...base, youtube_channel_id: me.id, channel_title: me.title };
    } catch (e) {
      return { connected: true, ...base, error: String((e as Error).message) };
    }
  }

  async disconnect(channelDir: string): Promise<{ ok: true }> {
    await this.d.auth.disconnect(idOf(channelDir));
    this.onChange?.(channelDir);
    return { ok: true };
  }
}
