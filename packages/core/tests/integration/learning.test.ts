// 057 · FR-AP-13 — vòng phản hồi trên dữ liệu thật của kênh: số liệu video (SQLite, 054) + kế hoạch cũ → autopilot/learning.json,
// áp vào lập kế hoạch ngày, tắt được, chỉ video đủ tuổi có lượt xem, xác định/idempotent, tool + IPC.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { upsertVideoDays } from '../../src/analytics/index.js';
import {
  LearningService,
  capacityToday,
  planToday,
  rankWithLearning,
  workflowCost,
  type CapacityChannel,
  type PlanWorkflow,
} from '../../src/autopilot/index.js';
import { setConfig } from '../../src/config/resolve.js';
import type {
  ChannelLearning,
  PlanItem,
  ResearchCandidate,
  ResearchDoc,
} from '../../src/contracts/types.js';
import { CoreHost, type AgentRuntime } from '../../src/index.js';
import { setChannelAutopilot } from '../../src/autopilot/index.js';
import { openDb } from '../../src/store/db.js';
import { WriteStore } from '../../src/store/writer.js';
import { coreDir } from '../helpers.js';
import { copyChannel, fixtureAppData, tempDir } from '../domain-helpers.js';
import { workflowFixtures } from '../workflow-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const NOW = new Date('2026-10-07T03:00:00Z'); // 10:00 giờ Việt Nam
const TODAY = '2026-10-07';
const research0 = JSON.parse(
  readFileSync(path.join(coreDir, 'tests/fixtures/research/research-doc.json'), 'utf8'),
) as ResearchDoc;
const installed: PlanWorkflow[] = [{ id: 'narrated-explainer', output_profiles: ['yt-1080p30'] }];
const capacity = (channels: CapacityChannel[]) =>
  capacityToday({
    now: NOW.getTime(),
    timezone: 'Asia/Ho_Chi_Minh',
    work_window: '00:00-23:59',
    budget_share: 0.7,
    daily_tokens: null,
    learned_daily_tokens: null,
    tokens_used_today: 0,
    costs: installed.map((w) => workflowCost(w.id, [], {}, {})),
    channels,
  });

const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface Past {
  date: string;
  kind: ResearchCandidate['kind'];
  /** Lượt xem/ngày trong 7 ngày đầu. */
  perf: number;
  /** Có số liệu (video riêng tư chưa công khai → không). */
  views?: boolean;
  pillar?: string;
}

function setup(past: Past[], settings: Record<string, unknown> = {}) {
  const c = copyChannel();
  cleanups.push(c.cleanup);
  const store = new WriteStore(c.dir);
  for (const [k, v] of Object.entries({
    'autopilot.enabled': true,
    'autopilot.max_per_day': 1,
    'publish.slots': ['19:00'],
    ...settings,
  }))
    setChannelAutopilot(store, k, v);
  const channelId = JSON.parse(readFileSync(path.join(c.dir, 'channel.json'), 'utf8')).id as string;
  const db = openDb(':memory:');
  cleanups.push(() => db.close());
  mkdirSync(path.join(c.dir, 'autopilot', 'plans'), { recursive: true });
  mkdirSync(path.join(c.dir, 'research'), { recursive: true });
  past.forEach((p, i) => {
    const vid = `vid_${String(i).padStart(3, '0')}`;
    const item: PlanItem = {
      id: `pi_p${String(i).padStart(7, '0')}` as PlanItem['id'],
      status: 'produced',
      candidate_id: `cand:${i}`,
      title: `Video cũ ${i}`,
      angle: 'g',
      source: { kind: p.kind },
      workflow_id: 'narrated-explainer',
      output_profile: 'yt-1080p30',
      publish_at: `${p.date}T19:00:00+07:00`,
      platforms: ['youtube'],
      score: 70,
      reasons: [],
      publish: { youtube: { status: 'public', video_id: vid } },
    };
    writeFileSync(
      path.join(c.dir, 'autopilot', 'plans', `${p.date}.json`),
      JSON.stringify({
        schema_version: 1,
        channel_id: channelId,
        date: p.date,
        generated_at: NOW.toISOString(),
        capacity: { videos: 1, limiting_factor: 'cap', reasons: [] },
        items: [item],
      }),
    );
    if (p.pillar)
      writeFileSync(
        path.join(c.dir, 'research', `${p.date}.json`),
        JSON.stringify({
          ...research0,
          date: p.date,
          candidates: [
            {
              id: `cand:${i}`,
              kind: p.kind,
              title: item.title,
              score: 70,
              reasons: [],
              pillar: p.pillar,
            },
          ],
        }),
      );
    if (p.views !== false)
      upsertVideoDays(
        db,
        channelId,
        'youtube',
        Array.from({ length: 7 }, (_, d) => ({
          video_ref: vid,
          day: addDays(p.date, d),
          views: p.perf,
          minutes_watched: 1,
          avg_view_duration_s: 30,
          likes: 0,
          comments: 0,
          subs_gained: 0,
        })),
        NOW.toISOString(),
      );
  });
  const svc = new LearningService({
    db,
    appDataDir: fixtureAppData,
    storeFor: (d) => new WriteStore(d),
    clock: () => NOW,
  });
  return { dir: c.dir, store, channelId, db, svc };
}

// 4 video trending hiệu quả cao, 4 tin nóng thấp, đều đã vài ngày tuổi
const HISTORY: Past[] = [
  ...[200, 220, 180, 240].map((perf, i) => ({
    date: `2026-09-${String(10 + i).padStart(2, '0')}`,
    kind: 'trending' as const,
    perf,
    pillar: 'P-hot',
  })),
  ...[50, 40, 60, 55].map((perf, i) => ({
    date: `2026-09-${String(14 + i).padStart(2, '0')}`,
    kind: 'news' as const,
    perf,
    pillar: 'P-cold',
  })),
];
const NEWS = {
  id: 'news:today',
  kind: 'news',
  title: 'Tin nóng về di sản Huế',
  score: 85,
  reasons: ['Tin mới'],
  pillar: 'P-cold',
} as ResearchCandidate;
const TRENDING = {
  id: 'yt:today',
  kind: 'trending',
  title: 'Video đang trending hôm nay',
  score: 80,
  reasons: ['Đang lên'],
  pillar: 'P-hot',
} as ResearchCandidate;

const writeToday = (dir: string) =>
  writeFileSync(
    path.join(dir, 'research', `${TODAY}.json`),
    JSON.stringify({ ...research0, date: TODAY, candidates: [NEWS, TRENDING] }),
  );
const plan = (
  dir: string,
  learn?: (d: string, c: ResearchCandidate[]) => ReturnType<typeof rankWithLearning> | undefined,
) =>
  planToday({
    channels: [dir],
    now: NOW,
    storeFor: (d) => new WriteStore(d),
    capacity,
    installed,
    appDataDir: fixtureAppData,
    scan: async () => {
      throw new Error('không quét');
    },
    ...(learn ? { learn } : {}),
  });
const planned = (dir: string) =>
  JSON.parse(readFileSync(path.join(dir, 'autopilot', 'plans', `${TODAY}.json`), 'utf8'))
    .items[0] as PlanItem;

describe('LearningService', () => {
  it('learns from old-enough videos: baseline, per-dimension ratios and multipliers; writes autopilot/learning.json', () => {
    const s = setup(HISTORY);
    const l = s.svc.refresh(s.dir);
    expect(l).toMatchObject({ enough_data: true, videos: 8 });
    expect(l.baseline_daily_views).toBe(120); // trung vị của 40…240
    const k = Object.fromEntries(l.dimensions.kind.map((g) => [g.key, g]));
    expect(k.trending!.multiplier).toBeGreaterThan(1.1);
    expect(k.news!.multiplier).toBeLessThan(0.9);
    expect(l.dimensions.pillar.map((g) => g.key).sort()).toEqual(['P-cold', 'P-hot']);
    expect(l.dimensions.slot).toEqual([
      expect.objectContaining({ key: '19:00', n: 8, multiplier: 1 }),
    ]);
    const file = JSON.parse(readFileSync(path.join(s.dir, 'autopilot', 'learning.json'), 'utf8'));
    expect(file).toEqual(l);
  });

  it('refresh is idempotent: unchanged data keeps the file (same generated_at)', () => {
    const s = setup(HISTORY);
    const a = s.svc.refresh(s.dir);
    const f = path.join(s.dir, 'autopilot', 'learning.json');
    const before = readFileSync(f, 'utf8');
    const later = new LearningService({
      db: s.db,
      appDataDir: fixtureAppData,
      storeFor: (d) => new WriteStore(d),
      clock: () => new Date(NOW.getTime() + 3_600_000),
    });
    const b = later.refresh(s.dir);
    expect(readFileSync(f, 'utf8')).toBe(before);
    expect(b.generated_at).toBe(a.generated_at);
  });

  it('videos younger than 3 days and private videos without views are not used', () => {
    const young: Past = { date: '2026-10-05', kind: 'competitor', perf: 9999 }; // 2 ngày tuổi
    const hidden: Past = { date: '2026-09-20', kind: 'competitor', perf: 1, views: false };
    const s = setup([...HISTORY, young, hidden]);
    expect(s.svc.refresh(s.dir).videos).toBe(8);
  });

  it('fewer than 5 videos → enough_data=false and no effect on the plan', async () => {
    const s = setup(HISTORY.slice(0, 3));
    writeToday(s.dir);
    const l = s.svc.refresh(s.dir);
    expect(l.enough_data).toBe(false);
    await plan(s.dir, (d, c) => rankWithLearning(c, s.svc.refresh(d)));
    const item = planned(s.dir);
    expect(item.candidate_id).toBe('news:today');
    expect(item.reasons.join(' ')).not.toMatch(/hiệu quả hơn trung bình|kém hơn trung bình/);
  });

  it('can be switched off per channel (autopilot.learning=false)', () => {
    const s = setup(HISTORY);
    expect(s.svc.enabled(s.dir)).toBe(true);
    setConfig(s.store, 'autopilot.learning', false, { tier: 'channel' });
    expect(s.svc.enabled(s.dir)).toBe(false);
  });
});

describe('applied to the daily plan (051)', () => {
  it('a better-performing kind overtakes a higher raw score; the item keeps its research score and explains why', async () => {
    const s = setup(HISTORY);
    writeToday(s.dir);
    const learn = (d: string, c: ResearchCandidate[]) => rankWithLearning(c, s.svc.refresh(d));
    await plan(s.dir, learn);
    const item = planned(s.dir);
    expect(item).toMatchObject({ candidate_id: 'yt:today', score: 80 });
    const text = item.reasons.join('\n');
    expect(text).toMatch(
      /Chủ đề dạng "đang trending" của kênh đang hiệu quả hơn trung bình \d+% \(4 video\) → ưu tiên cao hơn \(×1,\d\d\)\./,
    );
    expect(text).toMatch(/Trụ cột "P-hot" của kênh đang hiệu quả hơn trung bình/);
    // cùng dữ liệu → cùng kết quả (kế hoạch giữ nguyên khi lập lại)
    const first = readFileSync(path.join(s.dir, 'autopilot', 'plans', `${TODAY}.json`), 'utf8');
    await plan(s.dir, learn);
    expect(readFileSync(path.join(s.dir, 'autopilot', 'plans', `${TODAY}.json`), 'utf8')).toBe(
      first,
    );
  });

  it('without the learning hook the same data picks the higher raw score', async () => {
    const s = setup(HISTORY);
    writeToday(s.dir);
    await plan(s.dir);
    expect(planned(s.dir).candidate_id).toBe('news:today');
  });

  it('a learner that returns nothing (disabled or failed in the host) leaves planning untouched', async () => {
    const s = setup(HISTORY);
    writeToday(s.dir);
    await plan(s.dir, () => undefined);
    expect(planned(s.dir).candidate_id).toBe('news:today');
  });
});

describe('tool and IPC', () => {
  const idle: AgentRuntime = {
    id: 'fake',
    authStatus: async () => ({ ok: true, method: 'claude-plan' }),
    openSession: async () => {
      throw new Error('không dùng');
    },
  };
  it('learning.get via IPC and Gateway tool (main + ops, not producer); not enough data is explicit', async () => {
    const c = copyChannel();
    const t = tempDir('app-');
    writeFileSync(
      path.join(t.dir, 'settings.json'),
      readFileSync(path.join(fixtureAppData, 'settings.json')),
    );
    const host = new CoreHost({
      appDataDir: t.dir,
      workflowDirs: [workflowFixtures],
      runtime: idle,
      clock: () => NOW,
      permissionTimeoutMs: 300,
    });
    cleanups.push(() => host.close(), c.cleanup, t.cleanup);
    await host.call('channel.open', { channel: c.dir });
    setChannelAutopilot(new WriteStore(c.dir), 'autopilot.enabled', true);
    const r = await host.call('learning.get', { channel: c.dir });
    expect(r.learning[0]).toMatchObject({ enough_data: false, videos: 0 });
    const g = host.core.gateway;
    expect(g.list('main').map((x) => x.name)).toContain('learning.get');
    expect(g.list('ops').map((x) => x.name)).toContain('learning.get');
    expect(g.list('producer').map((x) => x.name)).not.toContain('learning.get');
    const l: ChannelLearning = host.core.learning.get(c.dir);
    expect(l.enough_data).toBe(false);
  });
});
