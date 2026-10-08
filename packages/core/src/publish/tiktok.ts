import { statSync } from 'node:fs';
import { resolveAppConfig } from '../config/resolve.js';
import type { PlatformPublish } from '../contracts/types.js';
import { SfError } from '../errors.js';
import type { PlatformPublisher, PublishContext } from './types.js';
import { isVerticalProfile, socialTokenSecret } from './social.js';
import type { SecretStore } from '../secrets/store.js';
import { TIKTOK_CONSTANTS, type TikTokApi } from './tiktok-api.js';

/**
 * Bộ đăng TikTok (056, FR-AP-10, D4 9.8): chỉ video dọc 9:16. TikTok không có hẹn giờ qua API:
 * `publish.tiktok.audited` = false → bài `SELF_ONLY` (trạng thái `private`, người dùng tự công khai trong app TikTok);
 * = true → chỉ tải lên khi tới giờ công khai (`due`), bài `PUBLIC_TO_EVERYONE`.
 */
export interface TikTokPublisherDeps {
  secrets: SecretStore;
  api: (channelId: string) => TikTokApi;
  appDataDir: string;
}

const iso = (d: Date) => d.toISOString();

export class TikTokPublisher implements PlatformPublisher {
  readonly platform = 'tiktok' as const;
  readonly label = 'TikTok';
  constructor(private readonly d: TikTokPublisherDeps) {}

  private audited(): boolean {
    return (
      resolveAppConfig<boolean>('publish.tiktok.audited', { appDataDir: this.d.appDataDir }) ===
      true
    );
  }

  async connected(ctx: { channel_id: string }): Promise<boolean> {
    return Boolean(await this.d.secrets.get(socialTokenSecret('tiktok', ctx.channel_id)));
  }

  eligible(ctx: PublishContext): { ok: true } | { ok: false; reason: string } {
    return isVerticalProfile(ctx.render.output_profile)
      ? { ok: true }
      : {
          ok: false,
          reason: `TikTok chỉ nhận video dọc 9:16, bản này xuất ${ctx.render.output_profile} (video ngang)`,
        };
  }

  /** Đã kiểm duyệt → chỉ đăng công khai đúng giờ (API không hẹn giờ); chưa → đăng riêng tư ngay. */
  due(ctx: PublishContext): Date | undefined {
    // 091: video làm tay đăng ngay
    if (ctx.mode === 'now' || !this.audited() || !ctx.item.publish_at) return undefined;
    return new Date(ctx.item.publish_at);
  }

  async upload(ctx: PublishContext): Promise<PlatformPublish> {
    const api = this.d.api(ctx.channel_id);
    const audited = this.audited();
    const attempts = ctx.prev?.attempts ?? 1;
    let publishId = ctx.prev?.status === 'uploading' ? ctx.prev.video_id : undefined;
    if (!publishId) {
      const file = ctx.render.file;
      const size = statSync(file).size;
      if (size <= 0) throw new SfError('E_PROVIDER_FAILED', 'file video rỗng');
      const init = await api.init({
        title: tiktokCaption(ctx.meta.title || ctx.item.title, ctx.meta.tags),
        privacy: audited ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY',
        size,
      });
      publishId = init.publish_id;
      // ghi ngay publish_id: app tắt giữa chừng thì lần sau chỉ hỏi trạng thái, không tải trùng
      ctx.patch({ status: 'uploading', video_id: publishId, attempts });
      await api.upload({
        upload_url: init.upload_url,
        file,
        chunk: init.chunk,
        chunks: init.chunks,
      });
    }
    const r = await api.waitDone(publishId);
    if (!r.done)
      throw new SfError(
        'E_PROVIDER_FAILED',
        `TikTok vẫn đang xử lý video (${r.status}) — sẽ hỏi lại ở lượt sau`,
      );
    const common = {
      video_id: r.post_ids?.[0] ?? publishId,
      uploaded_at: iso(ctx.now),
      attempts,
    };
    if (audited)
      return {
        status: 'public',
        ...common,
        ...(ctx.item.publish_at ? { publish_at: ctx.item.publish_at } : {}),
      };
    return {
      status: 'private',
      ...common,
      note: r.inbox
        ? 'Video đã vào hộp thư của TikTok — mở app TikTok để hoàn tất và công khai.'
        : 'Ứng dụng TikTok chưa được kiểm duyệt nên bài ở chế độ "chỉ mình tôi" — mở app TikTok → Hồ sơ → Chỉ mình tôi để công khai.',
    };
  }

  async cancel(_ctx: PublishContext, st: PlatformPublish): Promise<PlatformPublish> {
    return {
      ...st,
      status: 'cancelled',
      note: st.video_id
        ? 'Đã hủy — TikTok không cho xóa qua API, bài vẫn ở chế độ riêng tư trong app TikTok (xóa tay nếu không cần).'
        : 'Đã hủy — chưa tải gì lên TikTok.',
    };
  }

  async publishNow(
    _ctx: PublishContext,
    st: PlatformPublish,
  ): Promise<{ state: PlatformPublish; note?: string }> {
    return {
      state: st,
      note: this.audited()
        ? 'Bài TikTok được đăng công khai đúng giờ hẹn; TikTok không cho đăng sớm hơn qua API.'
        : 'Ứng dụng TikTok chưa được kiểm duyệt nên app không công khai được — mở app TikTok để đổi hiển thị.',
    };
  }
}

/**
 * 091: chú thích TikTok = tiêu đề + hashtag từ thẻ (bỏ khoảng trắng), tối đa `TITLE_MAX` ký tự; hashtag không vừa thì
 * bỏ cả thẻ (không cắt giữa thẻ).
 */
export function tiktokCaption(title: string, tags: string[]): string {
  const max = TIKTOK_CONSTANTS.TITLE_MAX;
  let out = title.trim().slice(0, max);
  for (const t of tags) {
    const h = `#${t.replace(/[\s#]+/g, '')}`;
    if (h.length < 2) continue;
    if (out.length + 1 + h.length > max) break;
    out = `${out} ${h}`;
  }
  return out;
}
