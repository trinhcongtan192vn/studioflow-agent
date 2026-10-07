// 054 · FR-AP-11 — soạn báo cáo ngày: so với hôm trước / trung bình 7 ngày, video nổi bật, sản xuất, Claude, tin Telegram.
import { describe, expect, it } from 'vitest';
import type { DailyPlan } from '../../src/contracts/types.js';
import { checkReportValue } from '../../src/analytics/reporter.js';
import { composeReport, formatReportHtml, type ReportInput } from '../../src/analytics/report.js';
import type { ChannelDay } from '../../src/analytics/metrics-db.js';

const day = (d: string, views: number): ChannelDay => ({
  day: d,
  views,
  minutes_watched: views / 2,
  avg_view_duration_s: 61.4,
  subs_gained: 5,
  subs_lost: 1,
  likes: 9,
});
const days = [
  day('2026-10-01', 100),
  day('2026-10-02', 100),
  day('2026-10-03', 100),
  day('2026-10-04', 100),
  day('2026-10-05', 100),
  day('2026-10-06', 100),
  day('2026-10-07', 150),
];
const item = (id: string, status: string, extra: object = {}) => ({
  id,
  status,
  candidate_id: `c_${id}`,
  title: `Video ${id}`,
  angle: 'g',
  source: { kind: 'trend' },
  workflow_id: 'narrated-explainer',
  output_profile: 'yt-1080p30',
  publish_at: '2026-10-07T21:00:00+07:00',
  platforms: ['youtube'],
  score: 80,
  reasons: [],
  ...extra,
});
const plan = {
  schema_version: 1,
  channel_id: 'ch_aaaaaaaa',
  date: '2026-10-07',
  generated_at: '2026-10-07T00:00:00Z',
  capacity: { videos: 5, limiting_factor: 'cap', reasons: [] },
  items: [
    item('pi_1', 'produced', {
      publish: {
        youtube: { status: 'scheduled', video_id: 'vid1', publish_at: '2026-10-07T14:00:00Z' },
      },
    }),
    item('pi_2', 'needs_review', { note: 'Cổng chất lượng chưa đạt' }),
    item('pi_3', 'failed', { note: 'Hết dung lượng' }),
    item('pi_4', 'planned'),
  ],
} as unknown as DailyPlan;

const base = (o: Partial<ReportInput> = {}): ReportInput => ({
  channel_id: 'ch_aaaaaaaa',
  channel_name: 'Sử Kể',
  date: '2026-10-07',
  now: new Date('2026-10-07T14:00:00Z'),
  connected: true,
  days,
  video_views: [
    { video_ref: 'vid1', views: 900 },
    { video_ref: 'other', views: 40 },
  ],
  plan,
  claude: { used_tokens: 250_000, budget_tokens: 1_000_000 },
  quota: { used: 1650, limit: 10000 },
  max_per_day: 5,
  ...o,
});

describe('composeReport', () => {
  it('views vs previous day and 7-day average (excluding the day itself)', () => {
    const r = composeReport(base());
    expect(r.youtube).toMatchObject({
      connected: true,
      metrics_day: '2026-10-07',
      views: 150,
      views_prev: 100,
      views_avg7: 100,
      views_change_pct: 50,
      views_change_avg7_pct: 50,
      subs_gained: 5,
      avg_view_duration_s: 61,
    });
  });

  it('top videos map platform ids to plan titles, production counts, claude pct', () => {
    const r = composeReport(base());
    expect(r.youtube.top_videos[0]).toMatchObject({
      title: 'Video pi_1',
      views: 900,
      url: 'https://youtu.be/vid1',
      item_id: 'pi_1',
    });
    expect(r.production).toMatchObject({
      produced: 1,
      needs_review: 1,
      failed: 1,
      in_production: 0,
      planned: 1,
    });
    expect(r.publishing.uploaded).toHaveLength(1);
    expect(r.claude).toEqual({ used_tokens: 250000, budget_tokens: 1000000, used_pct: 25 });
    expect(r.quota).toEqual({ youtube_used: 1650, youtube_limit: 10000 });
    expect(r.tomorrow).toMatch(/1 mục chưa làm/);
  });

  it('not connected → note, no metrics; unknown budget → null pct; no data → note', () => {
    const r = composeReport(
      base({ connected: false, days: [], claude: { used_tokens: 10, budget_tokens: null } }),
    );
    expect(r.youtube.views).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/chưa kết nối YouTube/);
    expect(r.claude.used_pct).toBeNull();
    const n = composeReport(base({ days: [] }));
    expect(n.notes.join(' ')).toMatch(/Chưa có số liệu/);
  });

  it('stale metrics get a note; fetch error is surfaced', () => {
    const r = composeReport(base({ days: [day('2026-10-02', 10)] }));
    expect(r.notes.join(' ')).toMatch(/2026-10-02/);
    expect(composeReport(base({ fetch_error: 'HTTP 403' })).notes.join(' ')).toMatch(/HTTP 403/);
  });
});

describe('formatReportHtml', () => {
  it('Vietnamese Telegram message with arrows, top videos, production, quota; HTML-escaped', () => {
    const r = composeReport(base({ channel_name: 'Sử <Kể>' }));
    const t = formatReportHtml(r, 'Asia/Ho_Chi_Minh');
    expect(t).toContain('📊 <b>Sử &lt;Kể&gt;</b> — báo cáo 07/10');
    expect(t).toContain('<b>150</b> lượt xem');
    expect(t).toContain('↑ 50% so với hôm trước');
    expect(t).toContain('↑ 50% so với trung bình 7 ngày');
    expect(t).toContain('🏆 Video nổi bật');
    expect(t).toContain('✅ 1 xong · ⚠️ 1 cần bạn xem · ❌ 1 hỏng');
    expect(t).toContain('hẹn công khai 21:00');
    expect(t).toContain('1.650 / 10.000');
    expect(t).toContain('25% ngân sách Autopilot');
    expect(t).not.toMatch(/<(?!\/?(b|i|a|code)\b)/);
  });
});

describe('settings validation', () => {
  it('report.time is HH:MM, report.enabled boolean', () => {
    expect(() => checkReportValue('report.time', '21:00')).not.toThrow();
    expect(() => checkReportValue('report.time', '25:00')).toThrow();
    expect(() => checkReportValue('report.time', 'tối')).toThrow();
    expect(() => checkReportValue('report.enabled', 'yes')).toThrow();
    expect(() => checkReportValue('report.enabled', false)).not.toThrow();
  });
});
