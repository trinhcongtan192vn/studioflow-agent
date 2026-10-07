// 051 · FR-AP-06 — kế hoạch ngày Autopilot, phần thuần: chọn ứng viên (xếp hạng, không lặp 14 ngày, đa dạng,
// nghiên cứu rỗng), đếm trần chỉ theo mục Autopilot, chọn workflow/dạng xuất, gán khung giờ đăng (múi giờ,
// khung theo thứ, tràn sang ngày sau, không khung giờ) và lập lại trong ngày giữ mục đã có.
import { describe, expect, it } from 'vitest';
import {
  PLAN_CONSTANTS,
  allowedWorkflows,
  assignPublishSlot,
  buildPlan,
  chooseWorkflow,
  freeSlots,
  planDay,
  selectCandidates,
  type BuildPlanInput,
  type PlanWorkflow,
} from '../../src/autopilot/plan.js';
import type {
  DailyPlan,
  PlanItem,
  ResearchCandidate,
  ResearchDoc,
} from '../../src/contracts/types.js';

const cand = (
  id: string,
  title: string,
  score: number,
  o: Partial<ResearchCandidate> = {},
): ResearchCandidate => ({ id, kind: 'competitor', title, score, reasons: [`Lý do ${id}`], ...o });
const src = (id: string): ResearchCandidate['source_channel'] => ({ id, title: `Kênh ${id}` });

const item = (o: Partial<Omit<PlanItem, 'id'>> & { id: string }): PlanItem => ({
  status: 'planned',
  candidate_id: `yt:${o.id}`,
  title: `Tiêu đề ${o.id}`,
  angle: 'góc',
  source: { kind: 'competitor' },
  workflow_id: 'narrated-explainer',
  output_profile: 'yt-1080p30',
  publish_at: null,
  platforms: ['youtube'],
  score: 50,
  reasons: [],
  ...o,
  id: `pi_${o.id.padEnd(8, '0')}`,
});

const ids = (r: { candidate: ResearchCandidate }[]) => r.map((x) => x.candidate.id);

describe('selectCandidates (051)', () => {
  const base = [
    cand('a', 'Trận Bạch Đằng 1288', 90, { source_channel: src('X'), pillar: 'nhà Trần' }),
    cand('b', 'Hội nghị Diên Hồng', 80, { source_channel: src('Y'), pillar: 'nhà Trần' }),
    cand('c', 'Thành cổ Quảng Trị', 70, { source_channel: src('Z'), pillar: 'kháng chiến' }),
    cand('d', 'Chợ nổi Cái Răng', 60, { kind: 'trend', pillar: 'văn hóa' }),
  ];
  const sel = (o: Partial<Parameters<typeof selectCandidates>[0]> = {}) =>
    selectCandidates({ candidates: base, slots: 2, history: [], today: [], ...o });

  it('ranks by score, highest first, up to the free slots (ties keep research order)', () => {
    const shuffled = [base[2]!, base[0]!, base[3]!, base[1]!];
    // a (nhà Trần) → b cùng trụ cột nên nhường c khi còn lựa chọn khác
    expect(ids(sel({ candidates: shuffled, slots: 3 }).picked)).toEqual(['a', 'c', 'd']);
    expect(ids(sel({ slots: 0 }).picked)).toEqual([]);
    const tie = [cand('t1', 'Alpha Bravo', 50), cand('t2', 'Charlie Delta', 50)];
    expect(ids(sel({ candidates: tie, slots: 2 }).picked)).toEqual(['t1', 't2']);
  });

  it('skips candidates already planned in the last 14 days — same id or near-duplicate title', () => {
    const history = [
      item({ id: 'h1', candidate_id: 'a' }),
      item({ id: 'h2', candidate_id: 'news:zzz', title: 'chợ nổi cái răng!' }),
    ];
    const r = sel({ history, slots: 4 });
    expect(ids(r.picked)).toEqual(['b', 'c']);
    expect(r.duplicates).toBe(2);
  });

  it('a skipped item in history still blocks the topic', () => {
    const history = [item({ id: 'h1', candidate_id: 'a', status: 'skipped' })];
    expect(ids(sel({ history, candidates: [base[0]!], slots: 1 }).picked)).toEqual([]);
  });

  it('skips topics the channel already made (research similarity ≥ 0.6)', () => {
    const made = cand('m', 'Một chủ đề đã làm', 99, {
      metrics: { similarity: PLAN_CONSTANTS.DUP_SIMILARITY },
    });
    expect(ids(sel({ candidates: [made, base[0]!], slots: 2 }).picked)).toEqual(['a']);
  });

  it('does not pick two near-duplicates on the same day', () => {
    const twin = cand('a2', 'Trận Bạch Đằng 1288!', 85, { source_channel: src('Q') });
    expect(ids(sel({ candidates: [base[0]!, twin, base[2]!], slots: 2 }).picked)).toEqual([
      'a',
      'c',
    ]);
  });

  it('diversity: avoids the same source competitor, then the same pillar, when alternatives exist', () => {
    const same = [
      cand('s1', 'Alpha Bravo', 90, { source_channel: src('X'), pillar: 'P1' }),
      cand('s2', 'Charlie Delta', 85, { source_channel: src('X'), pillar: 'P2' }),
      cand('s3', 'Echo Foxtrot', 80, { source_channel: src('Y'), pillar: 'P1' }),
      cand('s4', 'Golf Hotel', 70, { source_channel: src('Z'), pillar: 'P3' }),
    ];
    // s1 → (khác nguồn + khác trụ cột) s4 → còn lại: s2 (nguồn X trùng), s3 (trụ cột P1 trùng) → nhường nguồn khác: s3
    expect(ids(sel({ candidates: same, slots: 3 }).picked)).toEqual(['s1', 's4', 's3']);
  });

  it('diversity relaxes when there is no alternative', () => {
    const same = [
      cand('s1', 'Alpha Bravo', 90, { source_channel: src('X'), pillar: 'P1' }),
      cand('s2', 'Charlie Delta', 85, { source_channel: src('X'), pillar: 'P1' }),
    ];
    expect(ids(sel({ candidates: same, slots: 2 }).picked)).toEqual(['s1', 's2']);
  });

  it('items already planned today seed the diversity constraints', () => {
    const today = [
      item({
        id: 't',
        candidate_id: 'a',
        source: { kind: 'competitor', source_channel: src('X') },
      }),
    ];
    const r = sel({
      candidates: [
        cand('n1', 'Alpha Bravo', 90, { source_channel: src('X') }),
        cand('n2', 'Charlie Delta', 80, { source_channel: src('Y') }),
      ],
      today,
      slots: 1,
    });
    expect(ids(r.picked)).toEqual(['n2']);
  });

  it('min_score: candidates below the threshold are never picked (boundary included)', () => {
    const r = sel({ min_score: 70, slots: 4 });
    expect(ids(r.picked)).toEqual(['a', 'c', 'b']); // d (60) bị loại; b nhường c vì trùng trụ cột
    expect(r.low).toBe(1);
    const edge = [cand('e1', 'Alpha Bravo', 40), cand('e2', 'Charlie Delta', 39.9)];
    expect(ids(sel({ candidates: edge, min_score: 40, slots: 2 }).picked)).toEqual(['e1']);
    expect(sel({ candidates: edge, min_score: 40, slots: 2 }).low).toBe(1);
    expect(ids(sel({ candidates: edge, slots: 2 }).picked)).toEqual(['e1', 'e2']); // mặc định 0
  });

  it('empty research → nothing picked', () => {
    const r = sel({ candidates: [] });
    expect(r.picked).toEqual([]);
    expect(r.pool).toBe(0);
  });
});

describe('freeSlots — max_per_day counts only Autopilot items (051 / 050 decision)', () => {
  it('limited by capacity, by the daily cap, never negative', () => {
    expect(freeSlots({ feasible: 3, max_per_day: 5, planned: 0, started: 0 })).toBe(3);
    expect(freeSlots({ feasible: 5, max_per_day: 2, planned: 0, started: 0 })).toBe(2);
    // đã bắt đầu 1, đang planned 1: trần 3 → còn 1; năng lực còn 2 video (đã gồm mục planned) → còn 1
    expect(freeSlots({ feasible: 2, max_per_day: 3, planned: 1, started: 1 })).toBe(1);
    expect(freeSlots({ feasible: 1, max_per_day: 3, planned: 2, started: 0 })).toBe(0);
    expect(freeSlots({ feasible: 0, max_per_day: 3, planned: 0, started: 0 })).toBe(0);
  });
});

describe('chooseWorkflow (051)', () => {
  const installed: PlanWorkflow[] = [
    { id: 'narrated-explainer', output_profiles: ['yt-1080p30'] },
    { id: 'story-documentary', output_profiles: ['yt-1080p30'] },
    { id: 'shorts', output_profiles: ['yt-shorts-1080x1920'] },
  ];
  const all = allowedWorkflows([], installed);
  const choose = (c: ResearchCandidate, allowed = all, def = 'narrated-explainer') =>
    chooseWorkflow(c, { allowed, default_workflow: def });
  const long = cand('l', 'Dài', 50, { metrics: { duration_s: 900 } });
  const short = cand('s', 'Ngắn', 50, { metrics: { duration_s: 45 } });

  it('allowed = autopilot.workflows (user order) filtered by installed; empty = all installed', () => {
    expect(allowedWorkflows([], installed).map((w) => w.id)).toEqual([
      'narrated-explainer',
      'story-documentary',
      'shorts',
    ]);
    expect(
      allowedWorkflows(['shorts', 'nope', 'story-documentary'], installed).map((w) => w.id),
    ).toEqual(['shorts', 'story-documentary']);
  });

  it('a short (≤ 60 s) goes to shorts when allowed, with the vertical profile', () => {
    expect(choose(short)).toMatchObject({
      workflow_id: 'shorts',
      output_profile: 'yt-shorts-1080x1920',
    });
    expect(choose(cand('b', 'Biên', 50, { metrics: { duration_s: 60 } }))).toMatchObject({
      workflow_id: 'shorts',
    });
    expect(choose(cand('c', 'Quá', 50, { metrics: { duration_s: 61 } }))).toMatchObject({
      workflow_id: 'narrated-explainer',
    });
  });

  it('a short with shorts not allowed uses the long-form rule', () => {
    const noShorts = allowedWorkflows(['story-documentary'], installed);
    expect(choose(short, noShorts)).toMatchObject({ workflow_id: 'story-documentary' });
  });

  it('long video → workflow.default if allowed, else the first allowed long-form workflow', () => {
    expect(choose(long)).toMatchObject({
      workflow_id: 'narrated-explainer',
      output_profile: 'yt-1080p30',
    });
    const only = allowedWorkflows(['shorts', 'story-documentary'], installed);
    expect(choose(long, only, 'narrated-explainer')).toMatchObject({
      workflow_id: 'story-documentary',
    });
    // không có duration (trend, tin) → coi như dài
    expect(choose(cand('t', 'Trend', 50, { kind: 'trend' }))).toMatchObject({
      workflow_id: 'narrated-explainer',
    });
  });

  it('only shorts allowed → shorts even for a long video; nothing allowed → undefined', () => {
    expect(choose(long, allowedWorkflows(['shorts'], installed))).toMatchObject({
      workflow_id: 'shorts',
    });
    expect(choose(long, [])).toBeUndefined();
  });

  it('profile is the first output profile of the workflow', () => {
    const w = allowedWorkflows([], [{ id: 'x', output_profiles: ['p1', 'p2'] }]);
    expect(choose(long, w, 'x')).toMatchObject({ output_profile: 'p1' });
  });
});

describe('assignPublishSlot (051)', () => {
  const HCM = 'Asia/Ho_Chi_Minh';
  const at = (iso: string) => Date.parse(iso);
  const none = new Set<number>();

  it('next slot strictly after the ready time, in the channel time zone, ISO with offset', () => {
    // 10:00 giờ VN
    expect(
      assignPublishSlot({
        slots: ['19:00'],
        timezone: HCM,
        after_ms: at('2026-10-07T03:00:00Z'),
        taken: none,
      }),
    ).toBe('2026-10-07T19:00:00+07:00');
    // đúng 19:00 → "sau hẳn" → ngày kế
    expect(
      assignPublishSlot({
        slots: ['19:00'],
        timezone: HCM,
        after_ms: at('2026-10-07T12:00:00Z'),
        taken: none,
      }),
    ).toBe('2026-10-08T19:00:00+07:00');
    expect(
      assignPublishSlot({
        slots: ['19:00', '07:30'],
        timezone: HCM,
        after_ms: at('2026-10-07T03:00:00Z'),
        taken: none,
      }),
    ).toBe('2026-10-07T19:00:00+07:00');
    expect(
      assignPublishSlot({
        slots: ['19:00', '07:30'],
        timezone: HCM,
        after_ms: at('2026-10-06T23:00:00Z'),
        taken: none,
      }),
    ).toBe('2026-10-07T07:30:00+07:00');
  });

  it('the same instant is another day in another time zone', () => {
    // 2026-10-07T03:00Z = 05:00 Berlin (CEST +02:00)
    expect(
      assignPublishSlot({
        slots: ['08:00'],
        timezone: 'Europe/Berlin',
        after_ms: at('2026-10-07T03:00:00Z'),
        taken: none,
      }),
    ).toBe('2026-10-07T08:00:00+02:00');
    // sau khi lùi giờ mùa hè (26/10) offset là +01:00
    expect(
      assignPublishSlot({
        slots: ['09:00'],
        timezone: 'Europe/Berlin',
        after_ms: at('2026-10-26T00:00:00Z'),
        taken: none,
      }),
    ).toBe('2026-10-26T09:00:00+01:00');
  });

  it('weekday slots: "sat 09:00" and "mon-fri 07:15" (2026-10-07 is a Wednesday)', () => {
    const wed = at('2026-10-07T03:00:00Z');
    expect(
      assignPublishSlot({ slots: ['sat 09:00'], timezone: HCM, after_ms: wed, taken: none }),
    ).toBe('2026-10-10T09:00:00+07:00');
    expect(
      assignPublishSlot({ slots: ['mon-fri 07:15'], timezone: HCM, after_ms: wed, taken: none }),
    ).toBe('2026-10-08T07:15:00+07:00');
    // thứ Sáu 10:00 → khung ngày thường kế là thứ Hai
    const fri = at('2026-10-09T03:00:00Z');
    expect(
      assignPublishSlot({ slots: ['mon-fri 07:15'], timezone: HCM, after_ms: fri, taken: none }),
    ).toBe('2026-10-12T07:15:00+07:00');
    // khoảng vòng "sat-mon"
    expect(
      assignPublishSlot({ slots: ['sat-mon 06:00'], timezone: HCM, after_ms: wed, taken: none }),
    ).toBe('2026-10-10T06:00:00+07:00');
    expect(
      assignPublishSlot({
        slots: ['sat-mon 06:00', 'sun 20:00'],
        timezone: HCM,
        after_ms: at('2026-10-10T03:00:00Z'),
        taken: none,
      }),
    ).toBe('2026-10-11T06:00:00+07:00');
  });

  it('spills to the next day when no slot is left today', () => {
    expect(
      assignPublishSlot({
        slots: ['09:00', '19:00'],
        timezone: HCM,
        after_ms: at('2026-10-07T14:00:00Z'),
        taken: none,
      }),
    ).toBe('2026-10-08T09:00:00+07:00');
  });

  it('skips slots already used by another item (today or later)', () => {
    const taken = new Set([at('2026-10-07T19:00:00+07:00'), at('2026-10-08T09:00:00+07:00')]);
    expect(
      assignPublishSlot({
        slots: ['09:00', '19:00'],
        timezone: HCM,
        after_ms: at('2026-10-07T03:00:00Z'),
        taken,
      }),
    ).toBe('2026-10-08T19:00:00+07:00');
  });

  it('no slots configured → null', () => {
    expect(
      assignPublishSlot({ slots: [], timezone: HCM, after_ms: Date.now(), taken: none }),
    ).toBeNull();
    // khung theo thứ không bao giờ khớp trong chân trời? (luôn khớp) — còn khung hỏng bị bỏ qua
    expect(
      assignPublishSlot({ slots: ['xx'], timezone: HCM, after_ms: Date.now(), taken: none }),
    ).toBeNull();
  });
});

describe('buildPlan (051)', () => {
  const installed: PlanWorkflow[] = [
    { id: 'narrated-explainer', output_profiles: ['yt-1080p30'] },
    { id: 'shorts', output_profiles: ['yt-shorts-1080x1920'] },
  ];
  const NOW = new Date('2026-10-07T03:00:00Z'); // 10:00 giờ VN, thứ Tư
  const research = (cs: ResearchCandidate[]): ResearchDoc =>
    ({
      schema_version: 1,
      channel_id: 'ch_k3v9q2xa',
      date: '2026-10-07',
      generated_at: NOW.toISOString(),
      quota_units: 0,
      sources: {
        competitors: [],
        own_videos: 0,
        trending: { region: 'VN', videos: 0 },
        trends: { geo: 'VN', items: 0 },
        news: [],
      },
      candidates: cs,
    }) as ResearchDoc;
  const topics = [
    cand('a', 'Trận Bạch Đằng 1288', 90, {
      source_channel: src('X'),
      pillar: 'P1',
      metrics: { duration_s: 900 },
    }),
    cand('b', 'Hội nghị Diên Hồng', 80, {
      source_channel: src('Y'),
      pillar: 'P2',
      metrics: { duration_s: 50 },
    }),
    cand('c', 'Thành cổ Quảng Trị', 70, { source_channel: src('Z'), pillar: 'P3' }),
    cand('d', 'Chợ nổi Cái Răng', 60, { kind: 'trend', pillar: 'P4' }),
  ];
  const input = (o: Partial<BuildPlanInput> = {}): BuildPlanInput => ({
    channel_id: 'ch_k3v9q2xa',
    date: '2026-10-07',
    now: NOW,
    timezone: 'Asia/Ho_Chi_Minh',
    others: [],
    research: research(topics),
    capacity: {
      videos: 3,
      limiting_factor: 'time',
      reasons: ['lý do năng lực'],
      est_ms: { 'narrated-explainer': 60 * 60_000, shorts: 30 * 60_000 },
    },
    config: {
      max_per_day: 5,
      workflows: [],
      default_workflow: 'narrated-explainer',
      slots: ['09:00', '12:00', '19:00'],
      platforms: ['youtube', 'tiktok'],
      min_score: 0,
    },
    installed,
    ...o,
  });

  it('fills the feasible slots with the best candidates, workflow, profile, platforms, reasons', () => {
    const plan = buildPlan(input());
    expect(plan).toMatchObject({
      schema_version: 1,
      channel_id: 'ch_k3v9q2xa',
      date: '2026-10-07',
      generated_at: NOW.toISOString(),
      capacity: { videos: 3, limiting_factor: 'time', reasons: ['lý do năng lực'] },
    });
    expect(
      plan.items.map((i) => [i.candidate_id, i.status, i.workflow_id, i.output_profile]),
    ).toEqual([
      ['a', 'planned', 'narrated-explainer', 'yt-1080p30'],
      ['b', 'planned', 'shorts', 'yt-shorts-1080x1920'],
      ['c', 'planned', 'narrated-explainer', 'yt-1080p30'],
    ]);
    for (const it of plan.items) {
      expect(it.id).toMatch(/^pi_[0-9a-z]{8}$/);
      expect(it.platforms).toEqual(['youtube', 'tiktok']);
      expect(it.reasons.length).toBeGreaterThan(1);
      expect(it.angle).not.toBe('');
    }
    expect(plan.items[0]).toMatchObject({
      title: 'Trận Bạch Đằng 1288',
      score: 90,
      source: { kind: 'competitor', source_channel: src('X') },
    });
  });

  it('publish slots: produced one after another, each strictly after its ready time, all distinct', () => {
    // sẵn sàng: a 11:00, b 11:30 (shorts 30 phút), c 12:30 → khung 12:00 bị bỏ qua cho a? a: sau 11:00 → 12:00
    const plan = buildPlan(input());
    expect(plan.items.map((i) => i.publish_at)).toEqual([
      '2026-10-07T12:00:00+07:00',
      '2026-10-07T19:00:00+07:00',
      '2026-10-08T09:00:00+07:00',
    ]);
  });

  it('slots used by other plans of the channel (incl. spill from yesterday) are not reused', () => {
    const yesterday = {
      schema_version: 1,
      channel_id: 'ch_k3v9q2xa',
      date: '2026-10-06',
      generated_at: NOW.toISOString(),
      capacity: { videos: 1, limiting_factor: 'cap', reasons: [] },
      items: [
        item({
          id: 'y1',
          candidate_id: 'old',
          title: 'Chủ đề cũ hoàn toàn',
          publish_at: '2026-10-07T12:00:00+07:00',
        }),
      ],
    } as DailyPlan;
    const plan = buildPlan(input({ others: [yesterday] }));
    expect(plan.items[0]!.publish_at).toBe('2026-10-07T19:00:00+07:00');
  });

  it('no slots → publish_at null', () => {
    const c = input().config;
    const plan = buildPlan(input({ config: { ...c, slots: [] } }));
    expect(plan.items.every((i) => i.publish_at === null)).toBe(true);
  });

  it('the daily cap counts Autopilot items only', () => {
    const c = input().config;
    expect(buildPlan(input({ config: { ...c, max_per_day: 2 } })).items).toHaveLength(2);
    expect(buildPlan(input({ config: { ...c, max_per_day: 0 } })).items).toHaveLength(0);
  });

  it('re-plan is idempotent and keeps every existing item untouched', () => {
    const first = buildPlan(input());
    const again = buildPlan(input({ existing: first, now: new Date(NOW.getTime() + 60_000) }));
    expect(again.items).toEqual(first.items);
  });

  it('re-plan keeps non-planned items and refills only the free slots', () => {
    const first = buildPlan(input());
    const [a, b, c] = first.items as [PlanItem, PlanItem, PlanItem];
    const existing: DailyPlan = {
      ...first,
      items: [
        { ...a, status: 'produced', video_id: 'vd_8m2pq7rt' },
        { ...b, status: 'skipped', note: 'không hợp' },
        { ...c, status: 'failed' },
      ],
    };
    // trần 5, đã bắt đầu 2 (produced, failed), b bị bỏ qua: còn tối đa 3 mục; năng lực còn 3 video
    const next = buildPlan(input({ existing }));
    expect(next.items.slice(0, 3)).toEqual(existing.items);
    const added = next.items.slice(3);
    expect(added.map((i) => i.candidate_id)).toEqual(['d']); // a, b, c đã dùng hôm nay → chỉ còn d
    expect(added[0]!.status).toBe('planned');
    // chạy lại không thêm gì
    expect(buildPlan(input({ existing: next })).items).toEqual(next.items);
  });

  it('a needs_review item (parked by Autopilot, 052) stays untouched and counts as started', () => {
    const first = buildPlan(input());
    const [a, b, c] = first.items as [PlanItem, PlanItem, PlanItem];
    const parked: PlanItem = {
      ...a,
      status: 'needs_review',
      video_id: 'vd_8m2pq7rt',
      note: 'Điểm 6,5 thấp hơn ngưỡng 8',
    };
    const existing: DailyPlan = { ...first, items: [parked, b, c] };
    // trần 2: một mục đã bắt đầu (needs_review) + một planned → hết chỗ; mục đỗ không bị đụng
    const next = buildPlan(
      input({
        existing,
        config: { ...input().config, max_per_day: 2 },
        now: new Date(NOW.getTime() + 60_000),
      }),
    );
    expect(next.items.slice(0, 3)).toEqual(existing.items);
    expect(freeSlots({ feasible: 3, max_per_day: 2, planned: 1, started: 1 })).toBe(0);
  });

  it('a skipped item frees its cap slot but its topic is not re-planned', () => {
    const first = buildPlan(input({ capacity: { ...input().capacity, videos: 1 } }));
    expect(first.items.map((i) => i.candidate_id)).toEqual(['a']);
    const existing: DailyPlan = { ...first, items: [{ ...first.items[0]!, status: 'skipped' }] };
    const next = buildPlan(input({ existing, capacity: { ...input().capacity, videos: 1 } }));
    expect(next.items.map((i) => [i.candidate_id, i.status])).toEqual([
      ['a', 'skipped'],
      ['b', 'planned'],
    ]);
  });

  it('does not re-plan topics planned in the last 14 days', () => {
    const prev = {
      schema_version: 1,
      channel_id: 'ch_k3v9q2xa',
      date: '2026-09-30',
      generated_at: NOW.toISOString(),
      capacity: { videos: 1, limiting_factor: 'cap', reasons: [] },
      items: [
        item({ id: 'p1', candidate_id: 'a', title: 'Trận Bạch Đằng 1288', status: 'produced' }),
      ],
    } as DailyPlan;
    const plan = buildPlan(input({ others: [prev] }));
    expect(plan.items.map((i) => i.candidate_id)).toEqual(['b', 'c', 'd']);
  });

  it('no research → plans nothing and says why (Vietnamese note)', () => {
    const plan = buildPlan(input({ research: undefined }));
    expect(plan.items).toEqual([]);
    expect(plan.notes?.join(' ')).toMatch(/nghiên cứu/i);
    const empty = buildPlan(input({ research: research([]) }));
    expect(empty.items).toEqual([]);
    expect(empty.notes?.join(' ')).toMatch(/ứng viên/i);
  });

  it('no capacity → plans nothing with the limiting factor in the note', () => {
    const plan = buildPlan(
      input({ capacity: { ...input().capacity, videos: 0, limiting_factor: 'tokens' } }),
    );
    expect(plan.items).toEqual([]);
    expect(plan.notes?.join(' ')).toMatch(/năng lực|ngân sách/i);
  });

  it('no allowed workflow installed → plans nothing and says why', () => {
    const c = input().config;
    const plan = buildPlan(input({ config: { ...c, workflows: ['khong-co'] } }));
    expect(plan.items).toEqual([]);
    expect(plan.notes?.join(' ')).toMatch(/workflow/i);
  });

  it('evergreen / trend / news candidates are planned when competitors posted nothing new', () => {
    const only = [
      cand('e', 'Chủ đề bền', 60, { kind: 'competitor_evergreen' }),
      cand('n', 'Tin nóng hôm nay', 55, { kind: 'news' }),
    ];
    const plan = buildPlan(input({ research: research(only) }));
    expect(plan.items.map((i) => [i.candidate_id, i.source.kind])).toEqual([
      ['e', 'competitor_evergreen'],
      ['n', 'news'],
    ]);
  });
  it('min_score: below-threshold topics are not planned and the note says why (Vietnamese)', () => {
    const c = input().config;
    const plan = buildPlan(input({ config: { ...c, min_score: 85 } }));
    expect(plan.items.map((i) => i.candidate_id)).toEqual(['a']);
    expect(plan.notes?.join(' ')).toContain('Chỉ 1 chủ đề đạt điểm ≥ 85, không làm thêm video kém');
    // đủ chỗ trống mà không ai đạt ngưỡng → 0 mục + lý do
    const none = buildPlan(input({ config: { ...c, min_score: 95 } }));
    expect(none.items).toEqual([]);
    expect(none.notes?.join(' ')).toMatch(/Không chủ đề mới nào đạt điểm ≥ 95/);
    // ngưỡng mặc định của kênh (40) không chặn gì khi mọi ứng viên ≥ 60
    expect(buildPlan(input({ config: { ...c, min_score: 40 } })).items).toHaveLength(3);
  });

  describe('carry-over of yesterday’s planned items (051)', () => {
    const yItem = (id: string, o: Partial<Omit<PlanItem, 'id'>> = {}) =>
      item({
        id,
        candidate_id: `old-${id}`,
        title: `Chủ đề hôm qua số ${id}`,
        angle: `góc ${id}`,
        workflow_id: 'shorts',
        output_profile: 'yt-shorts-1080x1920',
        publish_at: '2026-10-06T19:00:00+07:00',
        score: 55,
        reasons: ['lý do cũ'],
        ...o,
      });
    const plan = (date: string, items: PlanItem[]): DailyPlan => ({
      schema_version: 1,
      channel_id: 'ch_k3v9q2xa' as DailyPlan['channel_id'],
      date,
      generated_at: '2026-10-06T03:00:00.000Z',
      capacity: { videos: 1, limiting_factor: 'cap', reasons: [] },
      items,
    });
    const day = (o: Partial<BuildPlanInput> = {}) => planDay(input(o));

    it('moves planned items of the previous day first: keeps topic, gets a new slot and reason; old item is skipped with a note', () => {
      const p = yItem('p1');
      const done = yItem('q1', { status: 'produced', publish_at: null });
      const r = day({ others: [plan('2026-10-06', [p, done])] });
      const first = r.plan.items[0]!;
      expect(first).toMatchObject({
        status: 'planned',
        candidate_id: p.candidate_id,
        title: p.title,
        angle: p.angle,
        workflow_id: 'shorts',
        score: 55,
      });
      expect(first.id).not.toBe(p.id);
      expect(first.id).toMatch(/^pi_[0-9a-z]{8}$/);
      expect(first.reasons).toEqual(
        expect.arrayContaining(['lý do cũ', 'Chuyển từ kế hoạch 2026-10-06']),
      );
      // giờ đăng gán lại theo khung hôm nay (10:00 + 30 phút → 12:00)
      expect(first.publish_at).toBe('2026-10-07T12:00:00+07:00');
      expect(first.platforms).toEqual(['youtube', 'tiktok']);
      // mục mới (capacity 3, đã chuyển 1) lấp 2 chỗ còn lại sau mục chuyển sang
      expect(r.plan.items.slice(1).map((i) => i.candidate_id)).toEqual(['a', 'b']);
      expect(r.plan.items).toHaveLength(3);
      const prev = r.previous!;
      expect(prev.date).toBe('2026-10-06');
      expect(prev.items[0]).toMatchObject({
        id: p.id,
        status: 'skipped',
        note: 'chuyển sang 2026-10-07',
      });
      expect(prev.items[1]).toEqual(done); // mục đã làm không đụng
      expect(r.carried).toBe(1);
    });

    it('only from the day right before — older plans are left alone', () => {
      const r = day({ others: [plan('2026-10-05', [yItem('p1')])] });
      expect(r.carried).toBe(0);
      expect(r.previous).toBeUndefined();
      expect(r.plan.items.map((i) => i.candidate_id)).not.toContain('old-p1');
    });

    it('carried items take free slots before new candidates; leftovers stay planned with a note', () => {
      const cap = { ...input().capacity, videos: 1 };
      const two = [yItem('p1'), yItem('p2')];
      const r = day({ capacity: cap, others: [plan('2026-10-06', two)] });
      expect(r.plan.items.map((i) => i.candidate_id)).toEqual(['old-p1']);
      expect(r.previous!.items.map((i) => i.status)).toEqual(['skipped', 'planned']);
      expect(r.plan.notes?.join(' ')).toMatch(
        /1 mục chưa làm của kế hoạch 2026-10-06 chưa chuyển được/,
      );
    });

    it('is not blocked by the 14-day dedupe, and the topic is not planned twice if research offers it again', () => {
      const same = cand('old-p1', 'Chủ đề hôm qua số p1', 99);
      const r = day({
        research: research([same, ...topics]),
        others: [plan('2026-10-06', [yItem('p1')])],
      });
      expect(r.plan.items.filter((i) => i.candidate_id === 'old-p1')).toHaveLength(1);
      expect(r.plan.items[0]!.candidate_id).toBe('old-p1');
    });

    it('moves even with no research and respects the allowed workflows', () => {
      const c = input().config;
      const r = day({
        research: undefined,
        config: { ...c, workflows: ['narrated-explainer'] },
        others: [plan('2026-10-06', [yItem('p1')])],
      });
      // shorts không còn được phép → workflow mặc định + dạng xuất của nó
      expect(r.plan.items).toHaveLength(1);
      expect(r.plan.items[0]).toMatchObject({
        workflow_id: 'narrated-explainer',
        output_profile: 'yt-1080p30',
      });
    });

    it('re-run is idempotent: nothing is carried twice', () => {
      const first = day({ others: [plan('2026-10-06', [yItem('p1')])] });
      const again = day({
        existing: first.plan,
        others: [first.previous!],
        now: new Date(NOW.getTime() + 60_000),
      });
      expect(again.carried).toBe(0);
      expect(again.previous).toBeUndefined();
      expect(again.plan.items).toEqual(first.plan.items);
    });

    it('heals a half-done carry (copy exists, old item still planned): no duplicate, old item retired', () => {
      const p = yItem('p1');
      const first = day({ others: [plan('2026-10-06', [p])] });
      const r = day({ existing: first.plan, others: [plan('2026-10-06', [p])] });
      expect(r.plan.items).toEqual(first.plan.items);
      expect(r.previous!.items[0]).toMatchObject({
        status: 'skipped',
        note: 'chuyển sang 2026-10-07',
      });
    });
  });
});
