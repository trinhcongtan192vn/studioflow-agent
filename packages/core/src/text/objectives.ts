import { readFileSync } from 'node:fs';
import { resolveConfig } from '../config/resolve.js';
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
  banned: string[];
  beats?: { min: number; max: number };
  /** Người nói hợp lệ ngoài `narrator` (screenplay, 036): id → tên trong dàn nhân vật. */
  speakers?: Record<string, string>;
}

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
  const out: ObjectiveResult[] = [{ id: 'schema', pass: true }];
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
  // 036: kịch bản thoại chỉ dùng người nói có trong dàn nhân vật (mã lạ → không có giọng)
  if (ctx.speakers) {
    const known = ctx.speakers;
    const unknown = [
      ...new Set(doc.lines.map((l) => l.speaker).filter((s) => s !== 'narrator' && !(s in known))),
    ];
    out.push({
      id: 'speakers_known',
      pass: unknown.length === 0,
      ...(unknown.length
        ? {
            detail: `unknown speakers: ${unknown.join(', ')} — use narrator or one of: ${Object.entries(
              known,
            )
              .map(([id, name]) => `${id} (${name})`)
              .join(', ')}`,
          }
        : {}),
    });
  }
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

/** Ngữ cảnh kiểm từ video (gói prompt kênh). */
export function objectiveContext(
  channelDir: string,
  videoId: string,
  read: (rel: string) => string,
  appDataDir?: string,
): ObjectiveContext {
  const pack = loadPromptPack(channelDir);
  return {
    channelDir,
    videoId,
    appDataDir,
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
  for (const id of ['beat_structure', 'tts_normalized', 'schema']) forScript(id);
}
