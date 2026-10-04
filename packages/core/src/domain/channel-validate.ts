import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { EXTENSIONS_DIR } from '../agent/options.js';
import type { ChannelConfig } from '../contracts/types.js';
import { configKeySpec } from '../config/keys.js';
import { defaultAppDataDir } from '../config/resolve.js';
import { parseStoryboard, toStoryboardDoc } from './markdown/storyboard.js';
import { validateArtifact } from './validate.js';

export interface ChannelIssue {
  code:
    | 'channel_schema'
    | 'config_key'
    | 'missing_voice'
    | 'missing_style'
    | 'missing_lut'
    | 'missing_mouth_set'
    | 'blueprint_incomplete'
    | 'prompt_pack'
    | 'rubric'
    | 'missing_asset';
  /** Đường dẫn tương đối kênh của file có vấn đề. */
  path: string;
  message: string;
}

export interface ChannelValidation {
  ok: boolean;
  errors: ChannelIssue[];
  warnings: ChannelIssue[];
}

/** Thư mục gói phong cách: app-data trước bộ cài (D13 mục 6, như gói workflow D5 3.2). */
export function styleDirs(appDataDir: string): string[] {
  return [path.join(appDataDir, 'extensions', 'styles'), path.join(EXTENSIONS_DIR, 'styles')];
}

function files(dir: string, ext?: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p, ext) : !ext || e.name.endsWith(ext) ? [p] : [];
  });
}

const rel = (root: string, p: string) => path.relative(root, p).replaceAll('\\', '/');

function readJson<T>(f: string): T | undefined {
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/**
 * `channel.validate` (D6 mục 6.3, 022): schema `channel.json`, khóa `{{config:…}}`, file được tham chiếu
 * (giọng, LUT, bộ miệng, blueprint), gói prompt, rubric; cảnh báo asset storyboard không có trong thư viện.
 */
export function validateChannel(
  channelDir: string,
  opts: { appDataDir?: string } = {},
): ChannelValidation {
  const appDataDir = opts.appDataDir ?? defaultAppDataDir();
  const errors: ChannelIssue[] = [];
  const warnings: ChannelIssue[] = [];
  const err = (code: ChannelIssue['code'], p: string, message: string) =>
    errors.push({ code, path: p, message });

  // 1. channel.json
  const chFile = path.join(channelDir, 'channel.json');
  const chText = existsSync(chFile) ? readFileSync(chFile, 'utf8') : '';
  const schema = validateArtifact('channel.json', chText);
  if (!schema.valid)
    for (const e of schema.errors.slice(0, 5)) err('channel_schema', 'channel.json', e.message);
  const ch = readJson<ChannelConfig>(chFile);
  const cfg = (ch?.config ?? {}) as Record<string, unknown>;

  // 2. {{config:<khóa>}} trong profile/**/*.md
  const profile = path.join(channelDir, 'profile');
  for (const f of files(profile, '.md')) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\{\{\s*config:([^}\s]+)\s*\}\}/g))
      if (!configKeySpec(m[1]!))
        err('config_key', rel(channelDir, f), `unknown config key "${m[1]}" (D3 7.2)`);
  }

  // 3. giọng: voice.id của kênh + voice_id của cast
  const voiceOk = (vo: string) =>
    existsSync(path.join(channelDir, 'voices', vo, 'profile.json')) &&
    existsSync(path.join(channelDir, 'voices', vo, 'voice.pt'));
  if (typeof cfg['voice.id'] === 'string' && !voiceOk(cfg['voice.id']))
    err(
      'missing_voice',
      'channel.json',
      `voice ${cfg['voice.id']} has no voices/${cfg['voice.id']}/profile.json + voice.pt`,
    );
  const castFiles = files(path.join(channelDir, 'characters'), 'cast.json');
  const casts = castFiles.map((f) => ({
    f,
    c: readJson<{ voice_id?: string; mouth_set?: string }>(f) ?? {},
  }));
  for (const { f, c } of casts)
    if (c.voice_id && !voiceOk(c.voice_id))
      err(
        'missing_voice',
        rel(channelDir, f),
        `voice ${c.voice_id} has no voices/${c.voice_id}/profile.json + voice.pt`,
      );

  // 4. look.id → gói phong cách + LUT; 5. bộ miệng
  const styles = styleDirs(appDataDir);
  const stylePack = (id: string) =>
    styles.map((d) => path.join(d, id)).find((d) => existsSync(path.join(d, 'style.yaml')));
  const look = cfg['look.id'];
  if (typeof look === 'string') {
    const dir = stylePack(look);
    if (!dir)
      err(
        'missing_style',
        'channel.json',
        `look ${look}: style pack not installed (extensions/styles/${look}/style.yaml)`,
      );
    else {
      const y = (parse(readFileSync(path.join(dir, 'style.yaml'), 'utf8')) ?? {}) as {
        lut?: string;
      };
      if (y.lut && !existsSync(path.join(dir, y.lut)))
        err(
          'missing_lut',
          'channel.json',
          `look ${look}: LUT ${y.lut} is missing in the style pack`,
        );
    }
  }
  const mouthSets = new Set(
    styles.flatMap((d) =>
      existsSync(d)
        ? readdirSync(d).flatMap((pack) => {
            const m = path.join(d, pack, 'mouths');
            return existsSync(m) ? readdirSync(m) : [];
          })
        : [],
    ),
  );
  for (const { f, c } of casts)
    if (c.mouth_set && !mouthSets.has(c.mouth_set))
      err(
        'missing_mouth_set',
        rel(channelDir, f),
        `mouth set ${c.mouth_set} is not in any style pack (mouths/${c.mouth_set}/)`,
      );

  // 6. blueprint của kênh
  const bpDir = path.join(profile, 'references', 'blueprints');
  if (existsSync(bpDir))
    for (const id of readdirSync(bpDir).filter((x) => statSync(path.join(bpDir, x)).isDirectory()))
      for (const need of ['blueprint.html', 'blueprint.yaml'])
        if (!existsSync(path.join(bpDir, id, need)))
          err(
            'blueprint_incomplete',
            `profile/references/blueprints/${id}`,
            `blueprint ${id} has no ${need}`,
          );

  // 7. gói prompt riêng của kênh
  const prompts = path.join(profile, 'references', 'prompts');
  const packFile = path.join(prompts, 'pack.yaml');
  if (existsSync(packFile)) {
    let pack:
      | {
          steps?: Record<string, { template?: string; include?: string[] }>;
          summaries?: Record<string, string>;
        }
      | undefined;
    try {
      pack = parse(readFileSync(packFile, 'utf8')) ?? {};
    } catch (e) {
      err(
        'prompt_pack',
        rel(channelDir, packFile),
        `pack.yaml is not valid YAML: ${(e as Error).message}`,
      );
    }
    if (pack) {
      for (const [step, s] of Object.entries(pack.steps ?? {})) {
        if (!s?.template)
          err('prompt_pack', rel(channelDir, packFile), `step ${step} has no template`);
        for (const f of [s?.template, ...(s?.include ?? [])].filter((x): x is string => Boolean(x)))
          if (!existsSync(path.join(prompts, f)))
            err('prompt_pack', rel(channelDir, packFile), `step ${step}: ${f} does not exist`);
      }
      for (const [src, sum] of Object.entries(pack.summaries ?? {}))
        if (!existsSync(path.join(prompts, sum)))
          err('prompt_pack', rel(channelDir, packFile), `summary of ${src}: ${sum} does not exist`);
    }
  }

  // 8. rubric của kênh
  for (const f of files(path.join(profile, 'references', 'rubrics'), '.yaml')) {
    try {
      const r = parse(readFileSync(f, 'utf8')) as { criteria?: { weight: number }[] };
      const sum = (r?.criteria ?? []).reduce((s, c) => s + Number(c.weight), 0);
      if (!r?.criteria?.length || Math.abs(sum - 1) > 0.01)
        err('rubric', rel(channelDir, f), `criteria weights must sum to 1 (got ${sum})`);
    } catch (e) {
      err('rubric', rel(channelDir, f), `not valid YAML: ${(e as Error).message}`);
    }
  }

  // 9. cảnh báo: asset của storyboard không có trong thư viện kênh
  const lib = new Set(
    (
      readJson<{ assets: { id: string }[] }>(path.join(channelDir, 'assets', 'manifest.json'))
        ?.assets ?? []
    ).map((a) => a.id),
  );
  const videos = path.join(channelDir, 'videos');
  if (existsSync(videos))
    for (const vd of readdirSync(videos)) {
      const sb = path.join(videos, vd, 'STORYBOARD.md');
      if (!existsSync(sb)) continue;
      try {
        const doc = toStoryboardDoc(parseStoryboard(readFileSync(sb, 'utf8')), { loose: true });
        for (const f of doc.frames)
          for (const l of f.layers ?? [])
            if (l.asset_id && !lib.has(l.asset_id))
              warnings.push({
                code: 'missing_asset',
                path: `videos/${vd}/STORYBOARD.md`,
                message: `frame ${f.id} layer ${l.id}: asset ${l.asset_id} is not in assets/manifest.json`,
              });
      } catch {
        /* storyboard lỗi được kiểm ở artifact.validate */
      }
    }

  return { ok: errors.length === 0, errors, warnings };
}
