import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfig } from '../config/resolve.js';
import type { PlatformPublish, PublishRecord } from '../contracts/types.js';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';
import type { StepExecutor, StepRunContext } from '../workflow/engine.js';
import { loadPublishMeta, type PublishService } from './service.js';
import type { Platform, PlatformPublisher, PublishContext, ReleaseRender } from './types.js';
import { findReleaseRender } from './youtube.js';

/**
 * Bước `publish` của video làm tay (091, D6 mục 2): người dùng chọn nền tảng ở bộ chọn (`publish.video.start`),
 * bước đăng ngay bản render phát hành mới nhất lên từng nền tảng bằng bộ đăng 053/056 ở chế độ `now`; trạng thái
 * ở `publish-state.json` (D3 5.22). Video Autopilot không dùng bước này (kế hoạch ngày lo việc đăng).
 */

/** Đuôi lỗi khi bước chờ người dùng chọn nền tảng (giao diện hiện bộ chọn thay cho lỗi, như 083). */
export const PUBLISH_CHOOSE = 'waiting for you to choose where to publish';

const ORDER: Platform[] = ['youtube', 'tiktok', 'facebook'];
/** Đã lên nền tảng cho bản render này — chạy lại bước không tải lại. */
const PUBLISHED = new Set<PlatformPublish['status']>(['public', 'private', 'scheduled']);

export interface PublishOption {
  platform: Platform;
  label: string;
  connected: boolean;
  eligible: boolean;
  reason?: string;
  checked: boolean;
  state?: PlatformPublish;
}

export interface PublishOptions {
  render: { id: string; output_profile: string } | null;
  meta: { title: string; description: string; tags: string[] };
  platforms: PublishOption[];
  requested_at: string | null;
}

const rel = (video: string) => `videos/${video}/publish-state.json`;

function channelMeta(channel: string): { id: string; name: string; language: string } {
  const c = JSON.parse(readFileSync(path.join(channel, 'channel.json'), 'utf8')) as {
    id: string;
    name?: string;
    language?: string;
  };
  return { id: c.id, name: c.name ?? path.basename(channel), language: c.language ?? 'vi' };
}

export class VideoPublish {
  constructor(
    private readonly d: {
      appDataDir: string;
      publish: PublishService;
      clock?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.d.clock?.() ?? new Date();
  }

  read(store: WriteStore, video: string): PublishRecord | undefined {
    try {
      return JSON.parse(readFileSync(store.abs(rel(video)), 'utf8')) as PublishRecord;
    } catch {
      return undefined;
    }
  }

  private write(store: WriteStore, rec: PublishRecord): void {
    store.write(rel(rec.video_id), `${JSON.stringify(rec, null, 2)}\n`, { by: 'step.publish' });
  }

  private publishers(): PlatformPublisher[] {
    return ORDER.flatMap((p) => {
      const x = this.d.publish.publisher(p);
      return x ? [x] : [];
    });
  }

  private context(
    store: WriteStore,
    video: string,
    render: ReleaseRender,
    prev: PlatformPublish | undefined,
    patch: (s: PlatformPublish) => void,
  ): PublishContext {
    const channel = store.root;
    const m = channelMeta(channel);
    const meta = loadPublishMeta(channel, video, video, m.language);
    return {
      channel,
      channel_id: m.id,
      channel_name: m.name,
      store,
      date: '',
      item: { id: video, title: meta.title, publish_at: null },
      mode: 'now',
      video,
      render,
      meta,
      now: this.now(),
      ...(prev ? { prev } : {}),
      patch,
      veto_hours: 0,
    };
  }

  /** Bộ chọn nền tảng: kết nối, phù hợp (video dọc…), tích sẵn, trạng thái đã đăng của bản render hiện tại. */
  async options(store: WriteStore, video: string): Promise<PublishOptions> {
    const channel = store.root;
    const m = channelMeta(channel);
    const render = findReleaseRender(channel, video);
    const meta = loadPublishMeta(channel, video, video, m.language);
    const rec = this.read(store, video);
    const same = Boolean(render && rec?.render_id === render.id);
    const wanted = new Set(
      same && rec?.requested_at
        ? rec.platforms
        : resolveConfig<string[]>(
            'publish.platforms',
            { channelDir: channel, videoId: video },
            { appDataDir: this.d.appDataDir },
          ).value,
    );
    const platforms: PublishOption[] = [];
    for (const p of this.publishers()) {
      const connected = await p.connected({ channel, channel_id: m.id });
      const el = render
        ? p.eligible(this.context(store, video, render, undefined, () => {}))
        : ({ ok: false, reason: 'chưa có bản render phát hành' } as const);
      const state = same ? rec?.results[p.platform] : undefined;
      platforms.push({
        platform: p.platform,
        label: p.label,
        connected,
        eligible: el.ok,
        ...(el.ok ? {} : { reason: el.reason }),
        checked: connected && el.ok && wanted.has(p.platform),
        ...(state ? { state } : {}),
      });
    }
    return {
      render: render ? { id: render.id, output_profile: render.output_profile } : null,
      meta: {
        title: meta.title,
        description: render?.description ?? meta.description,
        tags: meta.tags,
      },
      platforms,
      requested_at: same ? (rec?.requested_at ?? null) : null,
    };
  }

  /** Ghi lựa chọn của người dùng (rỗng = không đăng). Bản render đổi → bỏ trạng thái cũ. */
  request(store: WriteStore, video: string, platforms: string[]): void {
    const known = new Set(this.publishers().map((p) => p.platform as string));
    const bad = platforms.filter((p) => !known.has(p));
    if (bad.length)
      throw new SfError('E_SCHEMA_INVALID', `nền tảng không hỗ trợ: ${bad.join(', ')}`);
    const render = findReleaseRender(store.root, video);
    if (!render)
      throw new SfError(
        'E_FILE_NOT_FOUND',
        'chưa có bản render phát hành (release) của video để đăng — chạy bước Render phát hành trước',
      );
    const prev = this.read(store, video);
    this.write(store, {
      schema_version: 1,
      video_id: video as PublishRecord['video_id'],
      render_id: render.id,
      requested_at: this.now().toISOString() as PublishRecord['requested_at'],
      platforms: ORDER.filter((p) => platforms.includes(p)),
      results: prev?.render_id === render.id ? prev.results : {},
    });
  }

  /** Executor bước `publish`. */
  executor(): StepExecutor {
    return (ctx) => this.run(ctx);
  }

  private async run(ctx: StepRunContext): Promise<{ outputs: string[]; summary: string }> {
    const { store, videoId: video } = ctx;
    const st = JSON.parse(readFileSync(store.abs(`videos/${video}/state.json`), 'utf8')) as {
      autopilot?: unknown;
    };
    if (st.autopilot)
      return {
        outputs: [],
        summary:
          'Video Autopilot: đăng theo kế hoạch ngày (giờ đăng, giờ chờ hủy) — bước này bỏ qua.',
      };
    const rec = this.read(store, video);
    if (!rec?.requested_at)
      throw new SfError(
        'E_STEP_INCOMPLETE',
        `choose the platforms in the Progress tab and press "Đăng" — ${PUBLISH_CHOOSE}`,
      );
    if (!rec.platforms.length) return { outputs: [], summary: 'Không đăng lên nền tảng nào.' };
    const render = findReleaseRender(store.root, video);
    if (!render)
      throw new SfError('E_FILE_NOT_FOUND', 'chưa có bản render phát hành (release) để đăng');
    if (rec.render_id !== render.id) {
      rec.render_id = render.id;
      rec.results = {};
    }
    const m = channelMeta(store.root);
    const save = (p: Platform, s: PlatformPublish) => {
      rec.results = { ...rec.results, [p]: s };
      this.write(store, rec);
    };
    const failed: string[] = [];
    const done: string[] = [];
    const list = rec.platforms as Platform[];
    for (const [i, platform] of list.entries()) {
      const p = this.d.publish.publisher(platform);
      const prev = rec.results[platform];
      const label = p?.label ?? platform;
      if (prev && PUBLISHED.has(prev.status)) {
        done.push(`${label} (${prev.status === 'public' ? 'công khai' : 'riêng tư'})`);
        continue;
      }
      ctx.progress?.(i, list.length, `Đang đăng lên ${label}`);
      const fail = (error: string, attempts?: number) => {
        // giữ ID đã có trên nền tảng (đang tải dở) để lần chạy lại tiếp tục, không tải trùng
        const last = rec.results[platform];
        save(platform, {
          ...(last ?? {}),
          status: 'failed',
          attempts: attempts ?? (last?.attempts ?? 0) + 1,
          error,
        } as PlatformPublish);
        failed.push(`${label}: ${error}`);
      };
      if (!p) {
        fail('app chưa hỗ trợ nền tảng này');
        continue;
      }
      if (!(await p.connected({ channel: store.root, channel_id: m.id }))) {
        fail(`kênh chưa kết nối ${label} — kết nối trong Cài đặt kênh rồi chạy lại bước`);
        continue;
      }
      const attempts = (prev?.attempts ?? 0) + 1;
      const cur: PlatformPublish = { ...(prev ?? {}), status: 'uploading', attempts };
      delete cur.error;
      const pctx = this.context(store, video, render, cur, (s) => save(platform, s));
      const el = p.eligible(pctx);
      if (!el.ok) {
        fail(el.reason);
        continue;
      }
      save(platform, cur);
      try {
        const r = await p.upload(pctx);
        const clean = { ...r, attempts };
        delete clean.error;
        save(platform, clean);
        done.push(`${label} (${clean.status === 'public' ? 'công khai' : 'riêng tư'})`);
      } catch (e) {
        fail(String((e as Error).message ?? e), attempts);
      }
    }
    ctx.progress?.(list.length, list.length);
    if (failed.length)
      throw new SfError(
        'E_PROVIDER_FAILED',
        `${failed.join('; ')}${done.length ? ` (đã đăng: ${done.join(', ')})` : ''} — "Chạy lại bước" chỉ thử lại nền tảng lỗi`,
      );
    return { outputs: ['publish-state.json'], summary: `Đã đăng: ${done.join(', ')}.` };
  }
}
