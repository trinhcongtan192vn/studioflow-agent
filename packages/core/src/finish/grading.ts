import path from 'node:path';
import type { Frame } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { SfError } from '../errors.js';
import type { VideoModel } from '../graph/model.js';
import { runHf } from '../hf/cli.js';
import { createScratchDir, writeOutsideProject } from '../store/scratch.js';
import { stylePack, type StylePack } from './styles.js';

/** Hiệu ứng media của HyperFrames (`media-treatment --all`): khóa, bản vá đề xuất, làn render. */
export interface MediaEffect {
  key: string;
  family: string;
  label: string;
  apply: Record<string, number>;
  renderLane: 'single-pass' | 'multipass' | string;
}

/** Điều khiển hoàn thiện (`details`) dùng như hiệu ứng: vignette, hạt phim. */
const DETAIL_EFFECTS: Record<string, Record<string, number>> = {
  vignette: { vignette: 0.35 },
  grain: { grain: 0.25 },
};

let catalog: Promise<Map<string, MediaEffect>> | undefined;
/** Danh mục hiệu ứng của bản HyperFrames ghim (gọi một lần mỗi tiến trình). */
export function effectCatalog(): Promise<Map<string, MediaEffect>> {
  catalog ??= (async () => {
    const r = await runHf(['media-treatment', '--all', '--json'], {
      cwd: process.cwd(),
      timeoutMs: 60_000,
    });
    const caps = (r.json?.capabilities ?? {}) as { effects?: MediaEffect[] };
    if (!caps.effects) {
      catalog = undefined;
      throw new SfError(
        'E_PROVIDER_FAILED',
        `hyperframes media-treatment --all printed no catalog: ${(r.stderr || r.stdout).slice(-300)}`,
      );
    }
    return new Map(caps.effects.map((e) => [e.key, e]));
  })();
  return catalog;
}

export interface FrameLook {
  /** Giá trị look đã chọn (frame config → scene config → `sf-scene.look` → video/kênh/app). */
  look: string | null;
  /** Gói phong cách + biến thể dùng cho look (không tìm thấy → `unknown`). */
  pack?: string;
  variant?: string;
  unknown?: true;
  grading?: Record<string, unknown>;
}

/** Look của một frame (FR-CP-04, FN-common 6): look kênh + biến thể theo scene. */
export function frameLook(model: VideoModel, frame: Frame, appDataDir?: string): FrameLook {
  const ctx = { channelDir: model.channelDir, videoId: model.videoId };
  const at = resolveConfig(
    'look.id',
    { ...ctx, sceneId: frame.scene_id, frameId: frame.id },
    { appDataDir },
  );
  const scene = model.scenes.find((s) => s.id === frame.scene_id);
  const look =
    ((at.source === 'frame' || at.source === 'scene' ? at.value : (scene?.look ?? at.value)) as
      string | null | undefined) ?? null;
  if (!look) return { look: null };
  const pack = stylePack(look, appDataDir);
  if (pack) return { look, pack: pack.id, ...(pack.grading ? { grading: pack.grading } : {}) };
  // biến thể của look gốc (video/kênh)
  const base = resolveConfig('look.id', ctx, { appDataDir }).value as string | null | undefined;
  const bp: StylePack | undefined = base ? stylePack(base, appDataDir) : undefined;
  const v = bp?.variants?.[look];
  if (bp && v) return { look, pack: bp.id, variant: look, grading: v };
  return { look, unknown: true };
}

/** Phân tích `sf-frame.effects[]`: `<khóa>` hoặc `<khóa>:<mức 0..1>`. */
export function parseEffect(s: string): { key: string; amount?: number } {
  const m = /^([A-Za-z][\w-]*)(?::([0-9.]+))?$/.exec(s.trim());
  if (!m) return { key: s.trim() };
  return { key: m[1]!, ...(m[2] !== undefined ? { amount: Number(m[2]) } : {}) };
}

export interface FrameFinish {
  look: FrameLook;
  effects: string[];
  unknown_effects: string[];
  /** Hiệu ứng nặng (làn `multipass`) — FN-common 6: tối đa 2 mỗi phút video. */
  heavy: string[];
  /** Grading của look (nướng vào ảnh, 027 R2); null → giữ ảnh gốc. */
  lookPatch: Record<string, unknown> | null;
  /** Hiệu ứng media (áp lúc render bằng `data-color-grading`); null → không có. */
  fxPatch: Record<string, unknown> | null;
}

/** Look + hiệu ứng media của frame (027): look nướng vào ảnh, hiệu ứng áp lúc render. */
export function frameFinish(
  model: VideoModel,
  frame: Frame,
  cat: Map<string, MediaEffect>,
  appDataDir?: string,
): FrameFinish {
  const look = frameLook(model, frame, appDataDir);
  const effects = frame.effects ?? [];
  const unknown: string[] = [];
  const heavy: string[] = [];
  const fx: Record<string, number> = {};
  const details: Record<string, number> = {};
  for (const raw of effects) {
    const { key, amount } = parseEffect(raw);
    const e = cat.get(key);
    if (e) {
      Object.assign(fx, e.apply, amount !== undefined ? { [key]: amount } : {});
      if (e.renderLane === 'multipass') heavy.push(key);
    } else if (DETAIL_EFFECTS[key]) {
      Object.assign(details, DETAIL_EFFECTS[key], amount !== undefined ? { [key]: amount } : {});
    } else unknown.push(raw);
  }
  const fxPatch: Record<string, unknown> = {};
  if (Object.keys(details).length) fxPatch.details = details;
  if (Object.keys(fx).length) fxPatch.effects = fx;
  return {
    look,
    effects,
    unknown_effects: unknown,
    heavy,
    lookPatch: look.grading ? { ...look.grading } : null,
    fxPatch: Object.keys(fxPatch).length ? fxPatch : null,
  };
}

const normalized = new Map<string, Promise<Record<string, unknown>>>();
/**
 * Chuẩn hóa + kiểm bản vá bằng `hyperframes media-treatment --apply --dry-run` trên dự án tạm (FN-common
 * 6: dry-run trước khi áp). Lỗi → `E_SCHEMA_INVALID` kèm thông báo của HyperFrames.
 */
export function normalizeGrading(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = sha256(canonicalJson(patch));
  let p = normalized.get(key);
  if (!p) {
    p = (async () => {
      const s = createScratchDir('sf-grade-');
      try {
        writeOutsideProject(
          path.join(s.dir, 'index.html'),
          '<!doctype html><html><body><div id="root" data-composition-id="main" data-width="16" data-height="16" data-start="0" data-duration="1"><img id="t" class="clip" data-start="0" data-duration="1" data-track-index="0" src="t.png"></div></body></html>',
        );
        const r = await runHf(
          [
            'media-treatment',
            `--project=${s.dir}`,
            '--selector=#t',
            `--grading=${JSON.stringify(patch)}`,
            '--apply',
            '--dry-run',
            '--json',
          ],
          { cwd: s.dir, timeoutMs: 60_000 },
        );
        const j = r.json as { ok?: boolean; after?: Record<string, unknown>; error?: string };
        if (!j?.ok || !j.after)
          throw new SfError(
            'E_SCHEMA_INVALID',
            `color grading ${JSON.stringify(patch)}: ${j?.error ?? (r.stderr || r.stdout).slice(-300)}`,
          );
        return j.after;
      } finally {
        s.cleanup();
      }
    })();
    p.catch(() => normalized.delete(key));
    normalized.set(key, p);
  }
  return p;
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const attrOf = (rest: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(rest);
const dropAttr = (rest: string, name: string) =>
  rest.replace(new RegExp(`\\s+${name}\\s*=\\s*("[^"]*"|'[^']*')`, 'gi'), '');

/** Ảnh gốc của các `<img>` trong frame (trước khi nướng look: `data-sf-src`, không thì `src`). */
export function frameImageSources(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
    const a = attrOf(m[1]!, 'data-sf-src') ?? attrOf(m[1]!, 'src');
    const v = a?.[2] ?? a?.[3];
    if (v && /^public\//.test(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Hoàn thiện HTML của frame (027): `<img>` dùng ảnh đã nướng look (`baked`: ảnh gốc → ảnh đã grade; gốc
 * giữ ở `data-sf-src` để áp lại), hiệu ứng media → `data-color-grading` (JSON đã chuẩn hóa) trên
 * `<img>`/`<video>`; null → gỡ. Chữ/hình HTML không grade (FN-common 6). Không đụng thuộc tính khác.
 */
export function applyFinish(
  html: string,
  o: { baked?: Map<string, string> | null; fx?: Record<string, unknown> | null },
): string {
  const fxAttr = o.fx ? ` data-color-grading="${escAttr(JSON.stringify(o.fx))}"` : '';
  return html.replace(/<(img|video)\b([^>]*)>/gi, (_m, tag: string, rest: string) => {
    let body = dropAttr(rest, 'data-color-grading');
    if (tag.toLowerCase() === 'img') {
      const orig = attrOf(body, 'data-sf-src') ?? attrOf(body, 'src');
      const src = orig?.[2] ?? orig?.[3];
      const baked = src ? o.baked?.get(src) : undefined;
      body = dropAttr(body, 'data-sf-src');
      if (src) {
        body = body.replace(/\ssrc\s*=\s*("[^"]*"|'[^']*')/i, ` src="${escAttr(baked ?? src)}"`);
        if (baked) body += ` data-sf-src="${escAttr(src)}"`;
      }
    }
    const selfClose = /\/\s*$/.test(body);
    if (selfClose) body = body.replace(/\s*\/\s*$/, '');
    return `<${tag}${body}${fxAttr}${selfClose ? ' /' : ''}>`;
  });
}

/** Look id từ giá trị `data-color-grading` (read-back Studio, D9 4): preset trùng gói phong cách. */
export function lookFromGrading(
  value: string,
  candidates: string[],
  appDataDir?: string,
): string | undefined {
  let preset: unknown;
  try {
    preset = (JSON.parse(value) as { preset?: unknown }).preset;
  } catch {
    return /^[a-z0-9][a-z0-9._-]*$/i.test(value) && stylePack(value, appDataDir)
      ? value
      : undefined;
  }
  if (typeof preset !== 'string') return undefined;
  return candidates.find((id) => stylePack(id, appDataDir)?.grading?.preset === preset);
}
