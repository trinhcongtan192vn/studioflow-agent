import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { planDates, readPlan } from '../autopilot/plan.js';
import type { PlanItem, PlatformPublish, PublishState } from '../contracts/types.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { videoCard } from '../domain/video-card.js';
import { findReleaseRender } from './youtube.js';

/**
 * 074 — màn Duyệt trước khi đăng: mục Autopilot đã làm xong (`produced`) trong các kế hoạch gần đây, trạng thái
 * đăng từng nền tảng, bản render phát hành và thông tin đăng (`publish.md`). Chỉ đọc.
 */
export type PublishStage = 'pending' | 'published' | 'stopped';

export interface PublishQueueItem {
  date: string;
  item_id: string;
  title: string;
  video_id: string;
  publish_at: string | null;
  platforms: string[];
  publish: PublishState;
  /** `pending` còn việc (chờ tải / chờ phản đối / lỗi thử lại được), `published` đã lên nền tảng, `stopped` hủy / lỗi hẳn. */
  stage: PublishStage;
  format: 'vertical' | 'horizontal' | null;
  thumbnail?: string;
  render?: { file: string; duration_ms?: number };
  meta?: { title: string; description: string; tags: string[]; chapters: number };
}

const DONE = new Set<PlatformPublish['status']>(['public', 'private', 'scheduled']);

function stageOf(item: PlanItem, now: number): PublishStage {
  const states = item.platforms.map(
    (p) => item.publish?.[p as keyof PublishState] as PlatformPublish | undefined,
  );
  const live = (s: PlatformPublish | undefined) =>
    s && (s.status === 'public' || s.status === 'private');
  const open = (s: PlatformPublish | undefined) =>
    !s ||
    // 078: nền tảng chưa kết nối (`pending` kèm lỗi) không giữ video ở "Chờ đăng" mãi
    (s.status === 'pending' && !s.error) ||
    s.status === 'uploading' ||
    (s.status === 'scheduled' && Boolean(s.veto_until) && Date.parse(s.veto_until!) > now) ||
    (s.status === 'failed' && (s.attempts ?? 0) < 3);
  if (states.some(open)) return 'pending';
  if (states.some((s) => live(s) || (s && DONE.has(s.status)))) return 'published';
  return 'stopped';
}

function metaOf(vdir: string): PublishQueueItem['meta'] {
  const f = path.join(vdir, 'publish.md');
  if (!existsSync(f)) return undefined;
  try {
    const b = parseBlocksDoc(readFileSync(f, 'utf8'));
    return {
      title: String(b.front.title ?? ''),
      description: b.body.join('\n').trim(),
      tags: Array.isArray(b.front.tags) ? (b.front.tags as unknown[]).map(String) : [],
      chapters: Array.isArray(b.front.chapters) ? b.front.chapters.length : 0,
    };
  } catch {
    return undefined;
  }
}

/** Mục đã làm xong của kênh trong `days` kế hoạch gần nhất, mới nhất trước. */
export function publishQueue(
  channel: string,
  o: { now?: Date; days?: number } = {},
): PublishQueueItem[] {
  const now = (o.now ?? new Date()).getTime();
  const out: PublishQueueItem[] = [];
  for (const date of planDates(channel).slice(0, o.days ?? 14))
    for (const item of readPlan(channel, date)?.items ?? []) {
      if (item.status !== 'produced' || !item.video_id) continue;
      const vdir = path.join(channel, 'videos', item.video_id);
      const card = existsSync(vdir)
        ? videoCard(channel, item.video_id, () => undefined)
        : undefined;
      const r = existsSync(vdir) ? findReleaseRender(channel, item.video_id) : undefined;
      const meta = metaOf(vdir);
      out.push({
        date,
        item_id: item.id,
        title: meta?.title || item.title,
        video_id: item.video_id,
        publish_at: item.publish_at,
        platforms: item.platforms,
        publish: item.publish ?? {},
        stage: stageOf(item, now),
        format: card?.format ?? null,
        ...(card?.thumbnail ? { thumbnail: card.thumbnail } : {}),
        ...(r
          ? { render: { file: r.file, ...(r.duration_ms ? { duration_ms: r.duration_ms } : {}) } }
          : {}),
        ...(meta ? { meta } : {}),
      });
    }
  return out;
}
