import { existsSync, readFileSync } from 'node:fs';
import type { GateDecl, VideoState } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { crossCheckVideo } from '../domain/crossref.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { parseStoryboard, toStoryboardDoc } from '../domain/markdown/storyboard.js';
import { validateArtifact } from '../domain/validate.js';
import { BuildGraph, unsettled, type BuilderRegistry } from '../graph/graph.js';
import type { WriteStore } from '../store/writer.js';

export interface GateResult {
  gate: GateDecl['kind'];
  target: string;
  pass: boolean;
  detail?: string;
  /** 043: kiểm mềm trượt nhưng người dùng đã chấp nhận bỏ qua. */
  waived?: boolean;
}

/**
 * 043: kiểm khách quan "mềm" — trượt là cảnh báo (`E_GATE_WARNING`), người dùng có thể bỏ qua
 * (`workflow.waive`). Thời lượng đo trên audio thật lệch mục tiêu không làm hỏng video.
 */
export const WAIVABLE_CHECKS: ReadonlySet<string> = new Set(['audio_duration']);

/** Gate trượt này chỉ là cảnh báo (có thể bỏ qua). */
export const isWarning = (r: GateResult): boolean =>
  !r.pass && r.gate === 'objective' && WAIVABLE_CHECKS.has(r.target);

export interface GateContext {
  store: WriteStore;
  videoId: string;
  state: VideoState;
  builders: BuilderRegistry;
  appDataDir?: string;
  /** Chạy script khai báo trong manifest (exit 0 = qua); không có → gate không qua. */
  runScript?: (id: string) => Promise<{ exit_code: number | null; stderr: string }>;
}

const read = (ctx: GateContext, f: string) => {
  const abs = ctx.store.abs(`videos/${ctx.videoId}/${f}`);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : undefined;
};

/** Kiểm tra khách quan không cần LLM (D6 mục 4.2); `beat_structure`/… thêm ở 009, `audio_duration` ở 016. */
type ObjectiveFn = (
  ctx: GateContext,
  params?: Record<string, unknown>,
) => { pass: boolean; detail?: string } | Promise<{ pass: boolean; detail?: string }>;

const OBJECTIVES: Record<string, ObjectiveFn> = {
  coverage(ctx) {
    const sb = read(ctx, 'STORYBOARD.md');
    if (!sb) return { pass: false, detail: 'STORYBOARD.md missing' };
    const errs = crossCheckVideo(ctx.store.root, ctx.videoId).filter((e) =>
      /frame/.test(e.message),
    );
    const empty = toStoryboardDoc(parseStoryboard(sb), { loose: true }).frames.filter(
      (f) => !(f.layers?.length > 0),
    );
    const problems = [
      ...errs.map((e) => e.message),
      ...empty.map((f) => `frame ${f.id} has no layer`),
    ];
    return problems.length ? { pass: false, detail: problems.join('; ') } : { pass: true };
  },
  meta_limits(ctx) {
    const pub = read(ctx, 'publish.md');
    if (!pub) return { pass: false, detail: 'publish.md missing' };
    const d = parseBlocksDoc(pub);
    const scope = { channelDir: ctx.store.root, videoId: ctx.videoId };
    const tmax = Number(
      resolveConfig('meta.title_max', scope, { appDataDir: ctx.appDataDir }).value,
    );
    const dmax = Number(
      resolveConfig('meta.description_max', scope, { appDataDir: ctx.appDataDir }).value,
    );
    const title = String(d.front.title ?? '');
    const desc = d.body.join('\n').trim();
    const problems = [
      ...(title.length > tmax ? [`title ${title.length} > ${tmax} chars`] : []),
      ...(desc.length > dmax ? [`description ${desc.length} > ${dmax} chars`] : []),
    ];
    return problems.length ? { pass: false, detail: problems.join('; ') } : { pass: true };
  },
};

/** Đăng ký kiểm khách quan (009: beat_structure, banned_terms, tts_normalized; 016: audio_duration). */
export function registerObjective(id: string, fn: ObjectiveFn): void {
  OBJECTIVES[id] = fn;
}

/** Đánh giá một gate; lỗi bất ngờ (ví dụ file không phân tích được) → gate không qua, không ném (036). */
export async function evaluateGate(g: GateDecl, ctx: GateContext): Promise<GateResult> {
  try {
    return await evaluateGateInner(g, ctx);
  } catch (e) {
    const o = g as { check?: string; path?: string; step?: string };
    return {
      gate: g.kind,
      target: o.check ?? o.path ?? o.step ?? g.kind,
      pass: false,
      detail: String((e as Error)?.message ?? e),
    };
  }
}

async function evaluateGateInner(g: GateDecl, ctx: GateContext): Promise<GateResult> {
  switch (g.kind) {
    case 'artifact_valid': {
      const content = read(ctx, g.path);
      if (content === undefined)
        return { gate: g.kind, target: g.path, pass: false, detail: `${g.path} missing` };
      const r = validateArtifact(`videos/${ctx.videoId}/${g.path}`, content);
      let errors = r.errors.map((e) => e.message);
      if (
        r.valid &&
        (r.kind === 'script' || r.kind === 'storyboard') &&
        read(ctx, 'STORYBOARD.md') &&
        read(ctx, 'SCRIPT.md')
      ) {
        errors = crossCheckVideo(ctx.store.root, ctx.videoId)
          .filter((e) => (r.kind === 'script' ? e.code === 'E_ID_DUPLICATE' : true))
          .map((e) => e.message);
      }
      return {
        gate: g.kind,
        target: g.path,
        pass: errors.length === 0,
        ...(errors.length ? { detail: errors.slice(0, 5).join('; ') } : {}),
      };
    }
    case 'graph_fresh': {
      const nodes = new BuildGraph({
        store: ctx.store,
        appDataDir: ctx.appDataDir,
        builders: ctx.builders,
      }).status(ctx.videoId);
      const prefix = g.nodes.replace(/\*$/, '');
      const bad = nodes.filter(
        (n) => (g.nodes === '*' || n.key.startsWith(prefix)) && unsettled(n),
      );
      return {
        gate: g.kind,
        target: g.nodes,
        pass: bad.length === 0,
        ...(bad.length ? { detail: bad.map((n) => `${n.key}: ${n.status}`).join('; ') } : {}),
      };
    }
    case 'approved': {
      const ok = ctx.state.approvals.some((a) => a.step_id === g.step && a.status === 'approved');
      return {
        gate: g.kind,
        target: g.step,
        pass: ok,
        ...(ok ? {} : { detail: `step ${g.step} is not approved` }),
      };
    }
    case 'script': {
      if (!ctx.runScript)
        return {
          gate: g.kind,
          target: g.script,
          pass: false,
          detail: 'scripts are not available here',
        };
      const r = await ctx.runScript(g.script);
      return {
        gate: g.kind,
        target: g.script,
        pass: r.exit_code === 0,
        ...(r.exit_code === 0 ? {} : { detail: r.stderr.slice(0, 500) }),
      };
    }
    case 'objective': {
      const fn = OBJECTIVES[g.check];
      if (!fn)
        return {
          gate: g.kind,
          target: g.check,
          pass: false,
          detail: `objective check ${g.check} is not available`,
        };
      return { gate: g.kind, target: g.check, ...(await fn(ctx, g.params)) };
    }
  }
}
