// 009 · US1 · AC-M1-02, SC-001/002 — bước script qua refine-loop với Claude (record khi SF_LLM=record, replay khi không).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCore,
  createVideo,
  parseBlocksDoc,
  serializeBlocksDoc,
  validateArtifact,
  setAdvanced,
  setConfig,
} from '../../src/index.js';
import { coreDir } from '../helpers.js';
import { copyChannel, tempDir } from '../domain-helpers.js';
import { workflowFixtures } from '../workflow-helpers.js';

const fixtureDir = path.join(coreDir, 'tests', 'fixtures', 'llm', 'text');
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

describe('script step with refine-loop (009 AC-M1-02)', () => {
  it('runs ≥ 2 rounds with a different critic model and summarizes the rounds', async () => {
    const live = process.env.SF_LLM === 'record';
    const c = copyChannel();
    const t = tempDir('app-');
    const core = createCore({
      appDataDir: t.dir,
      workflowDirs: [workflowFixtures],
      textFixtureDir: fixtureDir,
      textMode: live ? 'record' : 'replay',
      getSecret: () => undefined,
    });
    cleanups.push(() => core.close(), c.cleanup, t.cleanup);
    const store = core.gateway.storeFor(c.dir);
    // video cố định để khóa ghi/phát lại ổn định
    const videoId = createVideo(store, { title: 'Bầu trời', id: 'vd_sky00001' }).video_id;
    // 085: refine là tính năng nâng cao; giữ model/số vòng như bản ghi (critic Opus, tối thiểu 2 vòng)
    setAdvanced(store, 'advanced.refine', true);
    setConfig(store, 'refine.min_rounds', 2, { tier: 'channel' });
    setConfig(store, 'text.critic', 'claude/claude-opus-5-5', { tier: 'channel' });
    const briefRel = `videos/${videoId}/BRIEF.md`;
    const brief = parseBlocksDoc(readFileSync(store.abs(briefRel), 'utf8'));
    brief.front = { ...brief.front, target_duration_ms: 45000 };
    brief.body = [
      '# Brief',
      '',
      'Chủ đề: Vì sao bầu trời có màu xanh? Khán giả: học sinh cấp 2. Thông điệp: tán xạ Rayleigh giải thích màu trời.',
      '',
    ];
    store.write(briefRel, serializeBlocksDoc(brief), { by: 'test' });

    const e = core.workflows.engine(c.dir, videoId);
    await e.select('refine-demo', 'yt-1080p30');
    await e.approve(e.summary().pending_approvals[0]!);
    await e.idle();

    const st = JSON.parse(readFileSync(store.abs(`videos/${videoId}/state.json`), 'utf8'));
    expect(st.steps.script.error).toBeUndefined();
    expect(st.steps.script.status).toBe('waiting_approval');
    expect(st.steps.script.refine.rounds).toBeGreaterThanOrEqual(2);
    const rounds = readdirSync(store.abs(`videos/${videoId}/reviews/script`)).sort();
    expect(rounds.length).toBe(st.steps.script.refine.rounds);
    const r1 = JSON.parse(
      readFileSync(store.abs(`videos/${videoId}/reviews/script/${rounds[0]}`), 'utf8'),
    );
    expect(r1.producer.model).not.toBe(r1.critic.model);
    const script = readFileSync(store.abs(`videos/${videoId}/SCRIPT.md`), 'utf8');
    expect(validateArtifact(`videos/${videoId}/SCRIPT.md`, script).errors).toEqual([]);
    const note = st.approvals.find((a: { step_id: string }) => a.step_id === 'script')
      .note as string;
    expect(note).toMatch(/Vòng 1: \d/);
    expect(note).toContain('critic cùng hãng');
    expect(st.budget.tokens_used).toBeGreaterThan(0);
  }, 900_000);
});
