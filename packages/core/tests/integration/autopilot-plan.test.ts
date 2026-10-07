// 051 · FR-AP-06 — kế hoạch ngày Autopilot trên hai kênh mẫu: file nghiên cứu từ fixture, năng lực thật
// (`capacityToday` với đầu vào giả), `planToday` ghi `autopilot/plans/<ngày>.json` hợp lệ schema, chạy lại
// không đổi, trần chỉ đếm video Autopilot, tool `autopilot.plan_*` qua Gateway (job + sửa mục).
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autopilotDoneToday,
  autopilotPlanTools,
  capacityToday,
  defineAutopilotPlanJob,
  planToday,
  readPlan,
  setChannelAutopilot,
  workflowCost,
  type CapacityChannel,
  type PlanWorkflow,
} from '../../src/autopilot/index.js';
import type {
  DailyPlan,
  PlanItem,
  ResearchCandidate,
  ResearchDoc,
} from '../../src/contracts/types.js';
import { validateArtifact } from '../../src/domain/validate.js';
import { createGateway } from '../../src/gateway/index.js';
import { JobQueue } from '../../src/jobs/queue.js';
import { openDb } from '../../src/store/db.js';
import { WriteStore } from '../../src/store/writer.js';
import { coreDir } from '../helpers.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

const NOW = new Date('2026-10-07T03:00:00Z'); // 10:00 giờ Việt Nam, thứ Tư
const DATE = '2026-10-07';
const research0 = JSON.parse(
  readFileSync(path.join(coreDir, 'tests/fixtures/research/research-doc.json'), 'utf8'),
) as ResearchDoc;

const installed: PlanWorkflow[] = [
  { id: 'narrated-explainer', output_profiles: ['yt-1080p30'] },
  { id: 'story-documentary', output_profiles: ['yt-1080p30'] },
  { id: 'shorts', output_profiles: ['yt-shorts-1080x1920'] },
];

/** Năng lực thật (`capacityToday`) với đầu vào giả: khung giờ cả ngày, chưa biết ngân sách token. */
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

const cand = (
  id: string,
  title: string,
  score: number,
  o: Partial<ResearchCandidate> = {},
): ResearchCandidate => ({ id, kind: 'competitor', title, score, reasons: [`Lý do ${id}`], ...o });

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function channel(
  settings: Record<string, unknown>,
  candidates: ResearchCandidate[] | null,
  date = DATE,
) {
  const c = copyChannel();
  cleanups.push(c.cleanup);
  const store = new WriteStore(c.dir);
  for (const [k, v] of Object.entries({ 'autopilot.enabled': true, ...settings }))
    setChannelAutopilot(store, k, v);
  if (candidates) {
    mkdirSync(path.join(c.dir, 'research'), { recursive: true });
    const doc: ResearchDoc = { ...research0, date, candidates };
    writeFileSync(path.join(c.dir, 'research', `${date}.json`), JSON.stringify(doc, null, 2));
  }
  return { dir: c.dir, store };
}

const A_TOPICS = [
  cand('yt:a1', 'Trận Bạch Đằng 1288', 95, {
    source_channel: { id: 'UCa', title: 'Kênh A' },
    pillar: 'nhà Trần',
    metrics: { duration_s: 900, similarity: 0 },
  }),
  cand('yt:a2', 'Hội nghị Diên Hồng', 85, {
    source_channel: { id: 'UCb', title: 'Kênh B' },
    pillar: 'hội nghị',
    metrics: { duration_s: 40 },
  }),
  cand('yt:a3', 'Thành cổ Quảng Trị', 70, {
    source_channel: { id: 'UCc', title: 'Kênh C' },
    pillar: 'kháng chiến',
  }),
  cand('trend:cn', 'Chợ nổi Cái Răng', 60, { kind: 'trend' }),
];
const B_TOPICS = [
  cand('news:b1', 'Tin nóng về di sản Huế', 80, { kind: 'news', pillar: 'di sản' }),
  cand('yt:b2', 'Phố cổ Hội An về đêm', 75, { kind: 'competitor_evergreen', pillar: 'di sản' }),
];

const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const planFile = (dir: string, date = DATE) => path.join(dir, 'autopilot', 'plans', `${date}.json`);

function twoChannels() {
  const a = channel(
    {
      'autopilot.max_per_day': 3,
      'publish.slots': ['12:00', '19:00'],
      'publish.platforms': ['youtube', 'tiktok'],
    },
    A_TOPICS,
  );
  const b = channel(
    { 'autopilot.max_per_day': 2, 'publish.slots': [], 'workflow.default': 'story-documentary' },
    B_TOPICS,
  );
  return { a, b };
}

const run = (dirs: string[], o: Record<string, unknown> = {}) =>
  planToday({
    channels: dirs,
    now: NOW,
    storeFor: (d) => new WriteStore(d),
    capacity,
    installed,
    appDataDir: fixtureAppData,
    scan: async () => {
      throw new Error('không được quét khi hôm nay đã có nghiên cứu');
    },
    ...o,
  });

describe('planToday (051 FR-AP-06)', () => {
  it('plans two channels: valid schema-checked files, workflow/profile, slots, platforms, reasons', async () => {
    const { a, b } = twoChannels();
    const r = await run([a.dir, b.dir]);
    expect(r.paused).toBe(false);
    expect(r.plans.map((p) => p.path)).toEqual([
      `autopilot/plans/${DATE}.json`,
      `autopilot/plans/${DATE}.json`,
    ]);
    for (const dir of [a.dir, b.dir]) {
      const text = readFileSync(planFile(dir), 'utf8');
      expect(validateArtifact(`autopilot/plans/${DATE}.json`, text)).toMatchObject({
        valid: true,
        kind: 'plan',
      });
    }
    const pa = readPlan(a.dir, DATE)!;
    expect(pa).toMatchObject({ channel_id: 'ch_k3v9q2xa', date: DATE, schema_version: 1 });
    // A: trần 3; a1 dài → mặc định, a2 ngắn (40 giây) → shorts, a3 → mặc định
    expect(pa.items.map((i) => [i.candidate_id, i.workflow_id, i.output_profile])).toEqual([
      ['yt:a1', 'narrated-explainer', 'yt-1080p30'],
      ['yt:a2', 'shorts', 'yt-shorts-1080x1920'],
      ['yt:a3', 'narrated-explainer', 'yt-1080p30'],
    ]);
    expect(
      pa.items.every((i) => i.platforms.join() === 'youtube,tiktok' && i.status === 'planned'),
    ).toBe(true);
    // giờ đăng: làm lần lượt (90, 30, 90 phút từ 10:00) → xong 11:30 / 12:00 / 13:30; khung 12:00 và 19:00,
    // "sau hẳn" giờ xong và không trùng nhau → tràn sang sáng hôm sau cho mục cuối
    expect(pa.items.map((i) => i.publish_at)).toEqual([
      '2026-10-07T12:00:00+07:00',
      '2026-10-07T19:00:00+07:00',
      '2026-10-08T12:00:00+07:00',
    ]);
    expect(pa.capacity.reasons.length).toBeGreaterThan(0);
    expect(pa.capacity.videos).toBeGreaterThanOrEqual(3);
    // B: không khung giờ → null; workflow.default = story-documentary
    const pb = readPlan(b.dir, DATE)!;
    expect(pb.items.map((i) => [i.candidate_id, i.workflow_id, i.publish_at])).toEqual([
      ['news:b1', 'story-documentary', null],
      ['yt:b2', 'story-documentary', null],
    ]);
    expect(pb.items.every((i) => i.platforms.join() === 'youtube')).toBe(true);
  });

  it('runs again within the day without changing anything (idempotent, file untouched)', async () => {
    const { a, b } = twoChannels();
    const first = await run([a.dir, b.dir]);
    const before = [sha(planFile(a.dir)), sha(planFile(b.dir))];
    const again = await run([a.dir, b.dir], { now: new Date(NOW.getTime() + 5 * 60_000) });
    expect([sha(planFile(a.dir)), sha(planFile(b.dir))]).toEqual(before);
    expect(again.plans.map((p) => [p.added, p.kept])).toEqual([
      [0, 3],
      [0, 2],
    ]);
    expect(again.plans[0]!.plan.items).toEqual(first.plans[0]!.plan.items);
  });

  it('re-plan keeps started / skipped items untouched and only refills free slots', async () => {
    const { a } = twoChannels();
    await run([a.dir]);
    const p = readPlan(a.dir, DATE)!;
    // 052 đã bắt đầu làm mục 1; người dùng bỏ qua mục 2
    const edited: DailyPlan = {
      ...p,
      items: [
        { ...p.items[0]!, status: 'in_production', video_id: fixtureVideoId },
        { ...p.items[1]!, status: 'skipped' },
        p.items[2]!,
      ],
    };
    a.store.write(`autopilot/plans/${DATE}.json`, JSON.stringify(edited, null, 2), { by: 'test' });
    expect(autopilotDoneToday(a.dir, NOW, fixtureAppData)).toBe(1);
    const r = await run([a.dir]);
    const items = r.plans[0]!.plan.items;
    expect(items.slice(0, 3)).toEqual(edited.items);
    // trần 3: 1 bắt đầu + 1 planned = 2 còn 1 chỗ; chủ đề đã dùng không lặp → chỉ còn trend:cn
    expect(items.slice(3).map((i) => [i.candidate_id, i.status])).toEqual([
      ['trend:cn', 'planned'],
    ]);
    expect(items[0]).toMatchObject({ status: 'in_production', video_id: fixtureVideoId });
  });

  it('autopilot.max_per_day counts only Autopilot items — manual videos on the channel do not count', async () => {
    // kênh mẫu đã có một video làm tay (fixtureVideoId); trần 1 vẫn lập đủ 1 mục
    const a = channel({ 'autopilot.max_per_day': 1 }, A_TOPICS);
    const r = await run([a.dir]);
    expect(r.plans[0]!.plan.items).toHaveLength(1);
  });

  it('does not re-plan topics from the last 14 days of plans', async () => {
    const a = channel({ 'autopilot.max_per_day': 2 }, A_TOPICS);
    const old: DailyPlan = {
      schema_version: 1,
      channel_id: 'ch_k3v9q2xa',
      date: '2026-09-30',
      generated_at: '2026-09-30T03:00:00.000Z',
      capacity: { videos: 1, limiting_factor: 'cap', reasons: [] },
      items: [
        {
          id: 'pi_old00001',
          status: 'produced',
          candidate_id: 'yt:a1',
          title: 'Trận Bạch Đằng 1288',
          angle: 'cũ',
          source: { kind: 'competitor' },
          workflow_id: 'narrated-explainer',
          output_profile: 'yt-1080p30',
          publish_at: null,
          platforms: ['youtube'],
          score: 90,
          reasons: [],
        } satisfies PlanItem,
      ],
    };
    a.store.write('autopilot/plans/2026-09-30.json', JSON.stringify(old, null, 2), { by: 'test' });
    const r = await run([a.dir]);
    expect(r.plans[0]!.plan.items.map((i) => i.candidate_id)).not.toContain('yt:a1');
    expect(r.plans[0]!.plan.items).toHaveLength(2);
  });

  it('no research candidates and no trend/news → 0 items with a Vietnamese note', async () => {
    const a = channel({}, []);
    const r = await run([a.dir]);
    expect(r.plans[0]!.plan.items).toEqual([]);
    expect(r.plans[0]!.plan.notes?.join(' ')).toMatch(/không có ứng viên/);
    expect(
      validateArtifact(`autopilot/plans/${DATE}.json`, readFileSync(planFile(a.dir), 'utf8')).valid,
    ).toBe(true);
  });

  it('scans research when today has none; a failing scan still yields a plan with a note', async () => {
    const a = channel({}, null);
    let scanned = 0;
    const ok = await run([a.dir], {
      scan: async () => {
        scanned++;
        return { ...research0, candidates: B_TOPICS };
      },
    });
    expect(scanned).toBe(1);
    expect(ok.plans[0]!.plan.items).toHaveLength(1); // trần mặc định 1
    const b = channel({}, null);
    const bad = await run([b.dir], {
      scan: async () => {
        throw new Error('mất mạng');
      },
    });
    expect(bad.plans[0]!.plan.items).toEqual([]);
    expect(bad.plans[0]!.plan.notes?.[0]).toMatch(/Quét nghiên cứu lỗi: mất mạng/);
  });

  it('autopilot.paused → plans nothing', async () => {
    const app = tempDir('app-');
    cleanups.push(app.cleanup);
    cpSync(fixtureAppData, app.dir, { recursive: true });
    const settings = JSON.parse(readFileSync(path.join(app.dir, 'settings.json'), 'utf8'));
    settings.config['autopilot.paused'] = true;
    writeFileSync(path.join(app.dir, 'settings.json'), JSON.stringify(settings));
    const a = channel({}, A_TOPICS);
    const r = await run([a.dir], { appDataDir: app.dir });
    expect(r).toEqual({ paused: true, plans: [] });
    expect(readPlan(a.dir, DATE)).toBeUndefined();
  });

  it('the date follows the channel time zone', async () => {
    // 2026-10-06T20:00Z = 03:00 ngày 07 giờ VN nhưng còn ngày 06 ở Berlin (22:00)
    const a = channel({ 'publish.timezone': 'Europe/Berlin' }, A_TOPICS, '2026-10-06');
    const r = await run([a.dir], { now: new Date('2026-10-06T20:00:00Z') });
    expect(r.plans[0]!.plan.date).toBe('2026-10-06');
    expect(readPlan(a.dir, '2026-10-06')).toBeDefined();
  });
});

describe('Gateway tools autopilot.plan_* (051)', () => {
  it('plan_run (job) → plan_get → plan_update rules; main sessions only', async () => {
    const a = channel({ 'autopilot.max_per_day': 2, 'publish.slots': ['19:00'] }, A_TOPICS);
    const db = openDb(':memory:');
    const queue = new JobQueue({ db });
    const gw = createGateway({ appDataDir: fixtureAppData });
    cleanups.unshift(() => {
      queue.stop();
      db.close();
    });
    const deps = {
      queue,
      storeFor: (d: string) => gw.storeFor(d),
      capacity,
      installed: () => installed,
      apiKey: () => undefined,
      now: () => NOW,
      appDataDir: fixtureAppData,
    };
    defineAutopilotPlanJob(deps);
    for (const t of autopilotPlanTools(deps)) gw.register(t);
    queue.start();
    const session = {
      session_id: 'ss_test0001',
      kind: 'main',
      channel_dir: a.dir,
      video_id: fixtureVideoId,
    } as const;

    expect(await gw.call(session, 'autopilot.plan_get', {})).toMatchObject({
      ok: false,
      error: { code: 'E_FILE_NOT_FOUND' },
    });
    const started = await gw.call(session, 'autopilot.plan_run', {});
    expect(started.ok).toBe(true);
    const done = await queue.wait((started as { job_id?: string }).job_id!, 10_000);
    expect(done.status).toBe('succeeded');
    expect(done.result).toMatchObject({
      paused: false,
      plans: [{ date: DATE, items: 2, added: 2, kept: 0 }],
    });

    const got = await gw.call(session, 'autopilot.plan_get', { date: DATE });
    expect(got).toMatchObject({ ok: true, data: { date: DATE } });
    const plan = (got as { data: DailyPlan }).data;
    const id = plan.items[0]!.id;
    const upd = (patch: Record<string, unknown>, item = id) =>
      gw.call(session, 'autopilot.plan_update', { date: DATE, item_id: item, patch });

    const ok = await upd({
      title: 'Tiêu đề mới',
      workflow_id: 'shorts',
      publish_at: '2026-10-09T08:00:00+07:00',
    });
    expect(ok).toMatchObject({
      ok: true,
      data: {
        title: 'Tiêu đề mới',
        workflow_id: 'shorts',
        output_profile: 'yt-shorts-1080x1920',
        publish_at: '2026-10-09T08:00:00+07:00',
      },
    });
    expect(readPlan(a.dir, DATE)!.items[0]).toMatchObject({
      title: 'Tiêu đề mới',
      workflow_id: 'shorts',
    });
    expect(await upd({ status: 'skipped' })).toMatchObject({
      ok: true,
      data: { status: 'skipped' },
    });
    expect(await upd({ status: 'planned' })).toMatchObject({
      ok: true,
      data: { status: 'planned' },
    });

    const code = (r: unknown) => (r as { error?: { code: string } }).error?.code;
    expect(code(await upd({ workflow_id: 'khong-co' }))).toBe('E_SCHEMA_INVALID');
    expect(code(await upd({ publish_at: 'mai 8 giờ' }))).toBe('E_SCHEMA_INVALID');
    expect(code(await upd({ publish_at: '2026-10-09T08:00:00' }))).toBe('E_SCHEMA_INVALID'); // thiếu offset
    expect(code(await upd({ title: '  ' }))).toBe('E_SCHEMA_INVALID');
    expect(code(await upd({ status: 'produced' }))).toBe('E_SCHEMA_INVALID');
    expect(code(await upd({}))).toBe('E_SCHEMA_INVALID');
    expect(code(await upd({ title: 'x' }, 'pi_zzzzzzzz'))).toBe('E_ID_UNKNOWN');
    expect(
      code(
        await gw.call(session, 'autopilot.plan_update', {
          date: '2026-01-01',
          item_id: id,
          patch: { title: 'x' },
        }),
      ),
    ).toBe('E_FILE_NOT_FOUND');

    // mục đã/đang làm không sửa được
    const locked: DailyPlan = {
      ...plan,
      items: [{ ...plan.items[0]!, status: 'in_production' }, plan.items[1]!],
    };
    a.store.write(`autopilot/plans/${DATE}.json`, JSON.stringify(locked), { by: 'test' });
    expect(code(await upd({ title: 'x' }))).toBe('E_SCHEMA_INVALID');
    expect(code(await upd({ status: 'skipped' }))).toBe('E_SCHEMA_INVALID');
    const second = plan.items[1]!.id;
    // khôi phục mục đã bỏ qua vượt trần (2 mục chưa bỏ qua / trần 2) bị từ chối
    expect(await upd({ status: 'skipped' }, second)).toMatchObject({ ok: true });
    expect(await upd({ status: 'planned' }, second)).toMatchObject({ ok: true });
    expect(await upd({ status: 'skipped' }, second)).toMatchObject({ ok: true });
    const full: DailyPlan = readPlan(a.dir, DATE)!;
    a.store.write(
      `autopilot/plans/${DATE}.json`,
      JSON.stringify({
        ...full,
        items: [...full.items, { ...full.items[1]!, id: 'pi_extra001', status: 'planned' }],
      }),
      { by: 'test' },
    );
    expect(code(await upd({ status: 'planned' }, second))).toBe('E_SCHEMA_INVALID');

    expect((await gw.call({ ...session, kind: 'frame' }, 'autopilot.plan_get', {})).ok).toBe(false);
    expect((await gw.call({ ...session, kind: 'frame' }, 'autopilot.plan_run', {})).ok).toBe(false);
  });
});
