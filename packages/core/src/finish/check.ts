import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AudioMeta } from '../contracts/types.js';
import { canonicalJson } from '../domain/hash.js';
import { loadVideoModel } from '../graph/model.js';
import type { WriteStore } from '../store/writer.js';
import { effectCatalog, frameFinish, normalizeGrading, type MediaEffect } from './grading.js';
import { SfError } from '../errors.js';
import type { StepExecutor } from '../workflow/engine.js';
import { registerObjective } from '../workflow/gates.js';
import { overlayProblems } from './overlays.js';
import { overlayBlocks, stylePack, styleDirs } from './styles.js';

/** FN-common 6: tối đa 2 hiệu ứng nặng (làn multipass) mỗi phút video. */
export const HEAVY_PER_MINUTE = 2;

export interface FinishReport {
  frames: {
    id: string;
    look: string | null;
    pack?: string;
    variant?: string;
    effects: string[];
    heavy: string[];
    overlays: string[];
  }[];
  duration_ms: number;
  heavy_total: number;
  heavy_allowed: number;
  problems: { look: string[]; effects: string[]; overlays: string[] };
}

function videoDurationMs(store: WriteStore, videoId: string): number {
  const v = store.abs(`videos/${videoId}`);
  try {
    const g = JSON.parse(readFileSync(path.join(v, '.sf', 'graph.json'), 'utf8')) as {
      nodes?: Record<string, { meta?: { total_ms?: number } }>;
    };
    const t = g.nodes?.['frame_timing']?.meta?.total_ms;
    if (t) return t;
  } catch {
    /* chưa build */
  }
  const f = path.join(v, 'audio_meta.json');
  if (existsSync(f))
    return (JSON.parse(readFileSync(f, 'utf8')) as AudioMeta).total_duration_ms ?? 0;
  return 0;
}

/**
 * Kiểm phần hoàn thiện của video (027): look của từng frame tìm được gói phong cách; hiệu ứng có trong
 * danh mục; mọi bản vá grading qua `media-treatment --dry-run`; ngân sách hiệu ứng nặng; overlay hợp lệ.
 */
export async function finishReport(
  store: WriteStore,
  videoId: string,
  appDataDir?: string,
): Promise<FinishReport> {
  const model = loadVideoModel(store.root, videoId, appDataDir);
  const needCat = model.frames.some((f) => f.effects?.length);
  const cat: Map<string, MediaEffect> = needCat ? await effectCatalog() : new Map();
  const blocks = overlayBlocks(appDataDir);
  const problems: FinishReport['problems'] = { look: [], effects: [], overlays: [] };
  const frames: FinishReport['frames'] = [];
  const patches = new Map<
    string,
    { patch: Record<string, unknown>; frames: string[]; kind: 'look' | 'effects' }
  >();
  let heavy = 0;
  for (const f of model.frames) {
    const fin = frameFinish(model, f, cat, appDataDir);
    if (fin.look.unknown)
      problems.look.push(`frame ${f.id}: look ${fin.look.look} has no style pack or variant`);
    for (const e of fin.unknown_effects)
      problems.effects.push(`frame ${f.id}: unknown media effect ${e}`);
    heavy += fin.heavy.length;
    for (const [kind, patch] of [
      ['look', fin.lookPatch],
      ['effects', fin.fxPatch],
    ] as const) {
      if (!patch) continue;
      const k = `${kind}:${canonicalJson(patch)}`;
      const p = patches.get(k) ?? { patch, frames: [], kind };
      p.frames.push(f.id);
      patches.set(k, p);
    }
    problems.overlays.push(...overlayProblems(f, blocks));
    frames.push({
      id: f.id,
      look: fin.look.look,
      ...(fin.look.pack ? { pack: fin.look.pack } : {}),
      ...(fin.look.variant ? { variant: fin.look.variant } : {}),
      effects: fin.effects,
      heavy: fin.heavy,
      overlays: (f.overlays ?? []).map((o) => o.block),
    });
  }
  // dry-run mỗi bản vá khác nhau một lần
  for (const p of patches.values()) {
    try {
      await normalizeGrading(p.patch);
    } catch (e) {
      const where = p.frames.join(', ');
      const msg = `frames ${where}: ${(e as Error).message}`;
      problems[p.kind].push(msg);
    }
  }
  const duration = videoDurationMs(store, videoId);
  const allowed = Math.max(HEAVY_PER_MINUTE, Math.floor((duration / 60_000) * HEAVY_PER_MINUTE));
  if (heavy > allowed)
    problems.effects.push(
      `${heavy} heavy (multipass) effects exceed the budget of ${allowed} for ${(duration / 60_000).toFixed(1)} min (${HEAVY_PER_MINUTE}/min)`,
    );
  return {
    frames,
    duration_ms: duration,
    heavy_total: heavy,
    heavy_allowed: allowed,
    problems,
  };
}

/** Danh mục cho agent ở bước look/effects/overlays: look (gói + biến thể), hiệu ứng, khối overlay. */
export async function finishCatalog(appDataDir?: string) {
  const looks = styleDirs(appDataDir)
    .filter((d) => existsSync(d))
    .flatMap((d) => readdirSync(d))
    .filter((id, i, a) => a.indexOf(id) === i)
    .map((id) => stylePack(id, appDataDir))
    .filter((p) => p && (p.grading || p.variants || p.id === 'neutral'))
    .map((p) => ({
      id: p!.id,
      preset: (p!.grading?.preset as string | undefined) ?? null,
      variants: Object.keys(p!.variants ?? {}),
    }));
  const cat = await effectCatalog();
  return {
    looks,
    effects: [
      ...[...cat.values()].map((e) => ({
        id: e.key,
        label: e.label,
        family: e.family,
        heavy: e.renderLane === 'multipass',
      })),
      { id: 'vignette', label: 'Vignette', family: 'finishing', heavy: false },
      { id: 'grain', label: 'Film grain', family: 'finishing', heavy: false },
    ],
    overlays: [...overlayBlocks(appDataDir).values()].map((b) => ({
      id: b.id,
      title: b.title,
      tags: b.tags,
      vars: b.vars.map((v) => ({ id: v.id, required: Boolean(v.required) })),
    })),
    heavy_per_minute: HEAVY_PER_MINUTE,
  };
}

// Gate của bước look / effects / overlays (027, D6 mục 2)
registerObjective('look_valid', async (g) => {
  const r = await finishReport(g.store, g.videoId, g.appDataDir);
  return r.problems.look.length
    ? { pass: false, detail: r.problems.look.slice(0, 6).join('; ') }
    : { pass: true };
});
registerObjective('effects_valid', async (g) => {
  const r = await finishReport(g.store, g.videoId, g.appDataDir);
  return r.problems.effects.length
    ? { pass: false, detail: r.problems.effects.slice(0, 6).join('; ') }
    : { pass: true };
});
registerObjective('overlays_valid', async (g) => {
  const r = await finishReport(g.store, g.videoId, g.appDataDir);
  return r.problems.overlays.length
    ? { pass: false, detail: r.problems.overlays.slice(0, 6).join('; ') }
    : { pass: true };
});

/**
 * Executor bước `look` / `effects` / `overlays` (027): giao phiên `main` theo skill, kèm danh mục (look,
 * hiệu ứng, khối overlay) và hiện trạng hoàn thiện của video trong chỉ dẫn.
 */
export function finishStepExecutor(kind: 'look' | 'effects' | 'overlays'): StepExecutor {
  return async (ctx) => {
    if (!ctx.agent) throw new SfError('E_STEP_INCOMPLETE', `${kind} needs an agent session`);
    const cat = await finishCatalog(ctx.appDataDir);
    const rep = await finishReport(ctx.store, ctx.videoId, ctx.appDataDir);
    const list =
      kind === 'look'
        ? cat.looks.map(
            (l) => `${l.id}${l.variants.length ? ` (biến thể: ${l.variants.join(', ')})` : ''}`,
          )
        : kind === 'effects'
          ? cat.effects.map((e) => `${e.id}${e.heavy ? ' [nặng]' : ''}`)
          : cat.overlays.map(
              (o) => `${o.id} (${o.vars.map((v) => `${v.id}${v.required ? '*' : ''}`).join(', ')})`,
            );
    const now = rep.frames
      .map(
        (f) =>
          `${f.id}: look=${f.look ?? '—'}${kind === 'look' ? '' : `; effects=[${f.effects.join(', ')}]; overlays=[${f.overlays.join(', ')}]`}`,
      )
      .join('\n');
    const extra = [
      `Danh mục ${kind === 'look' ? 'look' : kind === 'effects' ? 'hiệu ứng media' : 'khối overlay'}: ${list.join('; ')}.`,
      ...(kind === 'effects'
        ? [
            `Ngân sách hiệu ứng nặng: ${rep.heavy_allowed} cho video này (${HEAVY_PER_MINUTE}/phút); đang dùng ${rep.heavy_total}. Chạy media.treatment mode dry_run trước khi apply.`,
          ]
        : []),
      `Hiện trạng:\n${now}`,
    ].join('\n');
    const out = await ctx.agent(extra);
    return { outputs: out ?? ['STORYBOARD.md'] };
  };
}
