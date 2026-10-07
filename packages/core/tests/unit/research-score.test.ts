// 049 · FR-AP-04 — chấm điểm chủ đề (thuần): vượt trội so với trung vị đối thủ, tốc độ, độ mới, khớp chủ
// đề trụ cột (gập dấu vi/de/en), độ mới so với video đã làm (Jaccard; gần trùng bị trừ). Hằng số: FN-049.
import { describe, expect, it } from 'vitest';
import {
  bestPillar,
  competitorCandidates,
  foldText,
  jaccard,
  median,
  newsCandidates,
  rankCandidates,
  RESEARCH_CONSTANTS,
  tokenize,
  trendCandidates,
  trendingCandidates,
  type ScoreContext,
} from '../../src/research/score.js';
import type { VideoStats } from '../../src/youtube/data-api.js';

const NOW = new Date('2026-10-07T03:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);
const ctx = (over: Partial<ScoreContext> = {}): ScoreContext => ({
  now: NOW,
  pillars: ['lịch sử Việt Nam', 'nhà Trần'],
  ownTitles: ['Năm 1428: Lê Lợi lên ngôi'],
  ...over,
});
let n = 0;
const video = (
  title: string,
  published_at: string,
  views: number,
  over: Partial<VideoStats> = {},
) =>
  ({
    video_id: `vid${String(++n).padStart(8, '0')}`,
    title,
    tags: [],
    channel_id: 'UCaaaaaaaaaaaaaaaaaaaaa1',
    channel_title: 'Sử Kể Mẫu',
    published_at,
    views,
    ...over,
  }) satisfies VideoStats;

describe('text matching', () => {
  it('folds Vietnamese / German diacritics', () => {
    expect(foldText('Lịch Sử Đại Việt')).toBe('lich su dai viet');
    expect(foldText('Größe für Bäume')).toBe('grosse fur baume');
  });
  it('tokenizes without stopwords or 1-letter tokens, unique', () => {
    expect(tokenize('Lê Lợi và năm 1428 — của Lê Lợi')).toEqual(['le', 'loi', 'nam', '1428']);
    expect(tokenize('Warum der Mensch und die Angst')).toEqual(['mensch', 'angst']);
    expect(tokenize('How the Roman Empire fell')).toEqual(['roman', 'empire', 'fell']);
  });
  it('jaccard on token sets', () => {
    expect(jaccard(['a1', 'b1'], ['a1', 'b1'])).toBe(1);
    expect(jaccard(['a1', 'b1'], ['c1'])).toBe(0);
    expect(jaccard(['a1', 'b1', 'c1'], ['a1', 'b1', 'd1'])).toBeCloseTo(0.5);
    expect(jaccard([], [])).toBe(0);
  });
  it('best pillar match ignores diacritics/case', () => {
    expect(bestPillar('LICH SU viet nam qua 4000 nam', ['nhà Trần', 'lịch sử Việt Nam'])).toEqual({
      pillar: 'lịch sử Việt Nam',
      ratio: 1,
      hit: 4,
      total: 4,
    });
    expect(bestPillar('Trần Hưng Đạo', ['nhà Trần'])).toMatchObject({ ratio: 0.5 });
    expect(bestPillar('bóng đá', ['nhà Trần'])).toBeUndefined();
    expect(bestPillar('x', [])).toBeUndefined();
  });
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('competitor candidates', () => {
  const mature = [20_000, 18_000, 22_000, 19_000, 21_000].map((v, i) =>
    video(`Video cũ số ${i}`, daysAgo(40 + i * 20), v),
  );

  it('outlier ratio vs the channel median; young videos compared to age-scaled median', () => {
    const fresh = video('Trận Bạch Đằng: nhà Trần đánh tan quân Nguyên', hoursAgo(48), 90_000);
    const c = competitorCandidates([...mature, fresh], ctx());
    const f = c.find((x) => x.id === `yt:${fresh.video_id}`)!;
    expect(f.kind).toBe('competitor');
    // trung vị 20 000; 48 giờ → 20 000 × 48/168 ≈ 5 714 → gấp ~15,75
    expect(f.metrics!.outlier_ratio).toBeCloseTo(15.75, 1);
    expect(f.pillar).toBe('nhà Trần');
    expect(f.score).toBeGreaterThan(80);
    expect(f.reasons.join(' ')).toMatch(/Gấp 15,8× lượt xem trung vị.*Sử Kể Mẫu/);
    expect(f.reasons.join(' ')).toMatch(/Khớp chủ đề trụ cột "nhà Trần"/);
    expect(f.url).toBe(`https://www.youtube.com/watch?v=${fresh.video_id}`);
    expect(f.source_channel).toEqual({ id: 'UCaaaaaaaaaaaaaaaaaaaaa1', title: 'Sử Kể Mẫu' });
    // video cũ bình thường (≈1×) không phải ứng viên
    expect(c.filter((x) => x.kind === 'competitor_evergreen')).toEqual([]);
    expect(c).toHaveLength(1);
  });

  it('old outliers become evergreen candidates (≥ 30 days, ≥ 2× median)', () => {
    const old = video('Bí ẩn lăng mộ vua Quang Trung', daysAgo(220), 200_000);
    const mid = video('Video 20 ngày', daysAgo(20), 100_000); // giữa 14 và 30 ngày → bỏ
    const c = competitorCandidates([...mature, old, mid], ctx());
    expect(c.map((x) => x.kind)).toEqual(['competitor_evergreen']);
    expect(c[0]!.reasons.join(' ')).toMatch(/Video cũ nổi bật/);
    expect(c[0]!.reasons.join(' ')).toMatch(/Không khớp rõ chủ đề trụ cột/);
  });

  it('near-duplicates of the channel’s own videos are penalised', () => {
    const dup = video('Năm 1428: Lê Lợi lên ngôi hoàng đế', hoursAgo(24), 5000);
    const fresh = video('Năm 1789: Quang Trung đại phá quân Thanh', hoursAgo(24), 5000);
    const c = competitorCandidates([...mature, dup, fresh], ctx());
    const d = c.find((x) => x.id === `yt:${dup.video_id}`)!;
    const f = c.find((x) => x.id === `yt:${fresh.video_id}`)!;
    expect(d.metrics!.similarity).toBeGreaterThanOrEqual(RESEARCH_CONSTANTS.DUP_SIMILARITY);
    expect(d.reasons.join(' ')).toMatch(/Gần trùng video đã làm "Năm 1428: Lê Lợi lên ngôi"/);
    expect(d.score).toBeLessThan(f.score - 30);
    expect(f.reasons.join(' ')).toMatch(/Kênh chưa làm chủ đề này/);
  });

  it('few mature videos → median over all videos; scores stay in 0–100', () => {
    const vids = [
      video('Nhà Trần và ba lần kháng chiến', hoursAgo(10), 3000),
      video('Chuyện làng quê', daysAgo(36), 1000),
      video('Ẩm thực cung đình', daysAgo(67), 1500),
    ];
    const c = competitorCandidates(vids, ctx({ ownTitles: [] }));
    expect(c).toHaveLength(1);
    expect(c[0]!.metrics!.outlier_ratio).toBe(20); // 3000 / (1500 × sàn 0,1)
    expect(c[0]!.score).toBeLessThanOrEqual(100);
    expect(c[0]!.reasons.join(' ')).toMatch(/Kênh chưa có video nào để so trùng/);
    expect(competitorCandidates([], ctx())).toEqual([]);
  });
});

describe('trending / trends / news candidates', () => {
  it('trending: velocity, kept only when matching a pillar (tags count)', () => {
    const vids = [
      video('Trực tiếp bóng đá: Hà Nội FC vs Hải Phòng', hoursAgo(4), 800_000),
      video('Sự thật ít ai biết', hoursAgo(20), 500_000, { tags: ['lịch sử Việt Nam'] }),
    ];
    const c = trendingCandidates(vids, 'VN', ctx());
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: 'trending', pillar: 'lịch sử Việt Nam' });
    expect(c[0]!.metrics!.views_per_hour).toBe(25_000);
    expect(c[0]!.reasons.join(' ')).toMatch(/Đang trending ở VN: 25\.000 lượt xem\/giờ/);
    // chưa khai chủ đề trụ cột → giữ hết, không điểm khớp
    const all = trendingCandidates(vids, 'VN', ctx({ pillars: [] }));
    expect(all).toHaveLength(2);
    expect(all[0]!.reasons.join(' ')).toMatch(/Kênh chưa khai chủ đề trụ cột/);
  });

  it('Google Trends: traffic + attached news titles count for the pillar match', () => {
    const items = [
      { title: 'giá vàng hôm nay', traffic: 500_000, published_at: hoursAgo(2), news: [] },
      {
        title: 'Trần Hưng Đạo',
        traffic: 20_000,
        published_at: hoursAgo(5),
        news: [{ title: 'Lễ giỗ Đức Thánh Trần tại đền Kiếp Bạc' }],
      },
    ];
    const c = trendCandidates(items, 'VN', ctx());
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ id: 'trend:tran hung dao', kind: 'trend', pillar: 'nhà Trần' });
    expect(c[0]!.metrics!.traffic).toBe(20_000);
    expect(c[0]!.reasons.join(' ')).toMatch(/Google Trends VN: ~20\.000\+ lượt tìm/);
  });

  it('news: recent items only, pillar floor for its own query, id from link hash', () => {
    const items = [
      {
        title: 'Phát hiện bảo vật ở Hoàng thành',
        link: 'https://news.example/a',
        source: 'Báo Mẫu',
        published_at: daysAgo(2),
        news: [],
      },
      { title: 'Tin cũ', link: 'https://news.example/b', published_at: daysAgo(20), news: [] },
    ];
    const c = newsCandidates(items, 'lịch sử Việt Nam', ctx());
    expect(c).toHaveLength(1);
    expect(c[0]!.id).toMatch(/^news:[0-9a-f]{12}$/);
    expect(c[0]).toMatchObject({
      kind: 'news',
      pillar: 'lịch sử Việt Nam',
      url: 'https://news.example/a',
    });
    expect(c[0]!.reasons.join(' ')).toMatch(/Tin nóng trên Google News \(Báo Mẫu\)/);
  });

  it('rank: dedupe by id keeping the higher score, sort desc, cap', () => {
    const base = { title: 't', reasons: ['r'] };
    const r = rankCandidates(
      [
        { ...base, id: 'yt:1', kind: 'trending', score: 40 },
        { ...base, id: 'yt:1', kind: 'competitor', score: 70 },
        { ...base, id: 'yt:2', kind: 'competitor', score: 50 },
        { ...base, id: 'yt:3', kind: 'competitor', score: 10 },
      ],
      2,
    );
    expect(r.map((x) => [x.id, x.kind])).toEqual([
      ['yt:1', 'competitor'],
      ['yt:2', 'competitor'],
    ]);
  });
});
