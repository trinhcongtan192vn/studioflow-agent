import { readFileSync } from 'node:fs';
import { resolveConfig } from '../config/resolve.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { parseScript, toScriptDoc } from '../domain/markdown/script.js';
import { validateArtifact } from '../domain/validate.js';
import { registerObjective } from '../workflow/gates.js';
import { bannedTerms, loadPromptPack } from './prompts.js';

export interface ObjectiveResult {
  id: string;
  pass: boolean;
  detail?: string;
}

export interface ObjectiveContext {
  channelDir: string;
  videoId: string;
  appDataDir?: string;
  targetDurationMs: number | null;
  banned: string[];
  beats?: { min: number; max: number };
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function cfg(ctx: ObjectiveContext, key: string): number {
  return Number(
    resolveConfig(
      key,
      { channelDir: ctx.channelDir, videoId: ctx.videoId },
      { appDataDir: ctx.appDataDir },
    ).value,
  );
}

/** Kiểm khách quan cho `SCRIPT.md` (D6 4.2). */
export function checkScript(content: string, ctx: ObjectiveContext): ObjectiveResult[] {
  const schema = validateArtifact(`videos/${ctx.videoId}/SCRIPT.md`, content);
  if (!schema.valid) {
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
  }
  const doc = toScriptDoc(parseScript(content));
  const lang = String(doc.front.language);
  const wpm = cfg(ctx, `script.wpm.${lang}`) || 150;
  const total = doc.lines.reduce((s, l) => s + words(l.text), 0);
  const pauses = doc.lines.reduce((s, l) => s + (l.pause_after_ms ?? 0), 0);
  const out: ObjectiveResult[] = [{ id: 'schema', pass: true }];
  if (!ctx.targetDurationMs) {
    out.push(
      { id: 'length', pass: true, detail: 'no target duration in BRIEF.md' },
      { id: 'read_time', pass: true, detail: 'no target duration in BRIEF.md' },
    );
  } else {
    const target = Math.round((ctx.targetDurationMs / 60000) * wpm);
    const lt = cfg(ctx, 'check.length_tolerance');
    const lenOk = Math.abs(total - target) <= target * lt;
    out.push({
      id: 'length',
      pass: lenOk,
      ...(lenOk ? {} : { detail: `${total} words, target ${target} ±${Math.round(lt * 100)}%` }),
    });
    const readMs = (total / wpm) * 60000 + pauses;
    const dt = cfg(ctx, 'check.duration_tolerance');
    const rtOk = Math.abs(readMs - ctx.targetDurationMs) <= ctx.targetDurationMs * dt;
    out.push({
      id: 'read_time',
      pass: rtOk,
      ...(rtOk
        ? {}
        : {
            detail: `~${Math.round(readMs / 1000)} s, target ${Math.round(ctx.targetDurationMs / 1000)} s`,
          }),
    });
  }
  const empty = doc.beats.filter((b) => b.line_ids.length === 0).map((b) => b.id);
  const n = doc.beats.length;
  const range =
    ctx.beats && (n < ctx.beats.min || n > ctx.beats.max)
      ? `${n} beats, expected ${ctx.beats.min}-${ctx.beats.max}`
      : '';
  const beatProblems = [
    ...(empty.length ? [`empty beats: ${empty.join(', ')}`] : []),
    ...(range ? [range] : []),
  ];
  out.push({
    id: 'beat_structure',
    pass: beatProblems.length === 0,
    ...(beatProblems.length ? { detail: beatProblems.join('; ') } : {}),
  });
  const text = doc.lines
    .map((l) => l.text)
    .join('\n')
    .toLowerCase();
  const hits = ctx.banned.filter((t) => text.includes(t.toLowerCase()));
  out.push({
    id: 'banned_terms',
    pass: hits.length === 0,
    ...(hits.length ? { detail: `banned: ${hits.join(', ')}` } : {}),
  });
  const digits = doc.lines.filter((l) => /\d/.test(l.text) && !l.tts_text).map((l) => l.id);
  out.push({
    id: 'tts_normalized',
    pass: digits.length === 0,
    ...(digits.length ? { detail: `numbers without sf:tts in ${digits.join(', ')}` } : {}),
  });
  return out;
}

/** Kiểm `meta_limits` + từ cấm cho tiêu đề/mô tả (D6 4.2). */
export function checkMeta(
  meta: { title: string; description: string; tags: string[] },
  ctx: ObjectiveContext,
): ObjectiveResult[] {
  const tmax = cfg(ctx, 'meta.title_max');
  const dmax = cfg(ctx, 'meta.description_max');
  const problems = [
    ...(meta.title.length > tmax ? [`title ${meta.title.length} > ${tmax}`] : []),
    ...(meta.description.length > dmax ? [`description ${meta.description.length} > ${dmax}`] : []),
  ];
  const text = `${meta.title}\n${meta.description}`.toLowerCase();
  const hits = ctx.banned.filter((t) => text.includes(t.toLowerCase()));
  return [
    {
      id: 'meta_limits',
      pass: problems.length === 0,
      ...(problems.length ? { detail: problems.join('; ') } : {}),
    },
    {
      id: 'banned_terms',
      pass: hits.length === 0,
      ...(hits.length ? { detail: `banned: ${hits.join(', ')}` } : {}),
    },
  ];
}

/** Ngữ cảnh kiểm từ video (BRIEF.md + gói prompt kênh). */
export function objectiveContext(
  channelDir: string,
  videoId: string,
  read: (rel: string) => string,
  appDataDir?: string,
): ObjectiveContext {
  const brief = parseBlocksDoc(read(`videos/${videoId}/BRIEF.md`)).front as {
    target_duration_ms?: number | null;
  };
  const pack = loadPromptPack(channelDir);
  return {
    channelDir,
    videoId,
    appDataDir,
    targetDurationMs: brief.target_duration_ms ?? null,
    banned: bannedTerms(pack),
    ...(pack.beats ? { beats: pack.beats } : {}),
  };
}

/** Đăng ký vào gate `objective` của Workflow Engine (D6 4.2). */
export function registerTextObjectives(): void {
  const forScript = (id: string) =>
    registerObjective(id, (g) => {
      const read = (rel: string) => readFileSync(g.store.abs(rel), 'utf8');
      const r = checkScript(
        read(`videos/${g.videoId}/SCRIPT.md`),
        objectiveContext(g.store.root, g.videoId, read, g.appDataDir),
      );
      const hit = r.find((x) => x.id === id) ?? r.find((x) => x.id === 'schema')!;
      return { pass: hit.pass, ...(hit.detail ? { detail: hit.detail } : {}) };
    });
  for (const id of ['length', 'read_time', 'beat_structure', 'tts_normalized', 'schema'])
    forScript(id);
}
