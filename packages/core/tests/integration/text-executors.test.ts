// 009 · FR-008, FR-009, US4 — executor `script`/`publish-meta` với dịch vụ text giả (không gọi LLM).
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  publishMetaExecutor,
  scriptExecutor,
  stripWrapping,
  validateArtifact,
  WriteStore,
  type StepRunContext,
  type TextService,
} from '../../src/index.js';
import type { StepDecl, WorkflowManifest } from '../../src/contracts/types.js';
import { copyChannel, fixtureAppData, fixtureChannel, fixtureVideoId } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const BODY =
  '## Mở đầu <!-- sf:beat -->\n\n<!-- sf:line speaker=narrator -->\nBầu trời xanh vì tán xạ ánh sáng.\n';
const usage = { input: 10, output: 5 };

function stubText(answers: {
  gen: string[];
  scores?: number[];
}): TextService & { prompts: string[]; roles: string[]; reviews: () => number } {
  const prompts: string[] = [];
  const roles: string[] = [];
  let g = 0;
  let r = 0;
  return {
    prompts,
    roles,
    reviews: () => r,
    models: () => ({
      producer: { provider: 'claude', model: 'p' },
      critic: { provider: 'claude', model: 'c' },
      aux: { provider: 'claude', model: 'a' },
    }),
    generate: async (role, input) => {
      roles.push(role);
      prompts.push(input.messages.map((m) => m.content).join('\n'));
      return {
        text: answers.gen[Math.min(g++, answers.gen.length - 1)]!,
        usage,
        cost_usd: 0,
        model: 'p',
      };
    },
    review: async (input) => {
      const s = answers.scores?.[r++] ?? 9;
      return {
        score: s,
        criteria: input.rubric.criteria.map((c) => ({ id: c.id, score: s, weight: c.weight })),
        issues: [],
        usage,
        cost_usd: 0,
        model: 'c',
      };
    },
  };
}

function ctxFor(dir: string, step: StepDecl): StepRunContext {
  const manifest = { id: 'x', steps: [step] } as unknown as WorkflowManifest;
  return {
    store: new WriteStore(dir),
    channelDir: dir,
    videoId: fixtureVideoId,
    step,
    manifest,
    signal: new AbortController().signal,
    appDataDir: fixtureAppData,
  };
}

/** Ghi đè cấu hình tầng video (085: bật tính năng nâng cao cho một video). */
function setVideoConfig(dir: string, key: string, value: unknown) {
  const store = new WriteStore(dir);
  const rel = `videos/${fixtureVideoId}/state.json`;
  const st = JSON.parse(readFileSync(store.abs(rel), 'utf8'));
  st.config_overrides = { ...st.config_overrides, [key]: value };
  store.write(rel, JSON.stringify(st), { by: 'test' });
}

describe('text executors (009 FR-008)', () => {
  it('script without refine: one producer call, front matter + IDs, provenance, no reviews', async () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const text = stubText({ gen: ['```markdown\n' + BODY + '```'] });
    const out = await scriptExecutor({ text })(
      ctxFor(c.dir, { id: 'script', uses: 'script', title: 'K', params: { mode: 'narration' } }),
    );
    expect(out).toEqual({ outputs: ['SCRIPT.md'] });
    const v = `${c.dir}/videos/${fixtureVideoId}`;
    const script = readFileSync(`${v}/SCRIPT.md`, 'utf8');
    expect(validateArtifact(`videos/${fixtureVideoId}/SCRIPT.md`, script).errors).toEqual([]);
    expect(script).toMatch(/sf:line id=ln_[0-9a-z]{8}/);
    expect(text.prompts[0]).toContain('## Giọng văn');
    expect(readdirSync(`${v}/reviews/script`)).toEqual(
      readdirSync(`${fixtureChannel}/videos/${fixtureVideoId}/reviews/script`),
    );
    const prov = readdirSync(`${v}/provenance`).map((f) =>
      JSON.parse(readFileSync(`${v}/provenance/${f}`, 'utf8')),
    );
    expect(prov.some((p) => p.output === 'SCRIPT.md' && p.capability === 'text.generate')).toBe(
      true,
    );
  });

  it('script with refine writes one ReviewRound per round and a summary', async () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    setVideoConfig(c.dir, 'advanced.refine', true);
    const text = stubText({ gen: [BODY, BODY], scores: [6, 9] });
    const step = {
      id: 'script',
      uses: 'script',
      title: 'K',
      params: { mode: 'narration' },
      refine: { enabled: true, rubric: 'script-default', min_rounds: 2, max_rounds: 2 },
    } as StepDecl;
    const out = await scriptExecutor({ text })(ctxFor(c.dir, step));
    expect(out.refine).toEqual({ rounds: 2, final_score: 9 });
    expect(out.summary).toMatch(/Vòng 1: 6\.0 .*Vòng 2: 9\.0/);
    expect(out.summary).toContain('critic cùng hãng');
    const r2 = JSON.parse(
      readFileSync(`${c.dir}/videos/${fixtureVideoId}/reviews/script/round-2.json`, 'utf8'),
    );
    expect(r2).toMatchObject({
      round: 2,
      score: 9,
      producer: { provider: 'text.claude', model: 'p' },
      critic: { model: 'c' },
    });
    expect(text.prompts[1]).toContain('Sửa bản nháp');
  });

  it('085: refine in the manifest but advanced.refine off → one draft, no critic; a failed check gets one fix', async () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    // bản nháp đầu có beat rỗng (kiểm beat trượt) → một lần sửa bằng producer với lỗi đó
    const text = stubText({
      gen: ['## Mở đầu <!-- sf:beat -->\n\nBeat này chưa có line nào.\n', BODY],
    });
    const step = {
      id: 'script',
      uses: 'script',
      title: 'K',
      params: { mode: 'narration' },
      refine: { enabled: true, rubric: 'script-default' },
    } as StepDecl;
    const out = await scriptExecutor({ text })(ctxFor(c.dir, step));
    expect(out).toEqual({ outputs: ['SCRIPT.md'] });
    expect(text.reviews()).toBe(0);
    expect(text.prompts).toHaveLength(2);
    expect(text.prompts[1]).toContain('Sửa bản nháp');
    const script = readFileSync(`${c.dir}/videos/${fixtureVideoId}/SCRIPT.md`, 'utf8');
    expect(validateArtifact(`videos/${fixtureVideoId}/SCRIPT.md`, script).errors).toEqual([]);
  });

  it('085: draft that passes the checks costs exactly one call', async () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const text = stubText({ gen: [BODY] });
    await scriptExecutor({ text })(
      ctxFor(c.dir, {
        id: 'script',
        uses: 'script',
        title: 'K',
        params: { mode: 'narration' },
        refine: { enabled: true, rubric: 'script-default' },
      } as StepDecl),
    );
    expect(text.prompts).toHaveLength(1);
    expect(text.reviews()).toBe(0);
  });

  it('085: publish-meta reads only the SRT and the channel, with the aux model', async () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const text = stubText({
      gen: ['{"title": "Năm 1428", "description": "Lê Lợi.", "tags": ["lịch sử"]}'],
    });
    await publishMetaExecutor({ text })(
      ctxFor(c.dir, {
        id: 'meta',
        uses: 'publish-meta',
        title: 'M',
        refine: { enabled: true, rubric: 'meta-default' },
      } as StepDecl),
    );
    expect(text.roles).toEqual(['aux']);
    expect(text.reviews()).toBe(0);
    const prompt = text.prompts[0]!;
    expect(prompt).toMatch(/00:00:00,000 --> 00:00:01,300/);
    expect(prompt).toContain('Sử Việt');
    // không đọc brief
    expect(prompt).not.toContain('Khán giả: người yêu sử');
  });

  it('publish-meta writes publish.md with chapters from SCRIPT.md beats', async () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const text = stubText({
      gen: [
        '{"title": "Vì sao trời xanh?", "description": "Giải thích tán xạ.", "tags": ["khoa học"]}',
      ],
    });
    const out = await publishMetaExecutor({ text })(
      ctxFor(c.dir, { id: 'meta', uses: 'publish-meta', title: 'M' }),
    );
    expect(out.outputs).toEqual(['publish.md']);
    const doc = readFileSync(`${c.dir}/videos/${fixtureVideoId}/publish.md`, 'utf8');
    expect(validateArtifact(`videos/${fixtureVideoId}/publish.md`, doc).errors).toEqual([]);
    expect(doc).toContain('Vì sao trời xanh?');
    expect(doc).toMatch(/chapters: \[\{"start_ms":0,/);
  });

  it('declined budget question cancels the step with E_BUDGET_EXCEEDED', async () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const store = new WriteStore(c.dir);
    const rel = `videos/${fixtureVideoId}/state.json`;
    const st = JSON.parse(readFileSync(store.abs(rel), 'utf8'));
    st.budget.tokens_used = 10_000_000;
    store.write(rel, JSON.stringify(st), { by: 'test' });
    const permissions = { ask: async () => false } as never;
    await expect(
      scriptExecutor({ text: stubText({ gen: [BODY] }), permissions })(
        ctxFor(c.dir, { id: 'script', uses: 'script', title: 'K' }),
      ),
    ).rejects.toMatchObject({ code: 'E_BUDGET_EXCEEDED' });
  });

  it('stripWrapping removes fences and front matter', () => {
    expect(stripWrapping('```md\n---\na: 1\n---\nX\n```')).toBe('X\n');
    // tiêu đề beat sai cấp được đưa về `##`
    expect(
      stripWrapping('# Mở đầu <!-- sf:beat id=bt_aaaaaaaa -->\n### Kết <!-- sf:beat -->'),
    ).toBe('## Mở đầu <!-- sf:beat id=bt_aaaaaaaa -->\n## Kết <!-- sf:beat -->\n');
  });
});
