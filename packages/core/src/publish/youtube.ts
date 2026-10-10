import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { readdirSync } from 'node:fs';
import type { CaptionGroups, CaptionOverrides, PlatformPublish } from '../contracts/types.js';
import { resolveAppConfig, resolveConfig, setConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';
import { writeOutsideProject } from '../store/scratch.js';
import type { YouTubeAuth } from './oauth.js';
import type { PlatformPublisher, PublishContext } from './types.js';
import { buildVideoMetadata, captionsToSrt } from './youtube-meta.js';
import type { YouTubeApi } from './youtube-api.js';

/** Bộ đăng YouTube (053, FR-AP-09): riêng tư + hẹn giờ công khai; chưa kiểm duyệt → riêng tư, người dùng tự công khai. */
export interface YouTubePublisherDeps {
  auth: YouTubeAuth;
  api: (channelId: string) => YouTubeApi;
  appDataDir: string;
}

const iso = (d: Date) => d.toISOString();
const sessionFile = (appData: string, item: string) =>
  path.join(appData, 'publish', 'sessions', `${item}-youtube.json`);

export class YouTubePublisher implements PlatformPublisher {
  readonly platform = 'youtube' as const;
  readonly label = 'YouTube';
  constructor(private readonly d: YouTubePublisherDeps) {}

  private audited(): boolean {
    return (
      resolveAppConfig<boolean>('publish.youtube.audited', { appDataDir: this.d.appDataDir }) ===
      true
    );
  }

  connected(ctx: { channel_id: string }): Promise<boolean> {
    return this.d.auth.connected(ctx.channel_id);
  }

  eligible(): { ok: true } {
    return { ok: true };
  }

  /** Khai báo nội dung AI (`publish.ai_disclosure` theo video → kênh → app; mặc định không). */
  private synthetic(ctx: PublishContext): boolean {
    return (
      resolveConfig<boolean>(
        'publish.ai_disclosure',
        { channelDir: ctx.channel, ...(ctx.video ? { videoId: ctx.video } : {}) },
        { appDataDir: this.d.appDataDir },
      ).value === true
    );
  }

  /** Giờ công khai thật = max(giờ trong kế hoạch, lúc tải lên + giờ phản đối). */
  private schedule(ctx: PublishContext): { veto_until: Date; publish_at: Date } {
    const veto = new Date(ctx.now.getTime() + ctx.veto_hours * 3_600_000);
    const planned = ctx.item.publish_at ? new Date(ctx.item.publish_at) : veto;
    return { veto_until: veto, publish_at: planned > veto ? planned : veto };
  }

  async upload(ctx: PublishContext): Promise<PlatformPublish> {
    const api = this.d.api(ctx.channel_id);
    const audited = this.audited();
    const sched = this.schedule(ctx);
    const prev = ctx.prev;
    let videoId = prev?.status === 'uploading' ? prev.video_id : undefined;

    if (!videoId) {
      // token đúng kênh: kênh YouTube của token phải khớp kênh đã gắn khi kết nối
      const me = await api.channelsMine();
      const mapped = resolveConfig<string | undefined>(
        'publish.youtube.channel_id',
        { channelDir: ctx.channel },
        { appDataDir: this.d.appDataDir },
      ).value;
      if (mapped && mapped !== me.id)
        throw new SfError(
          'E_PROVIDER_FAILED',
          `token YouTube thuộc kênh "${me.title}", không phải kênh đã gắn với ${ctx.channel_name} — kết nối lại`,
        );
      if (!mapped) setConfig(ctx.store, 'publish.youtube.channel_id', me.id, { tier: 'channel' });

      const metadata = buildVideoMetadata({
        title: ctx.meta.title || ctx.item.title,
        description: ctx.render.description ?? ctx.meta.description,
        tags: ctx.meta.tags,
        chapters: ctx.meta.chapters,
        language: ctx.meta.language,
        audited,
        synthetic: this.synthetic(ctx),
        ...(ctx.mode === 'now' ? { publicNow: true } : { publishAt: sched.publish_at }),
      });
      const sf = sessionFile(this.d.appDataDir, ctx.item.id);
      const size = statSync(ctx.render.file).size;
      let sessionUri: string | undefined;
      try {
        const s = JSON.parse(readFileSync(sf, 'utf8')) as { uri?: string; size?: number };
        if (s.uri && s.size === size) sessionUri = s.uri;
      } catch {
        /* chưa có phiên cũ */
      }
      const r = await api.insertVideo({
        file: ctx.render.file,
        metadata,
        ...(sessionUri ? { sessionUri } : {}),
        onSession: (uri) => writeOutsideProject(sf, `${JSON.stringify({ uri, size })}\n`),
      });
      videoId = r.id;
      // ghi ngay ID: nếu app tắt giữa chừng, lần sau không tải trùng
      ctx.patch({
        status: 'uploading',
        video_id: videoId,
        url: `https://youtu.be/${videoId}`,
        attempts: prev?.attempts ?? 1,
      });
    }

    const notes: string[] = [];
    const vdir = path.join(ctx.channel, 'videos', ctx.video);
    // phụ đề (không bắt buộc): lỗi chỉ ghi chú
    try {
      const gf = path.join(vdir, 'caption_groups.json');
      if (existsSync(gf)) {
        const of = path.join(vdir, 'caption-overrides.json');
        const srt = captionsToSrt(
          JSON.parse(readFileSync(gf, 'utf8')) as CaptionGroups,
          existsSync(of) ? (JSON.parse(readFileSync(of, 'utf8')) as CaptionOverrides) : undefined,
        );
        if (srt)
          await api.insertCaption(videoId, {
            language: ctx.meta.language,
            name: ctx.meta.language,
            srt,
          });
      }
    } catch (e) {
      notes.push(`Phụ đề chưa tải được: ${String((e as Error).message).slice(0, 160)}`);
    }
    // hình đại diện (chưa workflow nào sinh; có file thì dùng)
    try {
      for (const [name, mime] of [
        ['thumbnail.jpg', 'image/jpeg'],
        ['thumbnail.png', 'image/png'],
      ] as const) {
        const tf = path.join(vdir, name);
        if (existsSync(tf)) {
          await api.setThumbnail(videoId, new Uint8Array(readFileSync(tf)), mime);
          break;
        }
      }
    } catch (e) {
      notes.push(`Hình đại diện chưa đặt được: ${String((e as Error).message).slice(0, 160)}`);
    }
    try {
      writeOutsideProject(sessionFile(this.d.appDataDir, ctx.item.id), '{}\n');
    } catch {
      /* dọn phiên là phụ */
    }

    const common = {
      video_id: videoId,
      url: `https://youtu.be/${videoId}`,
      uploaded_at: iso(ctx.now),
      ...(ctx.mode === 'now' ? {} : { veto_until: iso(sched.veto_until) }),
      attempts: prev?.attempts ?? 1,
    };
    const note = notes.join(' ');
    // 091: video làm tay — đăng ngay, công khai khi dự án API đã kiểm duyệt
    if (ctx.mode === 'now' && audited)
      return { status: 'public', publish_at: iso(ctx.now), ...common, ...(note ? { note } : {}) };
    if (audited)
      return {
        status: 'scheduled',
        publish_at: iso(sched.publish_at),
        ...common,
        ...(note ? { note } : {}),
      };
    return {
      status: 'private',
      ...common,
      note: [
        ctx.mode === 'now'
          ? 'Dự án API YouTube chưa được Google kiểm duyệt nên video ở chế độ riêng tư — mở link, vào YouTube Studio → Hiển thị → Công khai'
          : 'Dự án API YouTube chưa được Google kiểm duyệt nên video ở chế độ riêng tư, không hẹn giờ được — hãy công khai thủ công trong YouTube Studio',
        ctx.item.publish_at ? `(giờ dự kiến ${ctx.item.publish_at})` : '',
        note,
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  async cancel(ctx: PublishContext, st: PlatformPublish): Promise<PlatformPublish> {
    if (st.video_id && st.status === 'scheduled')
      await this.d
        .api(ctx.channel_id)
        .updateStatus(st.video_id, { privacyStatus: 'private' }, this.synthetic(ctx));
    return { ...st, status: 'cancelled', note: 'Đã hủy đăng — video ở lại riêng tư trên YouTube.' };
  }

  async publishNow(
    ctx: PublishContext,
    st: PlatformPublish,
  ): Promise<{ state: PlatformPublish; note?: string }> {
    if (!st.video_id) throw new SfError('E_SCHEMA_INVALID', 'video chưa được tải lên YouTube');
    if (!this.audited())
      return {
        state: st,
        note: `Dự án API YouTube chưa được kiểm duyệt nên app không công khai được. Mở ${st.url ?? 'video'} trong YouTube Studio → Hiển thị → Công khai.`,
      };
    await this.d
      .api(ctx.channel_id)
      .updateStatus(st.video_id, { privacyStatus: 'public' }, this.synthetic(ctx));
    const { publish_at: _drop, ...rest } = st;
    void _drop;
    return {
      state: {
        ...rest,
        status: 'public',
        publish_at: iso(ctx.now),
        note: 'Đã đăng công khai ngay.',
      },
    };
  }

  async refresh(ctx: PublishContext, st: PlatformPublish): Promise<PlatformPublish> {
    if (st.status !== 'scheduled' || !st.video_id || !st.publish_at) return st;
    if (new Date(st.publish_at) > ctx.now) return st;
    const s = await this.d.api(ctx.channel_id).videoStatus(st.video_id);
    if (s?.privacyStatus === 'public') return { ...st, status: 'public' };
    return st;
  }
}

/** Bản render phát hành mới nhất đã xong của video; không có → `undefined`. */
export function findReleaseRender(
  channel: string,
  video: string,
):
  | { id: string; file: string; duration_ms?: number; output_profile: string; description?: string }
  | undefined {
  const dir = path.join(channel, 'videos', video, 'renders');
  if (!existsSync(dir)) return undefined;
  const recs = readdirSync(dir).flatMap((rd) => {
    try {
      const r = JSON.parse(readFileSync(path.join(dir, rd, 'render.json'), 'utf8')) as {
        id: string;
        mode: string;
        status: string;
        file?: string;
        duration_ms?: number;
        output_profile: string;
        finished_at?: string;
      };
      if (r.mode !== 'release' || r.status !== 'done' || !r.file) return [];
      const file = path.join(channel, 'videos', video, ...r.file.split('/'));
      if (!existsSync(file)) return [];
      return [{ ...r, file }];
    } catch {
      return [];
    }
  });
  recs.sort((a, b) => (b.finished_at ?? '').localeCompare(a.finished_at ?? ''));
  const r = recs[0];
  if (!r) return undefined;
  const df = path.join(dir, r.id, 'description.txt');
  return {
    id: r.id,
    file: r.file,
    ...(r.duration_ms ? { duration_ms: r.duration_ms } : {}),
    output_profile: r.output_profile,
    ...(existsSync(df) ? { description: readFileSync(df, 'utf8').trim() } : {}),
  };
}
