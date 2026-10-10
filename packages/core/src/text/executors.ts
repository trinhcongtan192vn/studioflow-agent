import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  CaptionGroups,
  CaptionOverrides,
  Provenance,
  ReviewRound,
  Rubric,
  StepState,
} from '../contracts/types.js';
import { captionsToSrt } from '../publish/youtube-meta.js';
import { resolveConfig } from '../config/resolve.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { assignScriptIds } from '../domain/markdown/script.js';
import { validateArtifact } from '../domain/validate.js';
import { SfError } from '../errors.js';
import type { PermissionBus } from '../gateway/permission.js';
import { CORE_VERSION } from '../version.js';
import type { StepRunContext } from '../workflow/engine.js';
import { castSpeakers } from '../workflow/cast.js';
import { beatDurations, timingOf } from '../workflow/duration.js';
import { parseScript, toScriptDoc } from '../domain/markdown/script.js';
import { assertDifferentModels, type ModelRef } from './models.js';
import { checkMeta, checkScript, objectiveContext, type ObjectiveResult } from './objectives.js';
import { buildPrompt, loadPromptPack, type PromptVars } from './prompts.js';
import {
  refineProgress,
  refineSummary,
  runRefine,
  type Issue,
  type RefineResult,
} from './refine.js';
import { loadRubric, rubricShort } from './rubrics.js';
import { extractJson, type CallScope, type TextService } from './service.js';

/** Không có thời lượng trong `BRIEF.md` → gợi ý 2 phút cho prompt (không phải gate). */
const DEFAULT_TARGET_MS = 120_000;

/** Thời lượng dạng chữ cho prompt: `45 giây`, `8 phút`, `3 phút 30 giây`. */
export function durationText(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return [m ? `${m} phút` : '', sec || !m ? `${sec} giây` : ''].filter(Boolean).join(' ');
}

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
  // 080: model chép lại khung prompt sửa (`# Brief` … `# Bản nháp` … `# Vấn đề cần sửa`) → chỉ giữ bản nháp
  const draft = /^#[ \t]+Bản nháp[ \t]*$/m.exec(t);
  if (draft) t = t.slice(draft.index + draft[0].length).trim();
  const issues = /^#[ \t]+Vấn đề cần sửa[ \t]*$/m.exec(t);
  if (issues) t = t.slice(0, issues.index).trim();
  // tiêu đề beat sai cấp (`#`, `###`…) → `##` theo D3 (lỗi định dạng thường gặp của producer)
  // 036: marker beat viết trên dòng riêng (trước hoặc ngay sau tiêu đề) → gắn vào cuối tiêu đề
  t = t.replace(
    /^(<!--\s*sf:beat\b[^>]*-->)[ \t]*\n(#{1,6}[ \t]+[^\n]*?)[ \t]*$/gm,
    (_m, mk: string, h: string) => `${h} ${mk}`,
  );
  t = t.replace(
    /^(#{1,6}[ \t]+(?:(?!<!--)[^\n])*?)[ \t]*\n(<!--\s*sf:beat\b[^>]*-->)[ \t]*$/gm,
    (_m, h: string, mk: string) => `${h} ${mk}`,
  );
  t = t.replace(/^#{1,6}(\s+.*<!--\s*sf:beat\b)/gm, '##$1');
  // 042: marker `sf:` producer tự đặt (ví dụ `sf:visual text="…"`) → chú thích thường, giữ gợi ý
  t = t.replace(
    /<!--\s*sf:(?!beat\b|line\b|tts\b)([\w-]+)\s*(?:text="([^"]*)"|([^>]*?))\s*-->/g,
    (_m, kind: string, text?: string, rest?: string) =>
      `<!-- ${kind}: ${(text ?? rest ?? '').trim()} -->`,
  );
  return `${t}\n`;
}

const bodyOf = (doc: string) => stripWrapping(doc);
const issuesText = (issues: Issue[]) =>
  issues
    .map((i) => `- [${i.severity}]${i.location ? ` (${i.location})` : ''} ${i.text}`)
    .join('\n');

export interface StepEnv {
  ctx: StepRunContext;
  v: string;
  read(rel: string): string;
  brief: string;
  language: string;
  targetMs: number | null;
  scope: CallScope;
  cfg(key: string): unknown;
}

export function stepEnv(ctx: StepRunContext): StepEnv {
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

export interface Plan {
  enabled: boolean;
  rubric?: Rubric;
  min: number;
  max: number;
  threshold: number;
  sameVendor: boolean;
  /** Vai gọi `text.generate`: `primary` (producer) hoặc `aux` (085: tiêu đề/mô tả). */
  role: 'primary' | 'aux';
  producer: ModelRef;
  critic: ModelRef;
  producedBy?: ModelRef;
}

/** 085: bước có `refine` trong manifest chỉ chạy vòng viết–chấm–sửa khi `advanced.refine` bật. */
export function refineEnabled(
  step: { refine?: { enabled?: boolean } },
  cfg: (key: string) => unknown,
): boolean {
  return Boolean(step.refine?.enabled) && cfg('advanced.refine') === true;
}

export function refinePlan(
  env: StepEnv,
  text: TextService,
  packDir: string | undefined,
  defaultRubric: string,
  role: 'primary' | 'aux' = 'primary',
): Plan {
  const r = env.ctx.step.refine;
  const m = text.models(env.scope);
  // 085: refine là tính năng nâng cao — manifest bật VÀ `advanced.refine` bật
  const enabled = refineEnabled(env.ctx.step, env.cfg);
  const producer = role === 'aux' ? m.aux : m.producer;
  const same = enabled ? assertDifferentModels(producer, m.critic).sameVendor : false;
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
    role,
    producer,
    critic: m.critic,
  };
}

/** Ngân sách video (D6 4.1): ước lượng mỗi vòng; thiếu → hỏi; cạn giữa chừng → `incomplete`. */
export async function budgetGuard(
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
  const prov = (ref: ModelRef, actual: string) =>
    actual.startsWith('codex/')
      ? { provider: 'text.codex', model: actual.slice(6) }
      : { provider: `text.${ref.provider}`, model: actual || ref.model };
  for (const x of r.rounds) {
    const doc: ReviewRound = {
      schema_version: 1,
      step_id: env.ctx.step.id,
      round: x.round,
      artifact,
      draft_hash: sha256(x.draft),
      producer: prov(plan.producer, x.producer_model),
      critic: prov(plan.critic, x.critic_model),
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
  const producedBy = plan.producedBy ?? plan.producer;
  const p: Provenance = {
    schema_version: 1,
    output: artifact,
    output_hash: hash,
    capability: 'text.generate',
    provider: `text.${producedBy.provider}`,
    provider_version: CORE_VERSION,
    model: { id: producedBy.model },
    params,
    inputs: [{ path: 'BRIEF.md', hash: briefHash, role: 'brief' }],
    cache_key: sha256(canonicalJson({ params, brief: briefHash, model: producedBy })),
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
    targetMs: number | null;
  },
): Promise<RefineResult> {
  const vars = (over: Partial<PromptVars> = {}): PromptVars => ({
    brief: env.brief,
    target_duration: o.targetMs ? durationText(o.targetMs) : '',
    language: env.language,
    rubric_short: plan.rubric ? rubricShort(plan.rubric) : '',
    issues: '',
    draft: '',
    ...over,
  });
  const gen = async (content: string) => {
    const result = await d.text.generate(
      plan.role,
      { role: plan.role, messages: [{ role: 'user', content }], max_tokens: o.maxTokens },
      env.scope,
    );
    plan.producedBy = result.model.startsWith('codex/')
      ? { provider: 'codex', model: result.model.slice(6) }
      : { provider: plan.producer.provider, model: result.model || plan.producer.model };
    return result;
  };
  const first = o.prompt(vars());
  const perRound = Math.ceil(first.length / 3) * 2 + o.maxTokens * 2;
  const canSpend = await budgetGuard(env, perRound, plan.min, d.permissions);
  if (!plan.enabled) {
    // 085: một bản nháp + kiểm khách quan trên máy; trượt → một lần sửa với đúng các lỗi đó (không critic)
    let draft = o.normalize((await gen(first)).text);
    const failed = o.checks(draft).filter((c) => !c.pass);
    if (failed.length) {
      env.ctx.progress?.(1, 2, 'Sửa lỗi định dạng của bản nháp');
      const issues: Issue[] = failed.map((c) => ({
        severity: 'major',
        text: `Kiểm ${c.id} chưa qua${c.detail ? `: ${c.detail}` : ''}`,
      }));
      const previousProducer = plan.producedBy;
      const fixed = o.normalize(
        (await gen(o.revisePrompt(vars({ draft: bodyOf(draft), issues: issuesText(issues) }))))
          .text,
      );
      if (o.checks(fixed).filter((c) => !c.pass).length <= failed.length) draft = fixed;
      else plan.producedBy = previousProducer;
    }
    return { draft, rounds: [], final_score: 0, incomplete: false };
  }
  return runRefine({
    onPhase: (p) => {
      const r = refineProgress(p);
      env.ctx.progress?.(r.done, r.total, r.message);
    },
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

export function finish(
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
    // chỉ thời lượng mục tiêu; độ dài thật kiểm trên audio sau bước `voice` (D6 4.2 `audio_duration`)
    const targetMs = env.targetMs ?? DEFAULT_TARGET_MS;
    const maxTokens = Math.max(2000, Math.round((targetMs / 1000) * 15));
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
        targetMs,
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
    const octx = {
      ...objectiveContext(ctx.channelDir, ctx.videoId, (rel) => env.read(rel), ctx.appDataDir),
      // 036: kịch bản thoại chỉ dùng người nói có trong dàn nhân vật
      ...(mode === 'screenplay' ? { speakers: castSpeakers(ctx.channelDir, ctx.videoId) } : {}),
    };
    // 030: shorts cắt từ video dài — kịch bản nguồn (chỉ đọc) kèm chỉ dẫn giữ nguyên chữ line dùng lại
    const source = parseBlocksDoc(env.read(`${env.v}/BRIEF.md`)).front.source_video_id as
      string | null | undefined;
    const sourceScript =
      source && existsSync(ctx.store.abs(`videos/${source}/SCRIPT.md`))
        ? `\n\n# Kịch bản video nguồn (${source}) — cắt từ đây\nGiữ NGUYÊN VĂN chữ của các line dùng lại (để dùng lại audio đã đọc); chỉ viết mới câu mở (hook) và câu kết nếu cần. Không chép ID line/beat của video nguồn.\n\n${bodyOf(
            env.read(`videos/${source}/SCRIPT.md`),
          ).replace(/\s+id=(ln|bt)_[0-9a-z]{8}/g, '')}`
        : '';
    const extra =
      (mode === 'screenplay' && existsSync(ctx.store.abs(`${env.v}/STORY.md`))
        ? `\n\n# Dàn ý (STORY.md)\n${bodyOf(env.read(`${env.v}/STORY.md`))}`
        : '') + sourceScript;
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
      targetMs,
    });
    return finish(env, 'SCRIPT.md', plan, r, { mode });
  };
}

/**
 * Chương theo beat, mốc lấy từ audio thật (`audio_meta.json`; bước `meta` chạy sau `voice`). Đã có
 * timeline (`frame_timing`) → mốc tuyệt đối của line đầu beat trên video (029: chương khớp mốc beat).
 */
function chapters(env: StepEnv): { start_ms: number; title: string }[] {
  const beats = beatDurations(env.ctx.store, env.ctx.videoId);
  const timing = timingOf(env.ctx.store, env.ctx.videoId);
  const scriptF = env.ctx.store.abs(`${env.v}/SCRIPT.md`);
  const firstLine = new Map<string, string>();
  if (timing && existsSync(scriptF))
    for (const b of toScriptDoc(parseScript(readFileSync(scriptF, 'utf8'))).beats)
      if (b.line_ids[0]) firstLine.set(b.id, b.line_ids[0]);
  return beats.map((b) => {
    const at = timing?.lines.find((l) => l.id === firstLine.get(b.beat_id))?.start_ms;
    return { start_ms: at ?? b.start_ms, title: b.title };
  });
}

/** Đọc JSON nếu có, lỗi/thiếu → undefined. */
function readJson<T>(file: string): T | undefined {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 085: phụ đề SRT của video (lời đọc kèm mốc thời gian) từ `caption_groups.json` + bản sửa tay; chưa có
 * phụ đề → lời đọc trong `SCRIPT.md` (không mốc).
 */
export function videoSrt(env: StepEnv): string {
  const abs = (f: string) => env.ctx.store.abs(`${env.v}/${f}`);
  const srt = captionsToSrt(
    readJson<CaptionGroups>(abs('caption_groups.json')),
    readJson<CaptionOverrides>(abs('caption-overrides.json')),
  );
  if (srt) return srt;
  if (!existsSync(abs('SCRIPT.md'))) return '';
  const doc = parseScript(env.read(`${env.v}/SCRIPT.md`));
  return doc.lines.map((l) => l.text).join('\n');
}

const CHANNEL_NOTE_MAX = 1500;

/** 085: thông tin kênh cho tiêu đề/mô tả: tên, ngôn ngữ, chủ đề trụ cột, style guide, sở thích. */
export function channelContext(env: StepEnv): string {
  const ch =
    readJson<{ name?: string; language?: string }>(path.join(env.ctx.channelDir, 'channel.json')) ??
    {};
  const pillars = (env.cfg('autopilot.pillars') as string[] | null) ?? [];
  const note = (f: string) => {
    const file = path.join(env.ctx.channelDir, 'profile', 'references', f);
    if (!existsSync(file)) return '';
    const t = readFileSync(file, 'utf8').trim();
    return t.length > CHANNEL_NOTE_MAX ? `${t.slice(0, CHANNEL_NOTE_MAX)}…` : t;
  };
  return [
    `Tên kênh: ${ch.name ?? ''}`,
    `Ngôn ngữ: ${ch.language ?? env.language}`,
    ...(pillars.length ? [`Chủ đề trụ cột: ${pillars.join(', ')}`] : []),
    note('style-guide.md'),
    note('preferences.md'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Executor bước `publish-meta` (D6 mục 2): tiêu đề/mô tả/thẻ/chương → `publish.md`. */
export function publishMetaExecutor(d: TextExecutorDeps) {
  return async (ctx: StepRunContext): Promise<TextStepResult> => {
    // 085: chỉ phụ đề SRT + thông tin kênh (không brief/storyboard), model aux
    const env = { ...stepEnv(ctx) };
    env.brief = channelContext(env);
    const plan = refinePlan(env, d.text, ctx.packDir, 'meta-default', 'aux');
    const pack = loadPromptPack(ctx.channelDir);
    const scope = { channelDir: ctx.channelDir, videoId: ctx.videoId, appDataDir: ctx.appDataDir };
    const srt = videoSrt(env);
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
      // `meta.hashtags` (030: shorts → #shorts) thêm cuối mô tả nếu chưa có
      const hashtags = (env.cfg('meta.hashtags') as string[] | null) ?? [];
      const missing = hashtags.filter((h) => !m.description.includes(h));
      const desc = m.description.trim() + (missing.length ? `\n\n${missing.join(' ')}` : '');
      return `---\n${Object.entries(front)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join('\n')}\n---\n${desc}\n`;
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
      prompt: (v) =>
        buildPrompt(
          pack,
          'description',
          { ...v, draft: srt, ...({ srt, channel: env.brief } as object) } as PromptVars,
          scope,
        ).text,
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
      targetMs: null,
    });
    return finish(env, 'publish.md', plan, r);
  };
}
