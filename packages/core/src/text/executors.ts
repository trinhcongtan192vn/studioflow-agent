import { existsSync, readFileSync } from 'node:fs';
import type { Provenance, ReviewRound, Rubric, StepState } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { assignScriptIds, parseScript, toScriptDoc } from '../domain/markdown/script.js';
import { validateArtifact } from '../domain/validate.js';
import { SfError } from '../errors.js';
import type { PermissionBus } from '../gateway/permission.js';
import { readingRate } from '../tts/rate.js';
import { CORE_VERSION } from '../version.js';
import type { StepRunContext } from '../workflow/engine.js';
import { assertDifferentModels, type ModelRef } from './models.js';
import { checkMeta, checkScript, objectiveContext, type ObjectiveResult } from './objectives.js';
import { buildPrompt, loadPromptPack, type PromptVars } from './prompts.js';
import { refineSummary, runRefine, type Issue, type RefineResult } from './refine.js';
import { loadRubric, rubricShort } from './rubrics.js';
import { extractJson, type CallScope, type TextService } from './service.js';

export interface TextStepResult {
  outputs: string[];
  summary?: string;
  refine?: StepState['refine'];
}

export interface TextExecutorDeps {
  text: TextService;
  permissions?: PermissionBus;
}

/** Bỏ rào ``` và front matter nếu producer lỡ trả kèm. */
export function stripWrapping(text: string): string {
  let t = text.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(t);
  if (fence) t = fence[1]!.trim();
  if (t.startsWith('---\n')) {
    const end = t.indexOf('\n---', 4);
    if (end > 0) t = t.slice(end + 4).trim();
  }
  return `${t}\n`;
}

const bodyOf = (doc: string) => stripWrapping(doc);
const issuesText = (issues: Issue[]) =>
  issues
    .map((i) => `- [${i.severity}]${i.location ? ` (${i.location})` : ''} ${i.text}`)
    .join('\n');

interface StepEnv {
  ctx: StepRunContext;
  v: string;
  read(rel: string): string;
  brief: string;
  language: string;
  targetMs: number | null;
  scope: CallScope;
  cfg(key: string): unknown;
}

function stepEnv(ctx: StepRunContext): StepEnv {
  const v = `videos/${ctx.videoId}`;
  const read = (rel: string) => readFileSync(ctx.store.abs(rel), 'utf8');
  const b = parseBlocksDoc(read(`${v}/BRIEF.md`));
  const front = b.front as {
    language?: string;
    target_duration_ms?: number | null;
    title_working?: string;
  };
  const brief = [
    ...(front.title_working ? [`Tiêu đề tạm: ${front.title_working}`] : []),
    b.body
      .join('\n')
      .replace(/^# Brief\s*/m, '')
      .trim(),
    ...(ctx.note ? [`Yêu cầu sửa của người dùng: ${ctx.note}`] : []),
  ]
    .filter(Boolean)
    .join('\n');
  return {
    ctx,
    v,
    read,
    brief,
    language: front.language ?? 'vi',
    targetMs: front.target_duration_ms ?? null,
    scope: { store: ctx.store, videoId: ctx.videoId },
    cfg: (key) =>
      resolveConfig(
        key,
        { channelDir: ctx.channelDir, videoId: ctx.videoId },
        { appDataDir: ctx.appDataDir },
      ).value,
  };
}

interface Plan {
  enabled: boolean;
  rubric?: Rubric;
  min: number;
  max: number;
  threshold: number;
  sameVendor: boolean;
  producer: ModelRef;
  critic: ModelRef;
}

function refinePlan(
  env: StepEnv,
  text: TextService,
  packDir: string | undefined,
  defaultRubric: string,
): Plan {
  const r = env.ctx.step.refine;
  const m = text.models(env.scope);
  const enabled = Boolean(r?.enabled);
  const same = enabled ? assertDifferentModels(m.producer, m.critic).sameVendor : false;
  return {
    enabled,
    ...(enabled
      ? {
          rubric: loadRubric(r?.rubric ?? defaultRubric, {
            channelDir: env.ctx.channelDir,
            ...(packDir ? { packDir } : {}),
          }),
        }
      : {}),
    min: enabled ? (r?.min_rounds ?? Number(env.cfg('refine.min_rounds'))) : 1,
    max: enabled ? (r?.max_rounds ?? Number(env.cfg('refine.max_rounds'))) : 1,
    threshold: r?.threshold ?? Number(env.cfg('refine.threshold')),
    sameVendor: same,
    producer: m.producer,
    critic: m.critic,
  };
}

/** Ngân sách video (D6 4.1): ước lượng mỗi vòng; thiếu → hỏi; cạn giữa chừng → `incomplete`. */
async function budgetGuard(
  env: StepEnv,
  perRound: number,
  rounds: number,
  permissions?: PermissionBus,
): Promise<() => boolean> {
  const limit = Number(env.cfg('budget.tokens_per_video'));
  const costLimit = Number(env.cfg('budget.api_cost_usd_per_video'));
  const used = () =>
    (
      JSON.parse(env.read(`${env.v}/state.json`)) as {
        budget: { tokens_used: number; api_cost_usd: number };
      }
    ).budget;
  const fits = (n: number) => {
    const b = used();
    return (
      (!limit || b.tokens_used + perRound * n <= limit) &&
      (!costLimit || b.api_cost_usd < costLimit)
    );
  };
  let override = false;
  if (!fits(rounds)) {
    const ok = permissions
      ? await permissions.ask(
          {
            session_id: 'ss_workflow',
            kind: 'main',
            channel_dir: env.ctx.channelDir,
            video_id: env.ctx.videoId as never,
          },
          {
            tool: 'workflow',
            kind: 'paid_api',
            summary: `Bước ${env.ctx.step.id}: ${rounds} vòng ước ~${perRound * rounds} token vượt ngân sách video (${used().tokens_used}/${limit})`,
          },
        )
      : false;
    if (!ok)
      throw new SfError(
        'E_BUDGET_EXCEEDED',
        `step ${env.ctx.step.id} needs ~${perRound * rounds} tokens beyond the video budget`,
      );
    override = true;
  }
  return () => override || fits(1);
}

function writeRounds(env: StepEnv, artifact: string, plan: Plan, r: RefineResult): void {
  const prov = (ref: ModelRef) => ({ provider: `text.${ref.provider}`, model: ref.model });
  for (const x of r.rounds) {
    const doc: ReviewRound = {
      schema_version: 1,
      step_id: env.ctx.step.id,
      round: x.round,
      artifact,
      draft_hash: sha256(x.draft),
      producer: { ...prov(plan.producer), model: x.producer_model || plan.producer.model },
      critic: { ...prov(plan.critic), model: x.critic_model || plan.critic.model },
      objective_checks: x.objective_checks,
      score: x.score,
      criteria: x.criteria,
      issues: x.issues.map((i) => {
        const later = r.rounds.find(
          (y) => y.round > x.round && !y.issues.some((j) => j.text === i.text),
        );
        return later && x.round < r.rounds.length ? { ...i, fixed_in_round: later.round } : i;
      }),
      tokens: x.tokens,
      cost_usd: x.cost_usd,
      created_at: new Date().toISOString(),
    } as ReviewRound;
    env.ctx.store.write(
      `${env.v}/reviews/${env.ctx.step.id}/round-${x.round}.json`,
      `${JSON.stringify(doc, null, 2)}\n`,
      { by: 'refine' },
    );
  }
}

function writeProvenance(
  env: StepEnv,
  artifact: string,
  content: string,
  plan: Plan,
  extra: Record<string, unknown>,
): void {
  const hash = sha256(content);
  const briefHash = sha256(env.read(`${env.v}/BRIEF.md`));
  const params = { step: env.ctx.step.id, ...(env.ctx.step.params ?? {}), ...extra };
  const p: Provenance = {
    schema_version: 1,
    output: artifact,
    output_hash: hash,
    capability: 'text.generate',
    provider: `text.${plan.producer.provider}`,
    provider_version: CORE_VERSION,
    model: { id: plan.producer.model },
    params,
    inputs: [{ path: 'BRIEF.md', hash: briefHash, role: 'brief' }],
    cache_key: sha256(canonicalJson({ params, brief: briefHash, model: plan.producer })),
    from_cache: false,
    source: { kind: 'generated' },
    created_at: new Date().toISOString(),
  } as Provenance;
  env.ctx.store.write(
    `${env.v}/provenance/${hash.slice(0, 12)}.json`,
    `${JSON.stringify(p, null, 2)}\n`,
    { by: 'provenance' },
  );
}

async function refineText(
  env: StepEnv,
  d: TextExecutorDeps,
  plan: Plan,
  o: {
    prompt: (vars: PromptVars) => string;
    revisePrompt: (vars: PromptVars) => string;
    normalize: (draft: string) => string;
    checks: (draft: string) => ObjectiveResult[];
    maxTokens: number;
    targetWords: number;
  },
): Promise<RefineResult> {
  const vars = (over: Partial<PromptVars> = {}): PromptVars => ({
    brief: env.brief,
    target_words: o.targetWords,
    language: env.language,
    rubric_short: plan.rubric ? rubricShort(plan.rubric) : '',
    issues: '',
    draft: '',
    ...over,
  });
  const gen = (content: string) =>
    d.text.generate(
      'primary',
      { role: 'primary', messages: [{ role: 'user', content }], max_tokens: o.maxTokens },
      env.scope,
    );
  const first = o.prompt(vars());
  const perRound = Math.ceil(first.length / 3) * 2 + o.maxTokens * 2;
  const canSpend = await budgetGuard(env, perRound, plan.min, d.permissions);
  if (!plan.enabled) {
    const g = await gen(first);
    const draft = o.normalize(g.text);
    return { draft, rounds: [], final_score: 0, incomplete: false };
  }
  return runRefine({
    min: plan.min,
    max: plan.max,
    threshold: plan.threshold,
    produce: () => gen(first),
    revise: (draft, issues) =>
      gen(o.revisePrompt(vars({ draft: bodyOf(draft), issues: issuesText(issues) }))),
    review: (draft, prior) =>
      d.text.review(
        {
          artifact_text: draft,
          rubric: plan.rubric!,
          brief: env.brief,
          ...(prior.length ? { prior_issues: prior } : {}),
        },
        { ...env.scope, critic: plan.critic },
      ),
    checks: o.checks,
    canSpend,
    normalize: o.normalize,
  });
}

function finish(
  env: StepEnv,
  artifact: string,
  plan: Plan,
  r: RefineResult,
  extra: Record<string, unknown> = {},
): TextStepResult {
  env.ctx.store.write(`${env.v}/${artifact}`, r.draft, {
    by: `step.${env.ctx.step.id}`,
    validate: false,
  });
  writeProvenance(env, artifact, r.draft, plan, {
    ...extra,
    ...(plan.enabled ? { rounds: r.rounds.length, final_score: r.final_score } : {}),
  });
  if (!plan.enabled) return { outputs: [artifact] };
  writeRounds(env, artifact, plan, r);
  return {
    outputs: [artifact],
    summary: refineSummary(r, { sameVendor: plan.sameVendor }),
    refine: {
      rounds: r.rounds.length,
      final_score: r.final_score,
      ...(r.incomplete ? { incomplete: true } : {}),
    },
  };
}

/** Executor bước `script` (D6 mục 2; `narration` | `screenplay` → `SCRIPT.md`, `outline` → `STORY.md`). */
export function scriptExecutor(d: TextExecutorDeps) {
  return async (ctx: StepRunContext): Promise<TextStepResult> => {
    const env = stepEnv(ctx);
    const mode = String(ctx.step.params?.mode ?? 'narration');
    const plan = refinePlan(env, d.text, ctx.packDir, 'script-default');
    const pack = loadPromptPack(ctx.channelDir);
    const scope = { channelDir: ctx.channelDir, videoId: ctx.videoId, appDataDir: ctx.appDataDir };
    const wpm = readingRate(ctx.store, ctx.videoId, env.language, ctx.appDataDir);
    const targetWords = env.targetMs ? Math.round((env.targetMs / 60000) * wpm) : 300;
    const maxTokens = Math.max(2000, targetWords * 6);
    if (mode === 'outline') {
      const fm = `---\nschema_version: 1\nvideo_id: ${ctx.videoId}\nstatus: draft\n---\n`;
      const normalize = (t: string) => fm + stripWrapping(t);
      const r = await refineText(env, d, plan, {
        prompt: (v) => buildPrompt(pack, 'outline', v, scope).text,
        revisePrompt: (v) => buildPrompt(pack, 'revise', v, scope).text,
        normalize,
        checks: (t) => {
          const s = validateArtifact(`${env.v}/STORY.md`, t);
          return [
            {
              id: 'schema',
              pass: s.valid,
              ...(s.valid
                ? {}
                : {
                    detail: s.errors
                      .slice(0, 3)
                      .map((e) => e.message)
                      .join('; '),
                  }),
            },
          ];
        },
        maxTokens,
        targetWords,
      });
      return finish(env, 'STORY.md', plan, r, { mode });
    }
    const fm = `---\nschema_version: 1\nvideo_id: ${ctx.videoId}\nlanguage: ${env.language}\nstatus: draft\n---\n`;
    const taken = new Set<string>();
    const normalize = (t: string) => {
      const full = fm + stripWrapping(t);
      try {
        return assignScriptIds(full, taken, { seed: sha256(full) }).text;
      } catch {
        return full;
      }
    };
    const octx = objectiveContext(
      ctx.channelDir,
      ctx.videoId,
      (rel) => env.read(rel),
      ctx.appDataDir,
    );
    const extra =
      mode === 'screenplay' && existsSync(ctx.store.abs(`${env.v}/STORY.md`))
        ? `\n\n# Dàn ý (STORY.md)\n${bodyOf(env.read(`${env.v}/STORY.md`))}`
        : '';
    const r = await refineText(env, d, plan, {
      prompt: (v) =>
        buildPrompt(
          pack,
          mode === 'screenplay' ? 'screenplay' : 'script',
          { ...v, brief: `${v.brief}${extra}` },
          scope,
        ).text,
      revisePrompt: (v) => buildPrompt(pack, 'revise', v, scope).text,
      normalize,
      checks: (t) => checkScript(t, octx),
      maxTokens,
      targetWords,
    });
    return finish(env, 'SCRIPT.md', plan, r, { mode });
  };
}

/** Chương từ beat của `SCRIPT.md`: mốc ước theo số từ / wpm (chưa có audio thật ở bước này). */
function chapters(env: StepEnv): { start_ms: number; title: string }[] {
  const rel = `${env.v}/SCRIPT.md`;
  if (!existsSync(env.ctx.store.abs(rel))) return [];
  const doc = toScriptDoc(parseScript(env.read(rel)));
  const wpm = readingRate(
    env.ctx.store,
    env.ctx.videoId,
    String(doc.front.language),
    env.ctx.appDataDir,
  );
  const byId = new Map(doc.lines.map((l) => [l.id, l]));
  let t = 0;
  return doc.beats.map((b) => {
    const start = Math.round(t);
    for (const id of b.line_ids) {
      const l = byId.get(id);
      if (l)
        t += (l.text.split(/\s+/).filter(Boolean).length / wpm) * 60000 + (l.pause_after_ms ?? 0);
    }
    return { start_ms: start, title: b.title };
  });
}

/** Executor bước `publish-meta` (D6 mục 2): tiêu đề/mô tả/thẻ/chương → `publish.md`. */
export function publishMetaExecutor(d: TextExecutorDeps) {
  return async (ctx: StepRunContext): Promise<TextStepResult> => {
    const env = stepEnv(ctx);
    const plan = refinePlan(env, d.text, ctx.packDir, 'meta-default');
    const pack = loadPromptPack(ctx.channelDir);
    const scope = { channelDir: ctx.channelDir, videoId: ctx.videoId, appDataDir: ctx.appDataDir };
    const script = existsSync(ctx.store.abs(`${env.v}/SCRIPT.md`))
      ? bodyOf(env.read(`${env.v}/SCRIPT.md`))
      : '';
    const octx = objectiveContext(
      ctx.channelDir,
      ctx.videoId,
      (rel) => env.read(rel),
      ctx.appDataDir,
    );
    const chs = chapters(env);
    const parse = (t: string) => {
      const j = extractJson(t) as { title?: unknown; description?: unknown; tags?: unknown };
      return {
        title: String(j.title ?? ''),
        description: String(j.description ?? ''),
        tags: Array.isArray(j.tags) ? j.tags.map(String) : [],
      };
    };
    const render = (m: ReturnType<typeof parse>) => {
      const front = {
        schema_version: 1,
        video_id: ctx.videoId,
        title: m.title,
        tags: m.tags,
        chapters: chs,
        status: 'draft',
      };
      return `---\n${Object.entries(front)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join('\n')}\n---\n${m.description.trim()}\n`;
    };
    const normalize = (t: string) => {
      try {
        return render(parse(t));
      } catch {
        return t;
      }
    };
    const fromDoc = (doc: string) => {
      const b = parseBlocksDoc(doc);
      return {
        title: String(b.front.title ?? ''),
        description: b.body.join('\n').trim(),
        tags: (b.front.tags as string[]) ?? [],
      };
    };
    const r = await refineText(env, d, plan, {
      prompt: (v) => buildPrompt(pack, 'description', { ...v, draft: script }, scope).text,
      revisePrompt: (v) =>
        `${buildPrompt(pack, 'revise', v, scope).text}\n\nTrả về đúng một JSON {"title": "...", "description": "...", "tags": ["..."]}.`,
      normalize,
      checks: (t) => {
        const s = validateArtifact(`${env.v}/publish.md`, t);
        if (!s.valid)
          return [
            {
              id: 'schema',
              pass: false,
              detail: s.errors
                .slice(0, 3)
                .map((e) => e.message)
                .join('; '),
            },
          ];
        return [{ id: 'schema', pass: true }, ...checkMeta(fromDoc(t), octx)];
      },
      maxTokens: 2000,
      targetWords: 0,
    });
    return finish(env, 'publish.md', plan, r);
  };
}
