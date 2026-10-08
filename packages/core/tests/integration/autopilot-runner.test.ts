// 052 · FR-AP-07, FR-AP-08, NFR-11 — bộ chạy Autopilot trên kênh mẫu + workflow fixture (demo-explainer, duration-demo)
// với brief giả và executor giả: một ngày làm lần lượt các mục theo giờ đăng, cổng chất lượng thay điểm chốt,
// điểm refine thấp thì đỗ mà mục sau vẫn chạy, chạm hạn mức Claude thì chờ rồi làm tiếp, khởi động lại làm tiếp
// đúng video, chạy lại trong ngày không làm lại, video làm tay không bị đụng, nhật ký vận hành.
import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AutopilotRunner,
  autopilotDoneToday,
  capacityToday,
  planToday,
  setChannelAutopilot,
  workflowCost,
  type BriefFn,
} from '../../src/autopilot/index.js';
import type {
  AutopilotLogLine,
  DailyPlan,
  PlanItem,
  ResearchDoc,
  VideoState,
} from '../../src/contracts/types.js';
import { markPlanItem } from '../../src/autopilot/plan.js';
import { setConfig } from '../../src/config/resolve.js';
import { isAutoApproval } from '../../src/domain/autopilot.js';
import { parseBlocksDoc, serializeBlocksDoc } from '../../src/domain/markdown/blocks.js';
import { schemas } from '../../src/contracts/schemas.js';
import { listVideoIds } from '../../src/domain/video.js';
import { SfError } from '../../src/errors.js';
import { WriteStore } from '../../src/store/writer.js';
import { coreDir } from '../helpers.js';
import { copyChannel, fixtureVideo } from '../domain-helpers.js';
import { finalizeExecutor, workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

const NOW = new Date('2026-10-07T03:00:00Z'); // 10:00 giờ Việt Nam, thứ Tư
const DATE = '2026-10-07';
const LIMIT_MSG =
  "Claude Code returned an error result: You've hit your session limit · resets 11pm (Asia/Bangkok)";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((c) => c());
});

const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const readJson = <T>(f: string) => JSON.parse(readFileSync(f, 'utf8')) as T;
const stateOf = (dir: string, v: string) =>
  readJson<VideoState>(path.join(dir, 'videos', v, 'state.json'));
const planFile = (dir: string, date = DATE) => path.join(dir, 'autopilot', 'plans', `${date}.json`);
const logFile = (dir: string, date = DATE) => path.join(dir, 'autopilot', 'log', `${date}.jsonl`);
const planOf = (dir: string, date = DATE) => readJson<DailyPlan>(planFile(dir, date));
const itemOf = (dir: string, id: string, date = DATE) =>
  planOf(dir, date).items.find((i) => i.id === id)!;
const logOf = (dir: string, date = DATE): AutopilotLogLine[] => {
  try {
    return readFileSync(logFile(dir, date), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AutopilotLogLine);
  } catch {
    return [];
  }
};

function setApp(appDir: string, key: string, value: unknown) {
  const f = path.join(appDir, 'settings.json');
  const s = readJson<{ config?: Record<string, unknown> }>(f);
  s.config = { ...s.config, [key]: value };
  writeFileSync(f, JSON.stringify(s, null, 2));
}

interface ItemSpec {
  id: string;
  title?: string;
  publish_at?: string | null;
  status?: PlanItem['status'];
  workflow_id?: string;
  video_id?: string;
}

function planItem(s: ItemSpec): PlanItem {
  return {
    id: s.id as PlanItem['id'],
    status: s.status ?? 'planned',
    candidate_id: `yt:${s.id}`,
    title: s.title ?? `Video ${s.id}`,
    angle: 'Góc nhìn thử',
    source: { kind: 'competitor', url: 'https://www.youtube.com/watch?v=aaaaaaaaa01' },
    workflow_id: s.workflow_id ?? 'demo-explainer',
    output_profile: 'yt-1080p30',
    publish_at: s.publish_at ?? null,
    platforms: ['youtube'],
    score: 80,
    reasons: ['Lý do thử'],
    ...(s.video_id ? { video_id: s.video_id as PlanItem['video_id'] } : {}),
  };
}

function writePlan(dir: string, items: ItemSpec[], date = DATE) {
  const channel = readJson<{ id: string }>(path.join(dir, 'channel.json'));
  const plan: DailyPlan = {
    schema_version: 1,
    channel_id: channel.id as DailyPlan['channel_id'],
    date,
    generated_at: `${date}T02:00:00.000Z`,
    capacity: { videos: 5, limiting_factor: 'cap', reasons: ['thử'] },
    items: items.map(planItem),
  };
  new WriteStore(dir).write(`autopilot/plans/${date}.json`, `${JSON.stringify(plan, null, 2)}\n`, {
    by: 'test',
  });
}

const sampleOf = (file: 'SCRIPT.md' | 'STORYBOARD.md', videoId: string) =>
  readFileSync(path.join(fixtureVideo, file), 'utf8').replaceAll('vd_8m2pq7rt', videoId);

interface RigOpts {
  /** Điểm refine trả về cho mục (undefined = executor không có vòng refine). */
  refine?: (
    itemId: string,
  ) => { rounds: number; final_score?: number; incomplete?: boolean } | undefined;
  /** Throw trong executor `script` (lần gọi thứ n của mục). */
  scriptError?: (itemId: string, n: number) => Error | undefined;
  /** Workflow brief giả đề xuất (mặc định đúng mục kế hoạch). */
  proposes?: (item: PlanItem) => { workflow_id: string; output_profile: string };
  /** Thời lượng mục tiêu ghi vào BRIEF.md (ms). */
  target_ms?: number;
  /** Thời lượng audio giả ghi bởi executor `script` (cho workflow duration-demo). */
  audio_total_ms?: number;
  briefError?: (item: PlanItem, n: number) => Error | undefined;
  /** 061: line bị ASR báo đọc sai (line_id → tỉ lệ lỗi); cần `audio_total_ms`. */
  mismatch?: Record<string, number>;
  /** 079: agent sửa cách đọc (giả): true → line hết lệch. Không đặt = không có agent sửa. */
  fixAsr?: boolean;
}

interface Rig {
  fx: WorkflowFixture;
  dirs: string[];
  app: string;
  clock: { now: Date };
  runner: AutopilotRunner;
  briefs: string[];
  scripts: string[];
  /** 061: line Autopilot đã chấp nhận (asr.accept). */
  accepted: string[];
  /** 079: các lần nhờ agent sửa cách đọc (line_id). */
  fixed: string[][];
  planCalls: number;
  make(): AutopilotRunner;
}

function makeRig(o: RigOpts = {}, channelCount = 1): Rig {
  const fx = workflowFixture();
  cleanups.push(() => fx.cleanup());
  const dirs = [fx.dir];
  for (let i = 1; i < channelCount; i++) {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    dirs.push(c.dir);
  }
  const app = fx.core.appDataDir;
  for (const d of dirs) {
    const s = new WriteStore(d);
    setChannelAutopilot(s, 'autopilot.enabled', true);
    setChannelAutopilot(s, 'autopilot.max_per_day', 5);
  }
  const rig: Rig = {
    fx,
    dirs,
    app,
    clock: { now: NOW },
    briefs: [],
    accepted: [],
    fixed: [],
    scripts: [],
    planCalls: 0,
    runner: undefined as never,
    make: () => undefined as never,
  };
  const { core } = fx;
  const itemIdOf = (dir: string, v: string) => stateOf(dir, v).autopilot?.item_id as string;
  const counts = new Map<string, number>();
  const bump = (k: string) => {
    counts.set(k, (counts.get(k) ?? 0) + 1);
    return counts.get(k)!;
  };

  core.workflows.registerExecutor('script', async (ctx) => {
    const item = itemIdOf(ctx.store.root, ctx.videoId);
    rig.scripts.push(item);
    const err = o.scriptError?.(item, bump(`script:${item}`));
    if (err) throw err;
    ctx.store.write(`videos/${ctx.videoId}/SCRIPT.md`, sampleOf('SCRIPT.md', ctx.videoId), {
      by: 'test',
      validate: false,
    });
    if (o.audio_total_ms) {
      // audio giả cho kiểm audio_duration: một line, tổng thời lượng đúng `audio_total_ms`
      const meta = readJson<{ lines: Record<string, unknown>[]; total_duration_ms: number }>(
        path.join(fixtureVideo, 'audio_meta.json'),
      );
      const lines = ['ln_2r7c4kxm', 'ln_9w3b6tqa', 'ln_5h8q2m3x'].map((id) => ({
        ...meta.lines[0]!,
        line_id: id,
        start_ms: 0,
        duration_ms: Math.round((o.audio_total_ms! - 300) / 3),
        // 061: line đọc sai giả (tỉ lệ lỗi ASR)
        ...(o.mismatch?.[id] !== undefined
          ? { asr_flag: 'mismatch', asr_wer: o.mismatch[id] }
          : { asr_flag: 'ok', asr_wer: 0 }),
      }));
      ctx.store.write(
        `videos/${ctx.videoId}/audio_meta.json`,
        JSON.stringify({ ...meta, video_id: ctx.videoId, lines, total_duration_ms: 0 }),
        { by: 'test', validate: false },
      );
    }
    const refine = o.refine?.(item);
    return { outputs: ['SCRIPT.md'], ...(refine ? { refine } : {}) };
  });
  core.workflows.registerExecutor('finalize', finalizeExecutor(core));
  core.workflows.setAgentRunner(async (_instruction, ctx) => {
    ctx.store.write(`videos/${ctx.videoId}/STORYBOARD.md`, sampleOf('STORYBOARD.md', ctx.videoId), {
      by: 'test',
    });
    await ctx.stepComplete(['STORYBOARD.md']);
  });

  const brief: BriefFn = async (channel, video, item) => {
    const err = o.briefError?.(item, bump(`brief:${item.id}`));
    if (err) throw err;
    rig.briefs.push(item.id);
    const store = core.gateway.storeFor(channel);
    const rel = `videos/${video}/BRIEF.md`;
    if (o.target_ms) {
      const doc = parseBlocksDoc(readFileSync(store.abs(rel), 'utf8'));
      doc.front = { ...doc.front, target_duration_ms: o.target_ms };
      store.write(rel, serializeBlocksDoc(doc), { by: 'test' });
    }
    const p = o.proposes?.(item) ?? item;
    await core.workflows.engine(channel, video).select(p.workflow_id, p.output_profile);
  };

  const installed = [
    { id: 'demo-explainer', output_profiles: ['yt-1080p30', 'yt-shorts-1080x1920'] },
    { id: 'duration-demo', output_profiles: ['yt-1080p30'] },
  ];
  const storeFor = (d: string) => core.gateway.storeFor(d);
  rig.make = () => {
    const runner = new AutopilotRunner({
      workflows: core.workflows,
      storeFor,
      channels: () => dirs,
      appDataDir: app,
      clock: () => rig.clock.now,
      brief,
      // 061: chấp nhận line đọc sai — giả: đổi cờ trong audio_meta (bản thật dựng lại qua build graph)
      acceptAsr: async (channel, video, ids) => {
        rig.accepted.push(...ids);
        const store = core.gateway.storeFor(channel);
        const rel = `videos/${video}/audio_meta.json`;
        const meta = JSON.parse(readFileSync(store.abs(rel), 'utf8'));
        for (const l of meta.lines) if (ids.includes(l.line_id)) l.asr_flag = 'accepted';
        store.write(rel, JSON.stringify(meta), { by: 'test', validate: false });
      },
      // 079: agent sửa `tts_text` rồi `asr.align` — giả: hết lệch (fixAsr: true) hoặc vẫn lệch
      ...(o.fixAsr === undefined
        ? {}
        : {
            fixAsr: async (channel: string, video: string, lines: { line_id: string }[]) => {
              rig.fixed.push(lines.map((l) => l.line_id));
              if (!o.fixAsr) return;
              const store = core.gateway.storeFor(channel);
              const rel = `videos/${video}/audio_meta.json`;
              const meta = JSON.parse(readFileSync(store.abs(rel), 'utf8'));
              for (const l of meta.lines)
                if (lines.some((x) => x.line_id === l.line_id)) {
                  l.asr_flag = 'ok';
                  l.asr_wer = 0.02;
                }
              store.write(rel, JSON.stringify(meta), { by: 'test', validate: false });
            },
          }),
      plan: async ({ channels, now }) => {
        rig.planCalls += 1;
        return planToday({
          channels,
          now,
          // 084: test không gọi mạng thật (Google Trends/News trả gì tùy lúc → số mục bổ sung đổi theo giờ)
          fetch: async () => {
            throw new Error('offline (test)');
          },
          storeFor,
          installed,
          appDataDir: app,
          capacity: (chs) =>
            capacityToday({
              now: now.getTime(),
              timezone: 'Asia/Ho_Chi_Minh',
              work_window: '00:00-23:59',
              budget_share: 0.7,
              daily_tokens: null,
              learned_daily_tokens: null,
              tokens_used_today: 0,
              costs: installed.map((w) => workflowCost(w.id, [], {}, {})),
              channels: chs,
            }),
        });
      },
    });
    core.workflows.setAutoDecide(runner.autoDecide);
    runner.attachPermissions(core.gateway.permissions);
    rig.runner = runner;
    return runner;
  };
  rig.make();
  return rig;
}

describe('một ngày làm theo kế hoạch (FR-AP-07, FR-AP-08)', () => {
  it('produces items one at a time in publish_at order across channels, gates replace key approvals', async () => {
    const rig = makeRig({}, 2);
    const [a, b] = rig.dirs as [string, string];
    writePlan(a, [
      { id: 'pi_a0000001', publish_at: '2026-10-07T21:00:00+07:00' },
      { id: 'pi_a0000002', publish_at: '2026-10-07T12:00:00+07:00' },
    ]);
    writePlan(b, [{ id: 'pi_b0000001', publish_at: '2026-10-07T19:00:00+07:00' }]);
    const before = listVideoIds(a).length;

    const r = await rig.runner.tick();
    expect(r.skipped).toBeUndefined();
    expect(rig.briefs).toEqual(['pi_a0000002', 'pi_b0000001', 'pi_a0000001']);
    expect(r.outcomes.map((x) => x.outcome)).toEqual(['produced', 'produced', 'produced']);

    expect(listVideoIds(a)).toHaveLength(before + 2);
    for (const [dir, id] of [
      [a, 'pi_a0000001'],
      [a, 'pi_a0000002'],
      [b, 'pi_b0000001'],
    ] as const) {
      const item = itemOf(dir, id);
      expect(item).toMatchObject({ status: 'produced', video_id: expect.stringMatching(/^vd_/) });
      expect(item.note).toMatch(/Đã làm xong/);
      const st = stateOf(dir, item.video_id!);
      expect(st.autopilot).toEqual({
        plan_date: DATE,
        item_id: id,
        channel_id: expect.any(String),
      });
      expect(st.phase).toBe('workflow');
      expect(
        Object.values(st.steps).every((s) => s.status === 'done' || s.status === 'skipped'),
      ).toBe(true);
      // brief + hai điểm chốt do cổng chất lượng duyệt (note "Autopilot: …"); storyboard là "Tự duyệt bước"
      const notes = Object.fromEntries(st.approvals.map((x) => [x.step_id, x.note ?? '']));
      expect(notes.brief).toMatch(/^Autopilot: /);
      expect(notes.script).toMatch(/^Autopilot: /);
      expect(notes.finalize).toMatch(/^Autopilot: /);
      expect(notes.storyboard).toMatch(/^Tự duyệt bước/);
      expect(st.approvals.every((x) => x.status === 'approved' && isAutoApproval(x))).toBe(true);
    }
    // tuần tự: video sau tạo sau khi video trước xong
    const created = [
      itemOf(a, 'pi_a0000002').video_id!,
      itemOf(b, 'pi_b0000001').video_id!,
      itemOf(a, 'pi_a0000001').video_id!,
    ];
    expect(created).toHaveLength(new Set(created).size);

    // nhật ký vận hành: mỗi quyết định có lý do (tiếng Việt), ghi theo kênh/ngày
    const log = logOf(a);
    // mọi dòng nhật ký hợp lệ schema AutopilotLogLine (D3 5.19)
    const ajv = (addFormatsModule as unknown as (x: Ajv) => Ajv)(new Ajv({ strict: false }));
    const valid = ajv.compile(schemas.AutopilotLogLine as object);
    for (const l of [...log, ...logOf(b)])
      expect(valid(l), JSON.stringify(valid.errors)).toBe(true);
    const decisions = log.filter((l) => l.event === 'gate.decision' && l.item_id === 'pi_a0000002');
    expect(decisions.map((l) => l.step_id)).toEqual(['brief', 'script', 'finalize']);
    expect(decisions.every((l) => l.level === 'info' && l.message.length > 10)).toBe(true);
    expect(decisions[1]!.video_id).toBe(itemOf(a, 'pi_a0000002').video_id);
    expect(log.filter((l) => l.item_id === 'pi_a0000002').map((l) => l.event)).toEqual(
      expect.arrayContaining(['item.start', 'gate.decision', 'item.produced']),
    );
    expect(logOf(b).some((l) => l.event === 'item.produced' && l.item_id === 'pi_b0000001')).toBe(
      true,
    );
    expect(rig.runner.status().running).toBe(false);
    expect(rig.runner.status().current).toBeUndefined();
  });

  it("builds today's plan when missing, then produces; a second tick re-plans and re-produces nothing", async () => {
    const rig = makeRig();
    const dir = rig.dirs[0]!;
    mkdirSync(path.join(dir, 'research'), { recursive: true });
    const doc = readJson<ResearchDoc>(
      path.join(coreDir, 'tests/fixtures/research/research-doc.json'),
    );
    writeFileSync(
      path.join(dir, 'research', `${DATE}.json`),
      JSON.stringify({ ...doc, date: DATE, candidates: doc.candidates.slice(0, 1) }),
    );
    setChannelAutopilot(new WriteStore(dir), 'autopilot.max_per_day', 1);

    const r1 = await rig.runner.tick();
    expect(rig.planCalls).toBe(1);
    expect(r1.outcomes).toHaveLength(1);
    const plan = planOf(dir);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ status: 'produced', workflow_id: 'demo-explainer' });
    expect(logOf(dir).some((l) => l.event === 'plan.built')).toBe(true);

    const hashes = [sha(planFile(dir)), sha(logFile(dir))];
    const videos = listVideoIds(dir).length;
    const r2 = await rig.runner.tick();
    expect(r2.outcomes).toEqual([]);
    expect(rig.planCalls).toBe(1); // đã có kế hoạch hôm nay → không lập lại
    expect(rig.briefs).toHaveLength(1);
    expect(listVideoIds(dir)).toHaveLength(videos);
    expect([sha(planFile(dir)), sha(logFile(dir))]).toEqual(hashes); // idempotent

    // 076: hết mục chờ làm → sau 1 giờ thử lập bổ sung (năng lực có thể tăng trong ngày); trần 1/ngày → không thêm
    rig.clock.now = new Date(rig.clock.now.getTime() + 61 * 60_000);
    await rig.runner.tick();
    expect(rig.planCalls).toBe(2);
    expect(planOf(dir).items).toHaveLength(1);
    await rig.runner.tick();
    expect(rig.planCalls).toBe(2); // chưa đủ 1 giờ từ lần bổ sung trước
  });

  it('manual videos in an Autopilot channel are untouched and keep waiting at key approvals', async () => {
    const rig = makeRig();
    const { fx } = rig;
    const dir = rig.dirs[0]!;
    const manualState = path.join(dir, fx.v('state.json'));
    const e = fx.core.workflows.engine(dir, fx.videoId);
    await e.select('demo-explainer', 'yt-1080p30');
    await e.approve(e.summary().pending_approvals[0]!); // brief do người duyệt
    await e.advance();
    // điểm chốt `script` của video làm tay vẫn chờ người, dù kênh bật Autopilot
    expect(e.summary().steps.find((s) => s.id === 'script')?.status).toBe('waiting_approval');
    const before = sha(manualState);

    writePlan(dir, [{ id: 'pi_a0000001' }]);
    await rig.runner.tick();
    expect(sha(manualState)).toBe(before);
    expect(stateOf(dir, fx.videoId).autopilot).toBeUndefined();
    expect(itemOf(dir, 'pi_a0000001').video_id).not.toBe(fx.videoId);
    expect(rig.runner.status().today[0]!.items).toHaveLength(1);
  });
});

describe('tool autopilot.status (D4 2.4)', () => {
  it('main session sees the plan items, current state and the latest ops log; other sessions are denied', async () => {
    const rig = makeRig({ refine: () => ({ rounds: 3, final_score: 6 }) });
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_a0000001' }]);
    await rig.runner.tick();
    // tool của core dùng bộ chạy của core (đồng hồ thật): chép kế hoạch + nhật ký của ngày rig sang
    // "hôm nay" theo giờ kênh — không phụ thuộc ngày chạy test
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (today !== DATE) {
      const store = new WriteStore(dir);
      const plan = planOf(dir, DATE);
      store.write(
        `autopilot/plans/${today}.json`,
        `${JSON.stringify({ ...plan, date: today }, null, 2)}
`,
        { by: 'test' },
      );
      store.write(`autopilot/log/${today}.jsonl`, readFileSync(logFile(dir, DATE), 'utf8'), {
        by: 'test',
        validate: false,
      });
    }
    rig.fx.core.autopilot.setChannels(() => [dir]);
    const r = (await rig.fx.core.gateway.call(rig.fx.session, 'autopilot.status', {})) as {
      ok: boolean;
      data: {
        paused: boolean;
        running: boolean;
        today: { date: string; items: { id: string; status: string; note?: string }[] };
        log: { event: string }[];
      };
    };
    expect(r.ok).toBe(true);
    expect(r.data.paused).toBe(false);
    expect(r.data.today.items).toEqual([
      expect.objectContaining({
        id: 'pi_a0000001',
        status: 'needs_review',
        note: expect.stringMatching(/ngưỡng/),
      }),
    ]);
    expect(r.data.log.map((l) => l.event)).toEqual(
      expect.arrayContaining(['item.start', 'item.parked']),
    );
    const denied = await rig.fx.core.gateway.call(
      { ...rig.fx.session, kind: 'frame' },
      'autopilot.status',
      {},
    );
    expect(denied).toMatchObject({ ok: false, error: { code: 'E_TOOL_DENIED' } });
  });
});

describe('cổng chất lượng không đạt → đỗ video đó, báo người dùng (FR-AP-07)', () => {
  it('a low refine score parks the item (needs_review) while the next item still runs', async () => {
    const rig = makeRig({
      refine: (id) =>
        id === 'pi_a0000001' ? { rounds: 3, final_score: 6.5 } : { rounds: 2, final_score: 9 },
    });
    const dir = rig.dirs[0]!;
    writePlan(dir, [
      { id: 'pi_a0000001', publish_at: '2026-10-07T12:00:00+07:00' },
      { id: 'pi_a0000002', publish_at: '2026-10-07T19:00:00+07:00' },
    ]);
    const events: { item_id: string; outcome: string; reason?: string }[] = [];
    rig.runner.on('item.outcome', (e) => events.push(e));
    const r = await rig.runner.tick();
    expect(r.outcomes.map((x) => [x.item_id, x.outcome])).toEqual([
      ['pi_a0000001', 'parked'],
      ['pi_a0000002', 'produced'],
    ]);
    expect(events.map((e) => [e.item_id, e.outcome])).toEqual([
      ['pi_a0000001', 'parked'],
      ['pi_a0000002', 'produced'],
    ]);
    expect(events[0]!.reason).toMatch(/6,5/);
    const parked = itemOf(dir, 'pi_a0000001');
    expect(parked.status).toBe('needs_review');
    expect(parked.note).toMatch(/6,5/);
    expect(parked.note).toMatch(/ngưỡng 8/);
    // approval giữ chờ người, có lý do
    const st = stateOf(dir, parked.video_id!);
    const pend = st.approvals.find((a) => a.step_id === 'script')!;
    expect(pend.status).toBe('pending');
    expect(pend.note).toMatch(/^Cần người duyệt \(Autopilot\): /);
    expect(isAutoApproval(pend)).toBe(false);
    expect(st.steps.script!.status).toBe('waiting_approval');
    expect(itemOf(dir, 'pi_a0000002').status).toBe('produced');
    const warn = logOf(dir).find((l) => l.event === 'item.parked')!;
    expect(warn).toMatchObject({ level: 'warn', item_id: 'pi_a0000001', step_id: 'script' });
    expect(warn.message).toMatch(/6,5/);
    // mục đỗ vẫn tính vào trần mỗi ngày (đã có video)
    expect(autopilotDoneToday(dir, NOW, rig.app)).toBe(2);
    // đỗ rồi thì tick sau không làm lại
    await rig.runner.tick();
    expect(rig.briefs).toEqual(['pi_a0000001', 'pi_a0000002']);
    expect(itemOf(dir, 'pi_a0000001').status).toBe('needs_review');
  });

  it('a brief that proposes a different workflow than the plan is parked', async () => {
    const rig = makeRig({
      proposes: () => ({ workflow_id: 'duration-demo', output_profile: 'yt-1080p30' }),
    });
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_a0000001' }]);
    const r = await rig.runner.tick();
    expect(r.outcomes[0]!.outcome).toBe('parked');
    const item = itemOf(dir, 'pi_a0000001');
    expect(item.status).toBe('needs_review');
    expect(item.note).toMatch(/duration-demo/);
    const st = stateOf(dir, item.video_id!);
    expect(st.phase).toBe('briefing');
    expect(st.approvals.find((a) => a.step_id === 'brief')!.status).toBe('pending');
  });

  it('an Autopilot approval still passes only when the file is the one the gate saw (hash)', async () => {
    const rig = makeRig({ refine: () => ({ rounds: 1, final_score: 9.2 }) });
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_a0000001' }]);
    await rig.runner.tick();
    const v = itemOf(dir, 'pi_a0000001').video_id!;
    const a = stateOf(dir, v).approvals.find((x) => x.step_id === 'script')!;
    expect(a.note).toMatch(/9,2/);
    expect(Object.keys(a.artifact_hashes)).toEqual(['SCRIPT.md']);
  });

  it('an audio_duration warning within autopilot.duration_waive_ratio is waived, beyond it is parked', async () => {
    // thực tế 10 300 ms (3 line + 300 ms nghỉ): mục tiêu 9 000 → +14 %; mục tiêu 8 000 → +29 %
    const waived = makeRig({ target_ms: 9_000, audio_total_ms: 10_300 });
    writePlan(waived.dirs[0]!, [{ id: 'pi_a0000001', workflow_id: 'duration-demo' }]);
    const r1 = await waived.runner.tick();
    expect(r1.outcomes[0]!.outcome).toBe('produced');
    const w = logOf(waived.dirs[0]!).find((l) => l.event === 'step.waive')!;
    expect(w).toMatchObject({ level: 'info', step_id: 'script' });
    expect(w.message).toMatch(/bỏ qua cảnh báo/);
    expect(
      stateOf(waived.dirs[0]!, itemOf(waived.dirs[0]!, 'pi_a0000001').video_id!).steps.script!
        .waived,
    ).toEqual(['audio_duration']);

    const far = makeRig({ target_ms: 8_000, audio_total_ms: 10_300 });
    writePlan(far.dirs[0]!, [{ id: 'pi_a0000001', workflow_id: 'duration-demo' }]);
    const r2 = await far.runner.tick();
    expect(r2.outcomes[0]!.outcome).toBe('parked');
    const item = itemOf(far.dirs[0]!, 'pi_a0000001');
    expect(item.status).toBe('needs_review');
    expect(item.note).toMatch(/lệch quá ngưỡng/);
    expect(stateOf(far.dirs[0]!, item.video_id!).steps.script!.status).toBe('failed');

    // ngưỡng chặt hơn ở kênh (0,05) → +14 % cũng đỗ
    const tight = makeRig({ target_ms: 9_000, audio_total_ms: 10_300 });
    setChannelAutopilot(new WriteStore(tight.dirs[0]!), 'autopilot.duration_waive_ratio', 0.05);
    writePlan(tight.dirs[0]!, [{ id: 'pi_a0000001', workflow_id: 'duration-demo' }]);
    expect((await tight.runner.tick()).outcomes[0]!.outcome).toBe('parked');
  });
});

describe('lỗi bước: chạy lại một lần, rồi báo (NFR-11)', () => {
  it('a transient provider error is retried once and the item is produced', async () => {
    const rig = makeRig({
      scriptError: (_id, n) => (n === 1 ? new SfError('E_PROVIDER_FAILED', 'tts boom') : undefined),
    });
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_a0000001' }]);
    const r = await rig.runner.tick();
    expect(r.outcomes[0]!.outcome).toBe('produced');
    expect(rig.scripts).toEqual(['pi_a0000001', 'pi_a0000001']);
    const retry = logOf(dir).find((l) => l.event === 'step.retry')!;
    expect(retry).toMatchObject({ level: 'warn', step_id: 'script' });
    expect(retry.message).toMatch(/E_PROVIDER_FAILED/);
  });

  it('a second failure marks the item failed with the reason and the next item continues', async () => {
    const rig = makeRig({
      scriptError: (id) =>
        id === 'pi_a0000001' ? new SfError('E_PROVIDER_FAILED', 'tts boom') : undefined,
    });
    const dir = rig.dirs[0]!;
    writePlan(dir, [
      { id: 'pi_a0000001', publish_at: '2026-10-07T12:00:00+07:00' },
      { id: 'pi_a0000002', publish_at: '2026-10-07T19:00:00+07:00' },
    ]);
    const r = await rig.runner.tick();
    expect(r.outcomes.map((x) => x.outcome)).toEqual(['failed', 'produced']);
    expect(rig.scripts.filter((x) => x === 'pi_a0000001')).toHaveLength(2); // đúng một lần chạy lại
    const item = itemOf(dir, 'pi_a0000001');
    expect(item.status).toBe('failed');
    expect(item.note).toMatch(/E_PROVIDER_FAILED/);
    expect(item.note).toMatch(/tts boom/);
    expect(logOf(dir).find((l) => l.event === 'item.failed')).toMatchObject({
      level: 'error',
      item_id: 'pi_a0000001',
      step_id: 'script',
    });
    // không chạy lại mãi: tick sau không đụng
    await rig.runner.tick();
    expect(rig.scripts.filter((x) => x === 'pi_a0000001')).toHaveLength(2);
  });

  it('a brief error is retried once, then the item fails', async () => {
    const rig = makeRig({
      briefError: (item, n) =>
        item.id === 'pi_a0000001'
          ? new SfError('E_STEP_INCOMPLETE', `agent stopped ${n}`)
          : undefined,
    });
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_a0000001' }, { id: 'pi_a0000002' }]);
    const r = await rig.runner.tick();
    expect(r.outcomes.map((x) => x.outcome)).toEqual(['failed', 'produced']);
    expect(itemOf(dir, 'pi_a0000001').note).toMatch(/agent stopped 2/);
  });
});

describe('lỗi chung tạm thời: tạm dừng rồi làm tiếp, không đánh hỏng mục (078)', () => {
  it('a network outage pauses 15 minutes, then the same step runs again and the item is produced', async () => {
    const rig = makeRig({
      scriptError: (id, n) =>
        id === 'pi_a0000001' && n === 1 ? new Error('TypeError: fetch failed') : undefined,
    });
    setApp(rig.app, 'autopilot.work_window', '00:00-23:59');
    const dir = rig.dirs[0]!;
    rig.clock.now = new Date('2026-10-07T03:00:00Z');
    writePlan(dir, [{ id: 'pi_a0000001' }, { id: 'pi_a0000002' }]);
    const r1 = await rig.runner.tick();
    expect(r1.outcomes.map((x) => x.outcome)).toEqual(['wait']);
    expect(itemOf(dir, 'pi_a0000001').status).toBe('in_production');
    expect(rig.runner.status().waiting_until).toBe('2026-10-07T03:15:00.000Z');
    expect(logOf(dir).find((l) => l.event === 'outage.wait')).toMatchObject({
      level: 'warn',
      step_id: 'script',
      message: expect.stringMatching(/mạng/),
    });
    rig.clock.now = new Date('2026-10-07T03:10:00Z');
    expect((await rig.runner.tick()).skipped).toBe('limit_wait');
    rig.clock.now = new Date('2026-10-07T03:16:00Z');
    const r3 = await rig.runner.tick();
    expect(r3.outcomes.map((x) => x.outcome)).toEqual(['produced', 'produced']);
    expect(logOf(dir).some((l) => l.event === 'step.retry')).toBe(false);
  });

  it('Claude asking to log in again pauses an hour instead of failing every item', async () => {
    const rig = makeRig({
      scriptError: (id, n) =>
        n === 1 ? new Error('Invalid API key · Please run /login') : undefined,
    });
    setApp(rig.app, 'autopilot.work_window', '00:00-23:59');
    const dir = rig.dirs[0]!;
    rig.clock.now = new Date('2026-10-07T03:00:00Z');
    writePlan(dir, [{ id: 'pi_a0000001' }, { id: 'pi_a0000002' }]);
    const r1 = await rig.runner.tick();
    expect(r1.outcomes.map((x) => x.outcome)).toEqual(['wait']);
    expect(rig.runner.status().waiting_until).toBe('2026-10-07T04:00:00.000Z');
    expect(logOf(dir).find((l) => l.event === 'outage.wait')!.message).toMatch(/đăng nhập/);
    expect(itemOf(dir, 'pi_a0000002').status).toBe('planned'); // không lan sang mục sau
  });
});

describe('hết hạn mức Claude: chờ tới giờ reset rồi làm tiếp (NFR-11)', () => {
  it('pauses until the reset time in the message, then resumes the same video from the same step', async () => {
    const rig = makeRig({
      scriptError: (id, n) => (id === 'pi_a0000001' && n === 1 ? new Error(LIMIT_MSG) : undefined),
    });
    setApp(rig.app, 'autopilot.work_window', '00:00-23:59');
    const dir = rig.dirs[0]!;
    rig.clock.now = new Date('2026-10-07T10:00:00Z'); // 17:00 giờ Việt Nam
    writePlan(dir, [
      { id: 'pi_a0000001', publish_at: '2026-10-07T18:00:00+07:00' },
      { id: 'pi_a0000002', publish_at: '2026-10-07T19:00:00+07:00' },
    ]);
    const r1 = await rig.runner.tick();
    expect(r1.outcomes.map((x) => [x.item_id, x.outcome])).toEqual([['pi_a0000001', 'wait']]);
    expect(rig.briefs).toEqual(['pi_a0000001']); // mục 2 chưa bắt đầu
    const first = itemOf(dir, 'pi_a0000001');
    expect(first.status).toBe('in_production');
    const st1 = rig.runner.status();
    expect(st1.waiting_until).toBe('2026-10-07T16:01:00.000Z'); // 23:00 giờ Việt Nam + 1 phút đệm
    expect(stateOf(dir, first.video_id!).steps.script).toMatchObject({
      status: 'failed',
      error: { message: expect.stringContaining('hit your session limit') },
    });
    const hit = logOf(dir).find((l) => l.event === 'limit.hit')!;
    expect(hit).toMatchObject({ level: 'warn', item_id: 'pi_a0000001', step_id: 'script' });
    expect(hit.message).toMatch(/hạn mức/);

    // chưa tới giờ: không làm gì
    rig.clock.now = new Date('2026-10-07T15:00:00Z');
    const r2 = await rig.runner.tick();
    expect(r2.skipped).toBe('limit_wait');
    expect(rig.scripts).toEqual(['pi_a0000001']);

    // qua giờ reset: làm tiếp đúng video cũ, rồi tới mục sau
    rig.clock.now = new Date('2026-10-07T16:02:00Z');
    const r3 = await rig.runner.tick();
    expect(r3.outcomes.map((x) => [x.item_id, x.outcome])).toEqual([
      ['pi_a0000001', 'produced'],
      ['pi_a0000002', 'produced'],
    ]);
    expect(itemOf(dir, 'pi_a0000001').video_id).toBe(first.video_id);
    expect(rig.briefs).toEqual(['pi_a0000001', 'pi_a0000002']); // không brief lại, không video thứ hai
    expect(rig.scripts.filter((x) => x === 'pi_a0000001')).toHaveLength(2);
    expect(rig.runner.status().waiting_until).toBeUndefined();
    expect(logOf(dir).some((l) => l.event === 'limit.resume')).toBe(true);
    // chạm hạn mức không tính là lần chạy lại: không có step.retry
    expect(logOf(dir).some((l) => l.event === 'step.retry')).toBe(false);
  });

  it('without a readable time it waits one hour; the wait survives a restart (read back from the ops log)', async () => {
    const rig = makeRig({
      scriptError: (_id, n) =>
        n === 1
          ? new Error("Claude Code returned an error result: You've hit your weekly limit")
          : undefined,
    });
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_a0000001' }]);
    await rig.runner.tick();
    expect(rig.runner.status().waiting_until).toBe('2026-10-07T04:00:00.000Z'); // +1 giờ

    // khởi động lại (mất bộ nhớ tiến trình): vẫn chờ tới giờ đã ghi trong nhật ký
    rig.clock.now = new Date('2026-10-07T03:30:00Z');
    const again = rig.make();
    expect((await again.tick()).skipped).toBe('limit_wait');
    expect(again.status().waiting_until).toBe('2026-10-07T04:00:00.000Z');
    rig.clock.now = new Date('2026-10-07T04:00:01Z');
    expect((await again.tick()).outcomes[0]!.outcome).toBe('produced');
    expect(rig.briefs).toHaveLength(1);
  });
});

describe('tạm dừng, khung giờ làm việc', () => {
  it('autopilot.paused: nothing new starts; a video already in production finishes', async () => {
    const rig = makeRig({});
    const dir = rig.dirs[0]!;
    writePlan(dir, [
      { id: 'pi_a0000001', publish_at: '2026-10-07T12:00:00+07:00' },
      { id: 'pi_a0000002', publish_at: '2026-10-07T19:00:00+07:00' },
    ]);
    // người dùng bấm tạm dừng khi video đầu đang chạy
    const base = rig.fx.core.workflows.executor('finalize')!;
    rig.fx.core.workflows.registerExecutor('finalize', async (ctx) => {
      setApp(rig.app, 'autopilot.paused', true);
      return base(ctx);
    });
    const r = await rig.runner.tick();
    expect(r.outcomes.map((x) => [x.item_id, x.outcome])).toEqual([['pi_a0000001', 'produced']]);
    expect(itemOf(dir, 'pi_a0000002').status).toBe('planned');
    expect(rig.runner.status().paused).toBe(true);
    // đang tạm dừng: tick không làm gì
    const r2 = await rig.runner.tick();
    expect(r2.skipped).toBe('paused');
    expect(rig.briefs).toEqual(['pi_a0000001']);
    // bỏ tạm dừng → làm tiếp
    setApp(rig.app, 'autopilot.paused', false);
    expect((await rig.runner.tick()).outcomes.map((x) => x.outcome)).toEqual(['produced']);
  });

  it('outside autopilot.work_window nothing new starts; inside it does', async () => {
    const rig = makeRig({});
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_a0000001' }]);
    rig.clock.now = new Date('2026-10-07T17:00:00Z'); // 00:00 ngày 8 giờ Việt Nam, ngoài 08:00-23:00
    writePlan(dir, [{ id: 'pi_a0000001' }], '2026-10-08');
    const r = await rig.runner.tick();
    expect(r.skipped).toBe('outside_window');
    expect(rig.planCalls).toBe(0);
    expect(rig.briefs).toEqual([]);
    expect(rig.runner.status().paused).toBe(false);
    // run_now bỏ qua khung giờ
    const forced = await rig.runner.tick({ force: true });
    expect(forced.outcomes.map((x) => x.outcome)).toEqual(['produced']);
  });
});

describe('khởi động lại giữa chừng (FR-AP-08)', () => {
  it('resumes the in_production item on the same video without a second one', async () => {
    const rig = makeRig({});
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_a0000001' }, { id: 'pi_a0000002' }]);
    // "app tắt" ngay sau bước script của mục 1: runner cũ dừng, bộ nhớ tiến trình mất
    const first = rig.runner;
    const base = rig.fx.core.workflows.executor('script')!;
    rig.fx.core.workflows.registerExecutor('script', async (ctx) => {
      const r = await base(ctx);
      first.stop();
      return r;
    });
    const r1 = await first.tick();
    expect(r1.outcomes.map((x) => x.outcome)).toEqual(['stopped']);
    const item = itemOf(dir, 'pi_a0000001');
    expect(item.status).toBe('in_production');
    expect(item.video_id).toBeTruthy();
    const videos = listVideoIds(dir);

    const second = rig.make();
    const r2 = await second.tick();
    expect(r2.outcomes.map((x) => [x.item_id, x.outcome])).toEqual([
      ['pi_a0000001', 'produced'],
      ['pi_a0000002', 'produced'],
    ]);
    expect(itemOf(dir, 'pi_a0000001').video_id).toBe(item.video_id);
    expect(listVideoIds(dir)).toHaveLength(videos.length + 1); // chỉ thêm video của mục 2
    expect(rig.briefs).toEqual(['pi_a0000001', 'pi_a0000002']); // mục 1 không brief lại
    expect(logOf(dir).some((l) => l.event === 'item.resume' && l.item_id === 'pi_a0000001')).toBe(
      true,
    );
  });

  it('a step that was running when the app closed is checked and run again (engine.open)', async () => {
    const rig = makeRig({});
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_a0000001' }]);
    const first = rig.runner;
    const base = rig.fx.core.workflows.executor('script')!;
    rig.fx.core.workflows.registerExecutor('script', async (ctx) => {
      const r = await base(ctx);
      first.stop();
      return r;
    });
    await first.tick(); // dừng sau khi engine đã chạy hết các bước của video
    const v = itemOf(dir, 'pi_a0000001').video_id!;
    expect(itemOf(dir, 'pi_a0000001').status).toBe('in_production');
    // mô phỏng app tắt khi bước storyboard đang chạy dở (file đã có, các bước sau chưa chạy)
    const f = path.join(dir, 'videos', v, 'state.json');
    const st = readJson<VideoState>(f);
    st.steps.storyboard = { status: 'running', attempt: 1 };
    st.steps.voice = { status: 'pending', attempt: 0 };
    st.steps.finalize = { status: 'pending', attempt: 0 };
    writeFileSync(f, JSON.stringify(st, null, 2));
    const r = await rig.make().tick();
    expect(r.outcomes[0]!.outcome).toBe('produced');
    expect(itemOf(dir, 'pi_a0000001').video_id).toBe(v);
    expect(stateOf(dir, v).steps.storyboard!.attempt).toBe(2); // chạy lại đúng bước bị ngắt
    expect(logOf(dir).some((l) => l.event === 'step.retry' && l.step_id === 'storyboard')).toBe(
      true,
    );
  });

  it('an in_production item whose video was never created (crash before createVideo) is created with that id', async () => {
    const rig = makeRig({});
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_a0000001', status: 'in_production', video_id: 'vd_zz000001' }]);
    const r = await rig.runner.tick();
    expect(r.outcomes[0]!.outcome).toBe('produced');
    expect(itemOf(dir, 'pi_a0000001').video_id).toBe('vd_zz000001');
    expect(stateOf(dir, 'vd_zz000001').autopilot?.item_id).toBe('pi_a0000001');
    expect(rig.briefs).toEqual(['pi_a0000001']);
  });

  it("an in_production item from yesterday's plan is resumed after midnight", async () => {
    const rig = makeRig({});
    const dir = rig.dirs[0]!;
    writePlan(
      dir,
      [{ id: 'pi_a0000001', status: 'in_production', video_id: 'vd_zz000002' }],
      '2026-10-06',
    );
    writePlan(dir, [], DATE);
    const r = await rig.runner.tick();
    expect(r.outcomes.map((x) => x.outcome)).toEqual(['produced']);
    expect(itemOf(dir, 'pi_a0000001', '2026-10-06').status).toBe('produced');
    expect(stateOf(dir, 'vd_zz000002').autopilot).toMatchObject({ plan_date: '2026-10-06' });
    expect(logOf(dir, '2026-10-06').some((l) => l.event === 'item.produced')).toBe(true);
  });
});

describe('giọng đọc, chi phí', () => {
  it('a speaker without a voice uses the channel default; no channel voice parks the item', async () => {
    // nhân vật không có voice_id → dùng voice.id của kênh (không chờ người chọn)
    const rig = makeRig({});
    const dir = rig.dirs[0]!;
    const castF = path.join(dir, 'characters');
    for (const id of readdirSync(castF)) {
      const f = path.join(castF, id, 'cast.json');
      const c = readJson<Record<string, unknown>>(f);
      delete c.voice_id;
      writeFileSync(f, JSON.stringify(c, null, 2));
    }
    writePlan(dir, [{ id: 'pi_a0000001' }]);
    const r = await rig.runner.tick();
    expect(r.outcomes[0]!.outcome).toBe('produced');
    expect(logOf(dir).some((l) => l.event === 'voice.default')).toBe(true);

    // kênh không có giọng → đỗ
    const rig2 = makeRig({});
    const d2 = rig2.dirs[0]!;
    const ch = readJson<{ config: Record<string, unknown> }>(path.join(d2, 'channel.json'));
    delete ch.config['voice.id'];
    writeFileSync(path.join(d2, 'channel.json'), JSON.stringify(ch, null, 2));
    writePlan(d2, [{ id: 'pi_a0000001' }]);
    const r2 = await rig2.runner.tick();
    expect(r2.outcomes[0]!.outcome).toBe('parked');
    expect(itemOf(d2, 'pi_a0000001')).toMatchObject({
      status: 'needs_review',
      note: expect.stringMatching(/Kênh chưa có giọng đọc/),
    });
  });

  it('a paid-API permission prompt during an Autopilot video does not hang: the item is parked with the cost summary', async () => {
    const rig = makeRig({});
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_a0000001' }, { id: 'pi_a0000002' }]);
    const bus = rig.fx.core.gateway.permissions;
    const requests: unknown[] = [];
    bus.on('permission.requested', (q) => requests.push(q));
    const base = rig.fx.core.workflows.executor('script')!;
    let first = true;
    let askMs = Infinity;
    rig.fx.core.workflows.registerExecutor('script', async (ctx) => {
      if (first) {
        first = false;
        // tool có phí hỏi quyền (như image.generate qua provider có phí)
        const t0 = Date.now();
        const ok = await bus.ask(
          {
            session_id: 'ss_workflow',
            kind: 'main',
            channel_dir: ctx.channelDir,
            video_id: ctx.videoId as never,
          },
          {
            tool: 'image.generate',
            kind: 'paid_api',
            summary: 'Sinh 3 ảnh qua qwen (có phí, ước ≤ $0.5/ảnh)',
          },
        );
        askMs = Date.now() - t0;
        if (!ok) throw new SfError('E_PERMISSION_DECLINED', 'paid call declined');
      }
      return base(ctx);
    });
    const r = await rig.runner.tick();
    expect(askMs).toBeLessThan(500); // permissionTimeoutMs của fixture là 1000: từ chối ngay, không chờ
    expect(r.outcomes.map((x) => x.outcome)).toEqual(['parked', 'produced']);
    const item = itemOf(dir, 'pi_a0000001');
    expect(item.status).toBe('needs_review');
    expect(item.note).toMatch(/cần xác nhận chi phí: Sinh 3 ảnh qua qwen/);
    expect(requests).toHaveLength(1); // yêu cầu vẫn hiện cho người dùng
  });

  it('the same prompt in a manual video still waits for the user', async () => {
    const rig = makeRig({});
    const { fx } = rig;
    const p = fx.core.gateway.permissions.ask(fx.session, {
      tool: 'image.generate',
      kind: 'paid_api',
      summary: 'x',
    });
    // không có quyết định → hết thời gian (1 s) mới từ chối; không bị từ chối ngay như video Autopilot
    const t0 = Date.now();
    expect(await p).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });
});

describe('052 bổ sung: ngân sách API có phí, video làm xong bằng tay', () => {
  it('paid calls within budget.api_cost_usd_per_video are allowed for an Autopilot video; past it the item is parked', async () => {
    const rig = makeRig({});
    const dir = rig.dirs[0]!;
    setConfig(new WriteStore(dir), 'budget.api_cost_usd_per_video', 1, { tier: 'channel' });
    writePlan(dir, [{ id: 'pi_b0000001' }]);
    const bus = rig.fx.core.gateway.permissions;
    const base = rig.fx.core.workflows.executor('script')!;
    const answers: boolean[] = [];
    let first = true;
    rig.fx.core.workflows.registerExecutor('script', async (ctx) => {
      if (first) {
        first = false;
        const session = {
          session_id: 'ss_workflow' as const,
          kind: 'main' as const,
          channel_dir: ctx.channelDir,
          video_id: ctx.videoId as never,
        };
        for (let i = 0; i < 3; i++)
          answers.push(
            await bus.ask(session, {
              tool: 'image.generate',
              kind: 'paid_api',
              summary: `Sinh ảnh ${i + 1} qua qwen (có phí, ước ≤ $0.5/ảnh)`,
              estimate: { provider: 'image.qwen20-api', images: 1, usd: 0.5 },
            }),
          );
        if (answers.includes(false))
          throw new SfError('E_PERMISSION_DECLINED', 'paid call declined');
      }
      return base(ctx);
    });
    const r = await rig.runner.tick();
    expect(answers).toEqual([true, true, false]); // 0,5 + 0,5 ≤ $1; lần 3 vượt
    expect(r.outcomes.map((x) => x.outcome)).toEqual(['parked']);
    expect(itemOf(dir, 'pi_b0000001').note).toMatch(/cần xác nhận chi phí: Sinh ảnh 3/);
    const video = itemOf(dir, 'pi_b0000001').video_id!;
    expect(
      readJson<{ approved_usd: number }>(path.join(dir, 'videos', video, '.sf', 'paid.json')),
    ).toMatchObject({
      approved_usd: 1,
    });
    expect(logOf(dir).some((l) => l.event === 'paid.allowed')).toBe(true);
  });

  it('a parked video that the user finished by hand returns to Autopilot as produced', async () => {
    const rig = makeRig({});
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_c0000001' }]);
    expect((await rig.runner.tick()).outcomes.map((x) => x.outcome)).toEqual(['produced']);
    // giả lập: Autopilot đã đỗ mục, người dùng làm nốt video bằng tay (mọi bước xong)
    markPlanItem(new WriteStore(dir), {
      date: DATE,
      item_id: 'pi_c0000001',
      patch: { status: 'needs_review', note: 'Cần người duyệt (Autopilot): thử' },
    });
    await rig.runner.tick();
    const item = itemOf(dir, 'pi_c0000001');
    expect(item.status).toBe('produced');
    expect(item.note).toMatch(/bằng tay/);
    expect(logOf(dir).some((l) => l.event === 'item.reclaimed')).toBe(true);
  });
});

describe('061: dòng đọc sai được báo ở Hoàn thiện; Autopilot chấp nhận lỗi nhỏ, đỗ lỗi lớn', () => {
  it('a slightly misread line is accepted automatically and the video is produced', async () => {
    // ngưỡng ASR vi 0,15 × 1,5 = 0,225 → 0,18 được chấp nhận
    const rig = makeRig({
      audio_total_ms: 60_000,
      target_ms: 60_000,
      mismatch: { ln_9w3b6tqa: 0.18 },
    });
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_d0000001', workflow_id: 'duration-demo' }]);
    const r = await rig.runner.tick();
    expect(r.outcomes.map((x) => x.outcome)).toEqual(['produced']);
    expect(rig.accepted).toEqual(['ln_9w3b6tqa']);
    expect(logOf(dir).some((l) => l.event === 'asr.accept')).toBe(true);
  });

  it('a badly misread line is handed to the agent to fix how it is read; fixed → produced (079)', async () => {
    const rig = makeRig({
      audio_total_ms: 60_000,
      target_ms: 60_000,
      mismatch: { ln_9w3b6tqa: 0.4 },
      fixAsr: true,
    });
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_d0000003', workflow_id: 'duration-demo' }]);
    const r = await rig.runner.tick();
    expect(r.outcomes.map((x) => x.outcome)).toEqual(['produced']);
    expect(rig.fixed).toEqual([['ln_9w3b6tqa']]);
    expect(logOf(dir).find((l) => l.event === 'asr.fix')!.message).toMatch(/ln_9w3b6tqa.*40%/);
  });

  it('when the agent cannot fix it, the item is parked after one try (079)', async () => {
    const rig = makeRig({
      audio_total_ms: 60_000,
      target_ms: 60_000,
      mismatch: { ln_9w3b6tqa: 0.4 },
      fixAsr: false,
    });
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_d0000004', workflow_id: 'duration-demo' }]);
    const r = await rig.runner.tick();
    expect(r.outcomes.map((x) => x.outcome)).toEqual(['parked']);
    expect(rig.fixed).toHaveLength(1);
    expect(itemOf(dir, 'pi_d0000004').note).toMatch(/đã nhờ agent sửa cách đọc/);
  });

  it('a badly misread line parks the item with the line and error rate', async () => {
    const rig = makeRig({
      audio_total_ms: 60_000,
      target_ms: 60_000,
      mismatch: { ln_9w3b6tqa: 0.4 },
    });
    const dir = rig.dirs[0]!;
    writePlan(dir, [{ id: 'pi_d0000002', workflow_id: 'duration-demo' }]);
    const r = await rig.runner.tick();
    expect(r.outcomes.map((x) => x.outcome)).toEqual(['parked']);
    expect(rig.accepted).toEqual([]);
    expect(itemOf(dir, 'pi_d0000002').note).toMatch(/đọc sai.*ln_9w3b6tqa.*40%/);
  });
});
