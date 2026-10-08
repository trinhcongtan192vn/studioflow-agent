import type { PlanItem, PlatformPublish } from '../contracts/types.js';
import type { WriteStore } from '../store/writer.js';

/** Nền tảng đăng (`publish.platforms`, D3 7.2). */
export type Platform = 'youtube' | 'tiktok' | 'facebook';

/** Bản render phát hành dùng để đăng (`renders/<rd>/video.mp4`). */
export interface ReleaseRender {
  id: string;
  /** Đường dẫn tuyệt đối tới video.mp4. */
  file: string;
  duration_ms?: number;
  output_profile: string;
  /** Nội dung `description.txt` của bản render (mô tả + ghi công), nếu có. */
  description?: string;
}

export interface PublishMeta {
  title: string;
  description: string;
  tags: string[];
  chapters: { start_ms: number; title: string }[];
  /** Ngôn ngữ kênh. */
  language: string;
}

/** Mục được đăng: mục kế hoạch Autopilot, hoặc video làm tay (091: `id` = ID video, không giờ hẹn). */
export type PublishItem =
  | Pick<PlanItem, 'id' | 'title' | 'publish_at'>
  | {
      id: string;
      title: string;
      publish_at: null;
    };

/** Ngữ cảnh một lần đăng một mục lên một nền tảng. */
export interface PublishContext {
  channel: string;
  channel_id: string;
  channel_name: string;
  store: WriteStore;
  /** Ngày kế hoạch (Autopilot); video làm tay: chuỗi rỗng. */
  date: string;
  item: PublishItem;
  /**
   * `scheduled` (Autopilot 053/056): hẹn giờ + cửa sổ phản đối. `now` (091, video làm tay): đăng ngay — công khai
   * nếu API cho phép, không hẹn giờ.
   */
  mode: 'scheduled' | 'now';
  video: string;
  render: ReleaseRender;
  meta: PublishMeta;
  now: Date;
  /** Trạng thái hiện có của nền tảng này (nếu có). */
  prev?: PlatformPublish;
  /** Ghi trạng thái trung gian vào kế hoạch (ví dụ đã có `video_id` ngay sau khi tải lên). */
  patch: (s: PlatformPublish) => void;
  /** Giờ phản đối (`publish.veto_hours`). */
  veto_hours: number;
}

/**
 * Giao diện chung cho bộ đăng từng nền tảng (053 YouTube, 056 TikTok/Facebook): `PublishService` lo hàng đợi,
 * thử lại, ghi trạng thái vào kế hoạch, nhật ký vận hành, xem trước Telegram; bộ đăng chỉ làm việc với nền tảng.
 */
export interface PlatformPublisher {
  readonly platform: Platform;
  readonly label: string;
  /** Kênh đã kết nối nền tảng chưa (có token). */
  connected(ctx: { channel: string; channel_id: string }): Promise<boolean>;
  /** Mục này đăng được lên nền tảng không (ví dụ chỉ video dọc 9:16)? Không → lý do tiếng Việt. */
  eligible(ctx: PublishContext): { ok: true } | { ok: false; reason: string };
  /**
   * Chưa tới giờ thì chưa tải lên (nền tảng không hẹn giờ được, ví dụ TikTok đã kiểm duyệt: chỉ đăng công khai
   * đúng giờ). Trả `undefined` = tải ngay.
   */
  due?(ctx: PublishContext): Date | undefined;
  /** Tải lên; ném `SfError` khi lỗi (dịch vụ ghi `failed` + đếm lần thử). */
  upload(ctx: PublishContext): Promise<PlatformPublish>;
  /** Hủy đăng: video ở lại riêng tư/không công khai. */
  cancel?(ctx: PublishContext, st: PlatformPublish): Promise<PlatformPublish>;
  /** Đăng ngay; `note` giải thích khi không làm được (ví dụ API chưa kiểm duyệt). */
  publishNow?(
    ctx: PublishContext,
    st: PlatformPublish,
  ): Promise<{ state: PlatformPublish; note?: string }>;
  /** Cập nhật trạng thái thật (ví dụ `scheduled` → `public` khi đã tới giờ). */
  refresh?(ctx: PublishContext, st: PlatformPublish): Promise<PlatformPublish>;
}

/** Tin xem trước gửi Telegram sau khi tải lên (kèm nút Hủy đăng / Đăng ngay). */
export interface PreviewMessage {
  text: string;
  photo?: { bytes: Uint8Array; filename: string };
  buttons: { text: string; data: string }[][];
}
export interface PreviewPort {
  send(m: PreviewMessage): Promise<void>;
}
