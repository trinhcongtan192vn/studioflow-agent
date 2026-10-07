import type { DailyPlan, DailyReport, PlanItemStatus, PublishStatus } from '../contracts/types.js';
import { escapeHtml } from '../telegram/client.js';
import type { ChannelDay } from './metrics-db.js';

/** Soạn báo cáo ngày (054, FR-AP-11): hàm thuần từ số liệu + kế hoạch → đối tượng có cấu trúc + tin Telegram (HTML). */
export const REPORT_CONSTANTS = { TOP_VIDEOS: 3, LIST_MAX: 5, AVG_DAYS: 7 } as const;
const C = REPORT_CONSTANTS;

export interface ReportInput {
  channel_id: string;
  channel_name: string;
  /** Ngày báo cáo theo `publish.timezone` của kênh. */
  date: string;
  now: Date;
  connected: boolean;
  /** Số liệu kênh theo ngày (đã thu), nhiều ngày gần nhất. */
  days: ChannelDay[];
  /** Tổng lượt xem 7 ngày gần nhất của các video do app đăng. */
  video_views: { video_ref: string; views: number }[];
  plan: DailyPlan | undefined;
  claude: { used_tokens: number; budget_tokens: number | null };
  quota: { used: number; limit: number };
  max_per_day: number;
  /** Lỗi khi thu số liệu (nếu có). */
  fetch_error?: string;
  /** Thời gian thu số liệu gần nhất. */
  fetched_at?: string;
}

const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};
const pct = (now: number, base: number | undefined): number | undefined =>
  base && base > 0 ? Math.round(((now - base) / base) * 1000) / 10 : undefined;

const COUNTED: PlanItemStatus[] = [
  'produced',
  'in_production',
  'needs_review',
  'failed',
  'planned',
];

export function composeReport(i: ReportInput): DailyReport {
  const notes: string[] = [];
  const byDay = new Map(i.days.map((d) => [d.day, d]));
  const latest = [...byDay.keys()].sort().at(-1);
  const yt: DailyReport['youtube'] = { connected: i.connected, top_videos: [] };
  if (!i.connected) notes.push('Kênh chưa kết nối YouTube nên chưa có số liệu hiệu quả.');
  else if (i.fetch_error) notes.push(`Thu số liệu YouTube lỗi: ${i.fetch_error}`);
  if (i.connected && latest) {
    const cur = byDay.get(latest)!;
    const prev = byDay.get(addDays(latest, -1));
    const window = Array.from({ length: C.AVG_DAYS }, (_, k) =>
      byDay.get(addDays(latest, -1 - k)),
    ).filter((d): d is ChannelDay => Boolean(d));
    const avg7 = window.length
      ? Math.round(window.reduce((s, d) => s + d.views, 0) / window.length)
      : undefined;
    Object.assign(yt, {
      metrics_day: latest,
      views: cur.views,
      ...(prev ? { views_prev: prev.views } : {}),
      ...(avg7 !== undefined ? { views_avg7: avg7 } : {}),
      ...(pct(cur.views, prev?.views) !== undefined
        ? { views_change_pct: pct(cur.views, prev?.views) }
        : {}),
      ...(pct(cur.views, avg7) !== undefined
        ? { views_change_avg7_pct: pct(cur.views, avg7) }
        : {}),
      watch_minutes: Math.round(cur.minutes_watched),
      ...(cur.avg_view_duration_s !== null
        ? { avg_view_duration_s: Math.round(cur.avg_view_duration_s) }
        : {}),
      subs_gained: cur.subs_gained,
      subs_lost: cur.subs_lost,
      likes: cur.likes,
    });
    if (latest < addDays(i.date, -3))
      notes.push(`Số liệu YouTube mới nhất là ngày ${latest} (YouTube thường trễ 1–3 ngày).`);
  } else if (i.connected && !i.fetch_error) {
    notes.push('Chưa có số liệu YouTube (video mới đăng thường mất 1–3 ngày mới có số liệu).');
  }

  const items = i.plan?.items ?? [];
  // video do app đăng: tên và đường dẫn theo ID video trên nền tảng
  const byRef = new Map(
    items.flatMap((it) =>
      it.publish?.youtube?.video_id ? [[it.publish.youtube.video_id, it] as const] : [],
    ),
  );
  yt.top_videos = i.video_views
    .filter((v) => v.views > 0)
    .slice(0, C.TOP_VIDEOS)
    .map((v) => {
      const it = byRef.get(v.video_ref);
      return {
        title: it?.title ?? v.video_ref,
        url: `https://youtu.be/${v.video_ref}`,
        views: v.views,
        ...(it ? { item_id: it.id } : {}),
      };
    });

  const count = (s: PlanItemStatus) => items.filter((x) => x.status === s).length;
  const production: DailyReport['production'] = {
    produced: count('produced'),
    in_production: count('in_production'),
    needs_review: count('needs_review'),
    failed: count('failed'),
    planned: count('planned'),
    items: items
      .filter((x) => COUNTED.includes(x.status) && x.status !== 'planned')
      .map((x) => ({ title: x.title, status: x.status, ...(x.note ? { note: x.note } : {}) })),
  };

  const uploaded: DailyReport['publishing']['uploaded'] = [];
  const waiting: DailyReport['publishing']['waiting'] = [];
  for (const it of items) {
    const st = it.publish?.youtube;
    if (!st) {
      if (it.status === 'produced')
        waiting.push({ title: it.title, status: 'pending' as PublishStatus, note: 'chưa đăng' });
      continue;
    }
    if (st.video_id && ['scheduled', 'private', 'public'].includes(st.status))
      uploaded.push({
        title: it.title,
        status: st.status,
        ...(st.url ? { url: st.url } : {}),
        ...(st.publish_at ? { publish_at: st.publish_at } : {}),
      });
    else if (st.status === 'pending' || st.status === 'failed' || st.status === 'uploading')
      waiting.push({ title: it.title, status: st.status, ...(st.error ? { note: st.error } : {}) });
  }

  const budget = i.claude.budget_tokens;
  const left = production.planned;
  return {
    schema_version: 1,
    channel_id: i.channel_id as DailyReport['channel_id'],
    channel_name: i.channel_name,
    date: i.date,
    generated_at: i.now.toISOString(),
    youtube: yt,
    production,
    publishing: { uploaded, waiting },
    claude: {
      used_tokens: Math.round(i.claude.used_tokens),
      budget_tokens: budget === null ? null : Math.round(budget),
      used_pct: budget && budget > 0 ? Math.round((i.claude.used_tokens / budget) * 100) : null,
    },
    quota: { youtube_used: i.quota.used, youtube_limit: i.quota.limit },
    tomorrow:
      `Ngày mai: kế hoạch mới lập khi mở app (tối đa ${i.max_per_day} video/ngày)` +
      (left ? `; ${left} mục chưa làm hôm nay sẽ được chuyển sang.` : '.'),
    notes,
  };
}

// ---------- tin nhắn ----------

const nf = new Intl.NumberFormat('vi-VN');
const n1 = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const arrow = (p: number | undefined, vs: string) =>
  p === undefined ? '' : `${p >= 0 ? '↑' : '↓'} ${n1(Math.abs(p))}% so với ${vs}`;
const e = escapeHtml;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const tokens = (t: number) =>
  t >= 1_000_000 ? `${n1(t / 1_000_000)}M` : t >= 1000 ? `${n1(t / 1000)}K` : String(t);
const hhmm = (iso: string, tz?: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    ...(tz ? { timeZone: tz } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

/** Tin Telegram (HTML) của một kênh — tiếng Việt, ngắn gọn. */
export function formatReportHtml(r: DailyReport, tz?: string): string {
  const L: string[] = [];
  L.push(`📊 <b>${e(r.channel_name)}</b> — báo cáo ${dm(r.date)}`);
  const y = r.youtube;
  if (!y.connected) L.push('▶️ YouTube: chưa kết nối — kết nối trong Cài đặt kênh để xem số liệu.');
  else if (y.views === undefined) L.push('▶️ YouTube: chưa có số liệu.');
  else {
    const ch = [
      arrow(y.views_change_pct, 'hôm trước'),
      arrow(y.views_change_avg7_pct, 'trung bình 7 ngày'),
    ]
      .filter(Boolean)
      .join(', ');
    L.push(
      `▶️ YouTube (ngày ${dm(y.metrics_day!)}): <b>${nf.format(y.views)}</b> lượt xem${ch ? ` (${ch})` : ''}`,
    );
    const more = [
      y.watch_minutes !== undefined ? `${n1((y.watch_minutes ?? 0) / 60)} giờ xem` : '',
      y.subs_gained !== undefined
        ? `+${nf.format(y.subs_gained)}/−${nf.format(y.subs_lost ?? 0)} người đăng ký`
        : '',
      y.likes !== undefined ? `${nf.format(y.likes)} thích` : '',
      y.avg_view_duration_s !== undefined ? `xem trung bình ${y.avg_view_duration_s} giây` : '',
    ].filter(Boolean);
    if (more.length) L.push(`   ${more.join(' · ')}`);
  }
  if (y.top_videos.length) {
    L.push('🏆 Video nổi bật 7 ngày:');
    y.top_videos.forEach((v, k) =>
      L.push(
        `   ${k + 1}. “${e(clip(v.title, 70))}” — ${nf.format(v.views)} lượt${v.url ? ` · ${e(v.url)}` : ''}`,
      ),
    );
  }
  const p = r.production;
  L.push(
    `🎬 Sản xuất hôm nay: ✅ ${p.produced} xong · ⚠️ ${p.needs_review} cần bạn xem · ❌ ${p.failed} hỏng · 🎬 ${p.in_production} đang làm · 🕒 ${p.planned} chờ làm`,
  );
  for (const it of p.items
    .filter((x) => x.status === 'needs_review' || x.status === 'failed')
    .slice(0, C.LIST_MAX))
    L.push(
      `   ${it.status === 'failed' ? '❌' : '⚠️'} “${e(clip(it.title, 60))}”${it.note ? `: ${e(clip(it.note, 120))}` : ''}`,
    );
  const pub = r.publishing;
  if (pub.uploaded.length || pub.waiting.length) {
    L.push('📤 Đăng bài:');
    for (const u of pub.uploaded.slice(0, C.LIST_MAX)) {
      const how =
        u.status === 'scheduled' && u.publish_at
          ? `hẹn công khai ${hhmm(u.publish_at, tz)}`
          : u.status === 'public'
            ? 'đã công khai'
            : 'riêng tư — chờ bạn công khai';
      L.push(`   • “${e(clip(u.title, 60))}” — ${how}`);
    }
    for (const w of pub.waiting.slice(0, C.LIST_MAX))
      L.push(
        `   • “${e(clip(w.title, 60))}” — ${w.status === 'failed' ? 'lỗi' : 'chờ đăng'}${w.note ? `: ${e(clip(w.note, 100))}` : ''}`,
      );
  }
  const c = r.claude;
  L.push(
    c.budget_tokens === null
      ? `🤖 Claude: đã dùng ${tokens(c.used_tokens)} token (chưa biết ngân sách ngày)`
      : `🤖 Claude: ${tokens(c.used_tokens)} / ${tokens(c.budget_tokens)} token (${c.used_pct ?? 0}% ngân sách Autopilot)`,
  );
  L.push(
    `🔑 Quota YouTube: ${nf.format(r.quota.youtube_used)} / ${nf.format(r.quota.youtube_limit)} đơn vị`,
  );
  L.push(`📅 ${e(r.tomorrow)}`);
  for (const n of r.notes) L.push(`ℹ️ ${e(n)}`);
  return L.join('\n');
}
