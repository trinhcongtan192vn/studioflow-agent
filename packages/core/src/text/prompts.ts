import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { EXTENSIONS_DIR } from '../agent/options.js';
import { resolveConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';

export interface PromptStep {
  template: string;
  include?: string[];
  token_cap: number;
}

export interface PromptPack {
  dir: string;
  source: 'channel' | 'app';
  steps: Record<string, PromptStep>;
  summaries: Record<string, string>;
  /** Số beat cho kiểm `beat_structure` (tùy chọn trong `pack.yaml`). */
  beats?: { min: number; max: number };
}

export const APP_PROMPTS_DIR = path.join(EXTENSIONS_DIR, 'studioflow-core', 'prompts');

/** Ước lượng token ≈ ký tự / 3 (009 Assumptions). */
export const estimateTokens = (s: string): number => Math.ceil(s.length / 3);

/** Gói prompt của kênh (`profile/references/prompts/`), không có → gói mặc định của app (D6 6.2). */
export function loadPromptPack(channelDir: string): PromptPack {
  const own = path.join(channelDir, 'profile', 'references', 'prompts');
  const dir = existsSync(path.join(own, 'pack.yaml')) ? own : APP_PROMPTS_DIR;
  const y = parse(readFileSync(path.join(dir, 'pack.yaml'), 'utf8')) as Omit<
    PromptPack,
    'dir' | 'source'
  >;
  return {
    dir,
    source: dir === own ? 'channel' : 'app',
    steps: y.steps ?? {},
    summaries: y.summaries ?? {},
    ...(y.beats ? { beats: y.beats } : {}),
  };
}

export type PromptVars = Record<
  'brief' | 'target_duration' | 'language' | 'rubric_short' | 'issues' | 'draft',
  string | number
>;

function fill(text: string, vars: PromptVars, cfg: (k: string) => unknown): string {
  return text.replace(
    /\{\{\s*(config:)?([a-z0-9_.<>-]+)\s*\}\}/gi,
    (_m, isCfg: string | undefined, key: string) =>
      isCfg ? String(cfg(key) ?? '') : String((vars as Record<string, unknown>)[key] ?? ''),
  );
}

/**
 * Lắp prompt: template + include theo thứ tự; vượt `token_cap` → thay file có bản tóm tắt; vẫn vượt
 * → `E_PROMPT_TOO_LONG` (D6 6.2).
 */
export function buildPrompt(
  pack: PromptPack,
  stepKey: string,
  vars: PromptVars,
  scope: { channelDir: string; videoId?: string; appDataDir?: string },
): { text: string; tokens: number; summarized: boolean } {
  const step = pack.steps[stepKey];
  if (!step) throw new SfError('E_PROMPT_TOO_LONG', `prompt pack has no step "${stepKey}"`);
  const cfg = (k: string) =>
    resolveConfig(
      k,
      { channelDir: scope.channelDir, videoId: scope.videoId },
      { appDataDir: scope.appDataDir },
    ).value;
  const read = (f: string) => readFileSync(path.join(pack.dir, f), 'utf8');
  const assemble = (useSummary: boolean) => {
    const parts = (step.include ?? []).map((f) =>
      useSummary && pack.summaries[f] ? read(pack.summaries[f]!) : read(f),
    );
    return fill([read(step.template), ...parts].join('\n\n'), vars, cfg);
  };
  let text = assemble(false);
  let summarized = false;
  if (estimateTokens(text) > step.token_cap) {
    text = assemble(true);
    summarized = true;
    if (estimateTokens(text) > step.token_cap) {
      throw new SfError(
        'E_PROMPT_TOO_LONG',
        `prompt for ${stepKey} is ~${estimateTokens(text)} tokens, cap ${step.token_cap}`,
      );
    }
  }
  return { text, tokens: estimateTokens(text), summarized };
}

/** Từ cấm của kênh: mục gạch đầu dòng trong `common/banned.md` (bỏ dòng ghi chú trong ngoặc). */
export function bannedTerms(pack: PromptPack): string[] {
  const f = path.join(pack.dir, 'common', 'banned.md');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .map((l) => /^\s*[-*]\s+(.+?)\s*$/.exec(l)?.[1])
    .filter((t): t is string => Boolean(t) && !/^\(.*\)$/.test(t!));
}
