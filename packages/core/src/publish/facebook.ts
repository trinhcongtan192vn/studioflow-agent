import { statSync } from 'node:fs';
import { resolveConfig } from '../config/resolve.js';
import type { PlatformPublish } from '../contracts/types.js';
import { SfError } from '../errors.js';
import type { SecretStore } from '../secrets/store.js';
import type { FacebookApi } from './facebook-api.js';
import { isVerticalProfile, socialTokenSecret } from './social.js';
import type { PlatformPublisher, PublishContext } from './types.js';

/**
 * Bộ đăng Facebook Page Reels (056, FR-AP-10, D4 9.8): chỉ video dọc 9:16; hẹn giờ công khai bằng
 * `scheduled_publish_time` (giờ công khai = max(giờ trong kế hoạch, lúc tải + `publish.veto_hours`), tối thiểu +11 phút).
 */
export interface FacebookPublisherDeps {
  secrets: SecretStore;
  api: (channelId: string) => FacebookApi;
  appDataDir: string;
}

const iso = (d: Date) => d.toISOString();
const MIN_LEAD_MS = 11 * 60_000;
const MAX_LEAD_MS = 29 * 86_400_000;

export class FacebookPublisher implements PlatformPublisher {
  readonly platform = 'facebook' as const;
  readonly label = 'Facebook Reels';
  constructor(private readonly d: FacebookPublisherDeps) {}

  private pageId(channel: string): string | undefined {
    const v = resolveConfig<string | undefined>(
      'publish.facebook.page_id',
      { channelDir: channel },
      { appDataDir: this.d.appDataDir },
    ).value;
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  }

  async connected(ctx: { channel: string; channel_id: string }): Promise<boolean> {
    return (
      Boolean(await this.d.secrets.get(socialTokenSecret('facebook', ctx.channel_id))) &&
      Boolean(this.pageId(ctx.channel))
    );
  }

  eligible(ctx: PublishContext): { ok: true } | { ok: false; reason: string } {
    return isVerticalProfile(ctx.render.output_profile)
      ? { ok: true }
      : {
          ok: false,
          reason: `Facebook Reels chỉ nhận video dọc 9:16, bản này xuất ${ctx.render.output_profile} (video ngang)`,
        };
  }

  private schedule(ctx: PublishContext): { veto_until: Date; publish_at: Date } {
    const veto = new Date(ctx.now.getTime() + ctx.veto_hours * 3_600_000);
    const planned = ctx.item.publish_at ? new Date(ctx.item.publish_at) : veto;
    let at = planned > veto ? planned : veto;
    at = new Date(
      Math.min(
        Math.max(at.getTime(), ctx.now.getTime() + MIN_LEAD_MS),
        ctx.now.getTime() + MAX_LEAD_MS,
      ),
    );
    return { veto_until: veto, publish_at: at };
  }

  async upload(ctx: PublishContext): Promise<PlatformPublish> {
    const page = this.pageId(ctx.channel);
    if (!page)
      throw new SfError(
        'E_PROVIDER_UNAVAILABLE',
        'chưa đặt ID Trang Facebook (publish.facebook.page_id)',
      );
    const api = this.d.api(ctx.channel_id);
    const sched = this.schedule(ctx);
    const attempts = ctx.prev?.attempts ?? 1;
    let videoId = ctx.prev?.status === 'uploading' ? ctx.prev.video_id : undefined;
    let uploadUrl: string | undefined;
    if (!videoId) {
      if (statSync(ctx.render.file).size <= 0)
        throw new SfError('E_PROVIDER_FAILED', 'file video rỗng');
      const s = await api.start(page);
      videoId = s.video_id;
      uploadUrl = s.upload_url;
      // ghi ngay video_id: nếu app tắt giữa chừng thì lần sau không mở phiên mới
      ctx.patch({ status: 'uploading', video_id: videoId, attempts });
    }
    uploadUrl ??= `https://rupload.facebook.com/video-upload/v21.0/${videoId}`;
    await api.upload({ upload_url: uploadUrl, file: ctx.render.file });
    const desc = [
      ctx.meta.description,
      ctx.meta.tags.map((t) => `#${t.replace(/\s+/g, '')}`).join(' '),
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 2200);
    await api.finish(page, {
      video_id: videoId,
      description: desc || ctx.item.title,
      title: (ctx.meta.title || ctx.item.title).slice(0, 100),
      schedule: sched.publish_at,
    });
    return {
      status: 'scheduled',
      video_id: videoId,
      url: `https://www.facebook.com/reel/${videoId}`,
      publish_at: iso(sched.publish_at),
      veto_until: iso(sched.veto_until),
      uploaded_at: iso(ctx.now),
      attempts,
    };
  }

  async cancel(ctx: PublishContext, st: PlatformPublish): Promise<PlatformPublish> {
    if (st.video_id) await this.d.api(ctx.channel_id).remove(st.video_id);
    const { publish_at: _p, ...rest } = st;
    void _p;
    return {
      ...rest,
      status: 'cancelled',
      note: 'Đã hủy — video hẹn giờ đã được xóa khỏi Trang Facebook.',
    };
  }

  async publishNow(
    ctx: PublishContext,
    st: PlatformPublish,
  ): Promise<{ state: PlatformPublish; note?: string }> {
    if (!st.video_id) throw new SfError('E_SCHEMA_INVALID', 'video chưa được tải lên Facebook');
    await this.d.api(ctx.channel_id).publishNow(st.video_id);
    const { publish_at: _p, ...rest } = st;
    void _p;
    return { state: { ...rest, status: 'public', publish_at: iso(ctx.now) } };
  }

  async refresh(ctx: PublishContext, st: PlatformPublish): Promise<PlatformPublish> {
    if (!st.video_id) return st;
    const s = await this.d.api(ctx.channel_id).state(st.video_id);
    if (!s.published) return st;
    return { ...st, status: 'public', ...(s.permalink ? { url: s.permalink } : {}) };
  }
}
