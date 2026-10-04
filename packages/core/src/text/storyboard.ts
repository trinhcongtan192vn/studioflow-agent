import { readFileSync } from 'node:fs';
import { sessionOptionsFor } from '../agent/options.js';
import type { AgentRuntime, SessionContext, TextGenerateOutput } from '../contracts/types.js';
import { crossCheckVideo } from '../domain/crossref.js';
import { newId } from '../domain/ids.js';
import { parseStoryboard, toStoryboardDoc } from '../domain/markdown/storyboard.js';
import { validateArtifact } from '../domain/validate.js';
import { SfError } from '../errors.js';
import type { Gateway } from '../gateway/gateway.js';
import type { PermissionBus } from '../gateway/permission.js';
import type { StepRunContext } from '../workflow/engine.js';
import { budgetGuard, finish, refinePlan, stepEnv, type TextStepResult } from './executors.js';
import type { ObjectiveResult } from './objectives.js';
import { runRefine, type Issue } from './refine.js';
import type { TextService } from './service.js';

export interface StoryboardDeps {
  text: TextService;
  gateway: Gateway;
  runtime: () => AgentRuntime | undefined;
  permissions?: PermissionBus;
}

const ARTIFACT = 'STORYBOARD.md';

/** Kiểm khách quan của storyboard (D6 4.2): `schema` + `coverage` (mỗi line đúng một frame, frame có layer). */
export function checkStoryboard(
  store: StepRunContext['store'],
  videoId: string,
  content: string,
): ObjectiveResult[] {
  const schema = validateArtifact(`videos/${videoId}/${ARTIFACT}`, content);
  if (!schema.valid)
    return [
      {
        id: 'schema',
        pass: false,
        detail: schema.errors
          .slice(0, 3)
          .map((e) => e.message)
          .join('; '),
      },
    ];
  const cross = crossCheckVideo(store.root, videoId, { [ARTIFACT]: content }).filter((e) =>
    /frame|line/.test(e.message),
  );
  const empty = toStoryboardDoc(parseStoryboard(content), { loose: true }).frames.filter(
    (f) => !(f.layers?.length > 0),
  );
  const problems = [
    ...cross.map((e) => e.message),
    ...empty.map((f) => `frame ${f.id} has no layer`),
  ];
  return [
    { id: 'schema', pass: true },
    {
      id: 'coverage',
      pass: problems.length === 0,
      ...(problems.length ? { detail: problems.slice(0, 5).join('; ') } : {}),
    },
  ];
}

const issuesText = (issues: Issue[]) =>
  issues
    .map((i) => `- [${i.severity}]${i.location ? ` (${i.location})` : ''} ${i.text}`)
    .join('\n');

/**
 * Executor bước `storyboard` (D6 mục 2, 4.1; 023 FR-SC-07): không refine → phiên `main` theo skill (như
 * M1); refine → mỗi vòng một phiên `producer` mới (D5: một vòng, không lịch sử) viết `STORYBOARD.md`,
 * critic `text.review`, kiểm `schema`/`coverage`; ghi vòng + tóm tắt như 009.
 */
export function storyboardExecutor(d: StoryboardDeps) {
  return async (ctx: StepRunContext): Promise<TextStepResult> => {
    const env = stepEnv(ctx);
    const plan = refinePlan(env, d.text, ctx.packDir, 'storyboard-default');
    if (!plan.enabled) {
      if (!ctx.agent) throw new SfError('E_STEP_INCOMPLETE', 'storyboard needs an agent session');
      const out = await ctx.agent();
      return { outputs: out?.length ? out : [ARTIFACT] };
    }
    const runtime = d.runtime();
    if (!runtime || !ctx.waitComplete || !ctx.instruction)
      throw new SfError(
        'E_STEP_INCOMPLETE',
        `step ${ctx.step.id} needs an agent runtime for producer sessions`,
      );
    const read = () => readFileSync(ctx.store.abs(`${env.v}/${ARTIFACT}`), 'utf8');
    /** Một vòng sản xuất: phiên `producer` mới, chờ báo xong bước, đọc bản nháp. */
    const round = async (issues: Issue[]): Promise<TextGenerateOutput> => {
      const context: SessionContext = {
        session_id: newId('ss') as SessionContext['session_id'],
        kind: 'producer',
        channel_dir: ctx.channelDir,
        video_id: ctx.videoId as SessionContext['video_id'],
        allowed_paths: [ARTIFACT],
      };
      const done = ctx.waitComplete!();
      let reported = false;
      void done.then(() => (reported = true));
      const session = await runtime.openSession(
        sessionOptionsFor(
          'producer',
          context,
          d.gateway,
          ctx.packDir ? { plugins: [ctx.packDir] } : {},
        ),
      );
      let error: string | undefined;
      try {
        const extra = issues.length
          ? `Đây là vòng sửa: STORYBOARD.md hiện có cần sửa theo các vấn đề sau (giữ nguyên mọi id đã có):\n${issuesText(issues)}`
          : undefined;
        for await (const e of session.send({ text: ctx.instruction!(extra) }))
          if (e.type === 'error') error = `${e.code}: ${e.message}`;
      } finally {
        await session.close();
      }
      await Promise.race([done, new Promise((r) => setTimeout(r, 50))]);
      if (!reported)
        throw new SfError(
          'E_STEP_INCOMPLETE',
          `producer session did not complete step ${ctx.step.id}${error ? ` (${error})` : ''}`,
        );
      return { text: read(), usage: { input: 0, output: 0 }, cost_usd: 0, model: 'agent:producer' };
    };
    // ngân sách: mỗi vòng ~ một lần chấm của critic trên storyboard (producer tính theo gói Claude)
    const perRound = Math.ceil((existsLen(ctx) + 4000) / 3) * 2;
    const canSpend = await budgetGuard(env, perRound, plan.min, d.permissions);
    const r = await runRefine({
      min: plan.min,
      max: plan.max,
      threshold: plan.threshold,
      produce: () => round([]),
      revise: (_draft, issues) => round(issues),
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
      checks: (draft) => checkStoryboard(ctx.store, ctx.videoId, draft),
      canSpend,
    });
    return finish(env, ARTIFACT, plan, r);
  };
}

/** Độ dài kịch bản làm cơ sở ước lượng token của critic. */
function existsLen(ctx: StepRunContext): number {
  try {
    return readFileSync(ctx.store.abs(`videos/${ctx.videoId}/SCRIPT.md`), 'utf8').length;
  } catch {
    return 0;
  }
}
