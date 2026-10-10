import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import type { AudioMeta, Line } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { newId } from '../domain/ids.js';
import { assignStoryboardIds } from '../domain/markdown/storyboard.js';
import { parseScript, toScriptDoc } from '../domain/markdown/script.js';
import { SfError } from '../errors.js';
import { loadOutputProfile } from '../hf/outputs.js';
import { readChannelAssets } from '../hf/packet.js';
import { LAYOUT_INFO, LAYOUTS, MOTIONS } from '../hf/templates.js';
import { loadVideoModel } from '../graph/model.js';
import { extractJson, type TextService } from '../text/service.js';
import { DEFAULT_MODELS, type ModelRef } from '../text/models.js';
import type { StepRunContext } from './engine.js';

/**
 * Bước `direct` (luồng v2): **một lượt Opus cho cả video** — đọc kịch bản + thời lượng thật từng line, trả
 * JSON danh sách cảnh (layout, ảnh, chữ trên hình, chuyển động, chuyển cảnh, nhạc). App chuyển JSON →
 * `STORYBOARD.md` tất định (`planToStoryboard`): gán ID, gom line thiếu/thừa, tách cảnh dài, layout lạ → suy
 * từ layer, chữ dài → cắt. Không còn vòng "agent viết storyboard → schema sai → sửa".
 */

/** Một cảnh trong kế hoạch của đạo diễn. */
export interface DirectShot {
  line_ids: string[];
  layout?: string;
  /** Khóa trong `images` (hoặc `asset:<as_…>` ảnh thư viện); `null` = không ảnh. */
  image?: string | null;
  /** Ảnh thứ hai (layout `image-split`). */
  image2?: string | null;
  text?: { main?: string; sub?: string; number?: string; items?: string[] };
  accent?: string;
  motion?: string;
  transition?: string;
  hero?: boolean;
}

export interface DirectPlan {
  scenes: { title?: string; mood?: string; music?: string | null; shots: DirectShot[] }[];
  images?: { key: string; prompt?: string; asset_id?: string }[];
}

/** Tham số preset trên bước `direct` của manifest. */
export interface DirectParams {
  /** Phong cách hình của workflow (preset). */
  style?: string;
  /** Cảnh dài hơn (giây) và có nhiều line → tách (mặc định 6 dọc, 8 ngang). */
  max_shot_s?: number;
  /** Layout ưu tiên của preset. */
  prefer?: string[];
  /** Nhạc: `single` (mặc định) = một bài cho cả video; `per-scene` = đổi nhạc theo chương (phim tài liệu). */
  music?: 'single' | 'per-scene';
}

const TRANSITIONS = ['cut', 'crossfade', 'blur-crossfade', 'push-slide', 'zoom-through', 'squeeze'];

const words = (s: string, max: number) => {
  const w = s.trim().split(/\s+/).filter(Boolean);
  return w.length > max ? w.slice(0, max).join(' ') : w.join(' ');
};
const clip = (s: string | undefined, maxWords: number, maxChars: number) => {
  if (!s?.trim()) return undefined;
  let t = words(s, maxWords);
  if (t.length > maxChars) t = t.slice(0, maxChars).replace(/\s+\S*$/, '');
  return t || undefined;
};

interface LineInfo {
  id: string;
  beat_id: string;
  beat: string;
  text: string;
  speaker: string;
  ms: number;
}

/** Line theo thứ tự SCRIPT + thời lượng thật (audio_meta) + tên beat. */
export function scriptLines(videoDir: string): LineInfo[] {
  const script = toScriptDoc(parseScript(readFileSync(path.join(videoDir, 'SCRIPT.md'), 'utf8')), {
    loose: true,
  });
  const metaFile = path.join(videoDir, 'audio_meta.json');
  const meta = existsSync(metaFile)
    ? (JSON.parse(readFileSync(metaFile, 'utf8')) as AudioMeta)
    : undefined;
  const dur = new Map((meta?.lines ?? []).map((l) => [l.line_id, l.duration_ms]));
  const beatTitle = new Map(script.beats.map((b) => [b.id, b.title]));
  return (script.lines as Line[]).map((l) => ({
    id: l.id,
    beat_id: l.beat_id,
    beat: beatTitle.get(l.beat_id) ?? '',
    text: l.text,
    speaker: l.speaker,
    ms: (dur.get(l.id) ?? 2500) + (l.pause_after_ms ?? 0),
  }));
}

/** Prompt đạo diễn (tiếng Anh cho model; chữ trên hình theo ngôn ngữ video). */
export function directPrompt(i: {
  brief: string;
  language: string;
  width: number;
  height: number;
  lines: LineInfo[];
  params: DirectParams;
  styleGuide?: string;
  library: { id: string; description?: string; tags: string[] }[];
  cast: { id: string; name: string; description?: string }[];
  heroAllowed: boolean;
  music: boolean;
}): string {
  const vertical = i.height > i.width;
  const maxShot = i.params.max_shot_s ?? (vertical ? 6 : 8);
  const layouts = LAYOUTS.map(
    (k) =>
      `- ${k} (${LAYOUT_INFO[k].images} image${LAYOUT_INFO[k].images === 1 ? '' : 's'}; text: ${LAYOUT_INFO[k].texts}) — ${LAYOUT_INFO[k].use}`,
  ).join('\n');
  return [
    `You are the art director of a faceless ${vertical ? 'vertical 9:16 short' : 'horizontal 16:9'} video (${i.width}×${i.height}).`,
    'Plan every visual shot for the whole narration in ONE pass. A code layout engine renders your plan, and a local image model (Qwen Image) generates the images from your prompts, so describe images precisely.',
    '',
    '## Brief',
    i.brief.trim().slice(0, 3000),
    ...(i.styleGuide ? ['', '## Channel style', i.styleGuide.trim().slice(0, 1500)] : []),
    ...(i.params.style ? ['', '## Format style', i.params.style] : []),
    '',
    `## Narration (line id · beat · duration · text) — on-screen text language: ${i.language}`,
    ...i.lines.map((l) => `${l.id} · ${l.beat} · ${(l.ms / 1000).toFixed(1)} s · ${l.text}`),
    '',
    '## Layouts',
    layouts,
    ...(i.params.prefer?.length
      ? [`Preferred for this format: ${i.params.prefer.join(', ')}.`]
      : []),
    `Motions: ${MOTIONS.join(', ')}. Transitions: ${TRANSITIONS.join(', ')}.`,
    ...(i.library.length
      ? [
          '',
          '## Channel image library (reuse with "asset:<id>" instead of generating when it fits)',
          ...i.library.map((a) => `- ${a.id}: ${a.description ?? ''} [${a.tags.join(', ')}]`),
        ]
      : []),
    ...(i.cast.length
      ? [
          '',
          '## Characters (put the character id in the image prompt as "<cast:ID>" when the shot shows them)',
          ...i.cast.map((c) => `- ${c.id}: ${c.name}${c.description ? ` — ${c.description}` : ''}`),
        ]
      : []),
    '',
    '## Rules',
    '- Every line id appears in exactly one shot, in narration order. A shot usually covers 1 line; group short consecutive lines.',
    `- Shots last 2–${maxShot} s; longer ones are split by the app.`,
    '- Most shots (about 3 of 4) show an image: a concrete subject that illustrates the line (object, place, person, scene, metaphor). Text-only layouts are for numbers, lists, quotes and the punchline.',
    '- First shot is the hook: strong image + at most 5 words, or a big number.',
    `- On-screen text is short (main ≤ 6 words, sub ≤ 8 words) in ${i.language}; never copy the narration sentence — captions already show it.`,
    '- Image prompts in English: subject, action, setting, composition, lighting, style. Keep one consistent visual style for the whole video. No text, letters or logos in images.',
    '- Reuse an image key for shots about the same subject (same scene); give it a different motion.',
    ...(i.heroAllowed
      ? ['- Mark at most 2 key shots with "hero": true (custom hand-built animation).']
      : []),
    ...(!i.music
      ? ['- Set "music": null (background music is off).']
      : i.params.music === 'per-scene'
        ? [
            '- Give each scene a "music" mood query in English (genre, energy, instruments). Reuse the SAME query for scenes of the same mood; change it only when the story clearly changes mood.',
          ]
        : [
            '- ONE background track for the whole video: put a single "music" mood query in English (genre, energy, instruments) on the first scene; other scenes use null.',
          ]),
    '',
    '## Output — ONLY this JSON',
    JSON.stringify(
      {
        images: [{ key: 'img1', prompt: '…' }],
        scenes: [
          {
            title: '…',
            mood: '…',
            music: 'upbeat electronic, driving drums',
            shots: [
              {
                line_ids: ['ln_…'],
                layout: 'image-title',
                image: 'img1',
                text: { main: '…', sub: null },
                accent: null,
                motion: 'ken-burns-in',
                transition: 'cut',
              },
            ],
          },
        ],
      },
      null,
      1,
    ),
  ].join('\n');
}

/** Một frame sau chuẩn hóa (trước khi ghi markdown). */
interface FramePlan {
  scene: number;
  shot: DirectShot;
  lines: LineInfo[];
  /** Phần tiếp của cảnh dài: giữ ảnh, bỏ chữ chính. */
  continuation: boolean;
}

/**
 * Chuẩn hóa kế hoạch: mỗi line đúng một frame theo thứ tự kịch bản (line thiếu → frame của line trước, line
 * lặp → lần đầu), cảnh không liền mạch tách thành nhiều frame, cảnh dài > `maxShotMs` tách theo line.
 */
export function normalizePlan(
  plan: DirectPlan,
  lines: LineInfo[],
  maxShotMs: number,
): { frames: FramePlan[]; fixes: string[] } {
  const fixes: string[] = [];
  const shots = plan.scenes.flatMap((s, si) => (s.shots ?? []).map((shot) => ({ si, shot })));
  const owner = new Map<string, number>();
  shots.forEach((x, i) => {
    for (const id of x.shot.line_ids ?? []) {
      if (!lines.some((l) => l.id === id)) {
        fixes.push(`line lạ ${id} bị bỏ`);
        continue;
      }
      if (owner.has(id)) fixes.push(`line ${id} nằm ở hai cảnh → giữ cảnh đầu`);
      else owner.set(id, i);
    }
  });
  if (!shots.length) throw new SfError('E_SCHEMA_INVALID', 'direct plan has no shots');
  // line chưa có cảnh → cảnh của line trước (đầu video → cảnh đầu)
  let prev = 0;
  const seq = lines.map((l) => {
    const o = owner.get(l.id);
    if (o === undefined) fixes.push(`line ${l.id} chưa có cảnh → gộp vào cảnh trước`);
    prev = o ?? prev;
    return { l, shot: prev };
  });
  // gom line liền nhau cùng cảnh thành frame
  const runs: { shot: number; lines: LineInfo[] }[] = [];
  for (const x of seq) {
    const last = runs[runs.length - 1];
    if (last && last.shot === x.shot) last.lines.push(x.l);
    else runs.push({ shot: x.shot, lines: [x.l] });
  }
  const frames: FramePlan[] = [];
  const seen = new Set<number>();
  for (const r of runs) {
    const { si, shot } = shots[r.shot]!;
    // cảnh dài nhiều line → tách theo line, mỗi phần ≤ maxShotMs (line dài một mình giữ nguyên)
    const parts: LineInfo[][] = [];
    for (const l of r.lines) {
      const cur = parts[parts.length - 1];
      const ms = cur?.reduce((a, x) => a + x.ms, 0) ?? 0;
      if (cur && ms + l.ms <= maxShotMs) cur.push(l);
      else parts.push([l]);
    }
    if (parts.length > 1)
      fixes.push(`cảnh dài ${r.lines.map((l) => l.id).join(',')} tách ${parts.length} frame`);
    parts.forEach((ls, i) => {
      frames.push({ scene: si, shot, lines: ls, continuation: i > 0 || seen.has(r.shot) });
    });
    seen.add(r.shot);
  }
  return { frames, fixes };
}

const MOTION_CYCLE = ['ken-burns-in', 'pan-left', 'ken-burns-out', 'pan-up'];

/** Kế hoạch đã chuẩn hóa → nội dung `STORYBOARD.md` (chưa gán ID). */
export function planToStoryboard(
  videoId: string,
  plan: DirectPlan,
  frames: FramePlan[],
  o: {
    aspect: '9:16' | '16:9';
    libraryIds: Set<string>;
    music: boolean;
    /** Một bài cho cả video: mọi scene dùng truy vấn nhạc đầu tiên. */
    singleMusic?: boolean;
    heroAllowed: boolean;
    castRefs: Record<string, string[]>;
    lipsync: Record<string, { mouth: boolean; anchor?: { x: number; y: number } }>;
  },
): string {
  const images = new Map((plan.images ?? []).map((x) => [x.key, x]));
  const layer = (key: string | null | undefined, kind: 'background' | 'image') => {
    if (!key) return undefined;
    const lib = /^asset:(as_[0-9a-z]{8})$/.exec(key)?.[1];
    const img = images.get(key);
    const asset = lib ?? img?.asset_id;
    if (asset && o.libraryIds.has(asset)) return { kind, asset_id: asset };
    // khóa không khai báo nhưng là mô tả dài → coi là prompt
    let prompt = img?.prompt ?? (key.length > 24 && !images.size ? key : undefined);
    if (!prompt && key.length > 24) prompt = key;
    if (!prompt) return undefined;
    const refs = [...prompt.matchAll(/<cast:([^>]+)>/g)].flatMap((m) => o.castRefs[m[1]!] ?? []);
    prompt = prompt
      .replace(/<cast:([^>]+)>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      kind,
      asset_request: {
        source: 'generate',
        prompt,
        aspect: kind === 'background' ? o.aspect : o.aspect === '9:16' ? '9:16' : '4:3',
        ...(refs.length ? { reference_asset_ids: [...new Set(refs)] } : {}),
      },
    };
  };
  const firstMusic = plan.scenes.map((x) => x.music?.trim()).find(Boolean);
  const out: string[] = [
    '---',
    'schema_version: 1',
    `video_id: ${videoId}`,
    'status: draft',
    '---',
  ];
  let scene = -1;
  let n = 0;
  const usedIds = new Set<string>();
  frames.forEach((f, fi) => {
    if (f.scene !== scene) {
      scene = f.scene;
      const s = plan.scenes[scene]!;
      out.push(`## Scene ${scene + 1} — ${s.title ?? ''}`.trimEnd());
      out.push('```sf-scene');
      out.push(
        stringify({
          title: s.title?.trim() || `Scene ${scene + 1}`,
          ...(s.mood ? { mood: s.mood } : {}),
          music: !o.music
            ? 'none'
            : o.singleMusic
              ? firstMusic
                ? { query: firstMusic }
                : 'none'
              : (s.music?.trim() ?? firstMusic)
                ? { query: (s.music?.trim() || firstMusic)! }
                : 'none',
        }).trimEnd(),
      );
      out.push('```', '');
    }
    n++;
    const s = f.shot;
    const layout = (LAYOUTS as readonly string[]).includes(s.layout ?? '') ? s.layout : undefined;
    const t = s.text ?? {};
    const layers: Record<string, unknown>[] = [];
    const bg = layer(s.image, 'background');
    if (bg) layers.push(bg);
    if (layout === 'image-split') {
      const second = layer(s.image2, 'image');
      if (second) layers.push(second);
    }
    const texts: { text: string; notes?: string }[] = [];
    if (f.continuation) {
      // phần tiếp của cảnh dài: giữ ảnh, chỉ chữ phụ (nếu có)
      const sub = clip(t.sub, 8, 60);
      if (sub) texts.push({ text: sub });
    } else if (layout === 'list' || layout === 'chart-bar') {
      const title = clip(t.main, 8, 60);
      if (layout === 'chart-bar' && title) texts.push({ text: title });
      for (const it of (t.items ?? []).slice(0, layout === 'chart-bar' ? 5 : 4)) {
        const x = clip(it, 8, 48);
        if (x) texts.push({ text: x });
      }
      if (layout === 'list' && !texts.length && title) texts.push({ text: title });
    } else {
      const num = clip(t.number, 3, 16);
      if (num) texts.push({ text: num });
      const main = clip(t.main, 8, 60);
      if (main)
        texts.push({
          text: main,
          ...(s.accent && main.toLowerCase().includes(s.accent.toLowerCase())
            ? { notes: `accent: ${s.accent}` }
            : {}),
        });
      const sub = clip(t.sub, 10, 72);
      if (sub) texts.push({ text: sub });
    }
    for (const x of texts)
      layers.push({ kind: 'text', text: x.text, ...(x.notes ? { notes: x.notes } : {}) });
    // khẩu hình: mọi line của frame do cùng một nhân vật có bộ miệng nói → lớp miệng + frame.lipsync
    const speakers = [...new Set(f.lines.map((l) => l.speaker))];
    const lip = speakers.length === 1 ? o.lipsync[speakers[0]!] : undefined;
    let mouthId: string | undefined;
    if (lip?.mouth) {
      mouthId = newId('el', usedIds);
      usedIds.add(mouthId);
      layers.push({
        id: mouthId,
        kind: 'mouth',
        ...(lip.anchor ? { notes: `anchor: ${lip.anchor.x},${lip.anchor.y}` } : {}),
      });
    }
    if (!layers.length) layers.push({ kind: 'background' });
    const motion = (MOTIONS as readonly string[]).includes(s.motion ?? '')
      ? s.motion!
      : MOTION_CYCLE[fi % MOTION_CYCLE.length]!;
    const tr = TRANSITIONS.includes(s.transition ?? '') ? s.transition! : fi === 0 ? 'cut' : 'cut';
    const frame: Record<string, unknown> = {
      beat_ids: [...new Set(f.lines.map((l) => l.beat_id))],
      line_ids: f.lines.map((l) => l.id),
      ...(layout ? { layout } : {}),
      motion,
      ...(s.hero && o.heroAllowed && !f.continuation ? { hero: true } : {}),
      intent: `${layout ?? 'auto'}${t.main ? `: ${t.main}` : ''}`.slice(0, 120),
      layers,
      transition_in: { type: tr, duration_ms: tr === 'cut' ? 0 : 300 },
      ...(mouthId ? { lipsync: { cast_id: speakers[0]!, mouth_anchor: mouthId } } : {}),
    };
    out.push(`### Frame ${n}`);
    out.push('```sf-frame');
    out.push(stringify(frame).trimEnd());
    out.push('```', '');
  });
  return `${out.join('\n')}\n`;
}

/** Đọc JSON kế hoạch (bỏ rào ```), kiểm khung tối thiểu. */
export function parsePlan(text: string): DirectPlan {
  const j = extractJson(text) as Partial<DirectPlan>;
  if (!Array.isArray(j.scenes) || !j.scenes.length)
    throw new Error('plan must have a non-empty "scenes" array');
  for (const s of j.scenes)
    if (!Array.isArray(s.shots) || !s.shots.length) throw new Error('every scene needs "shots"');
  return { scenes: j.scenes, ...(Array.isArray(j.images) ? { images: j.images } : {}) };
}

/** Model đạo diễn: luôn Opus (Tan chốt 2026-10-10). */
export const DIRECTOR_MODEL: ModelRef = { provider: 'claude', model: DEFAULT_MODELS.claude.critic };

export function directExecutor(d: { text: TextService }) {
  return async (ctx: StepRunContext): Promise<{ outputs: string[]; summary: string }> => {
    const v = `videos/${ctx.videoId}`;
    const videoDir = ctx.store.abs(v);
    const scope = { channelDir: ctx.channelDir, videoId: ctx.videoId };
    const cfg = <T>(k: string) => resolveConfig<T>(k, scope, { appDataDir: ctx.appDataDir }).value;
    const profile = loadOutputProfile(cfg<string | null>('output.profile'));
    const vertical = profile.height > profile.width;
    const params = (ctx.step.params ?? {}) as DirectParams;
    const lines = scriptLines(videoDir);
    if (!lines.length) throw new SfError('E_FILE_NOT_FOUND', 'SCRIPT.md has no lines');
    const read = (rel: string) =>
      existsSync(ctx.store.abs(rel)) ? readFileSync(ctx.store.abs(rel), 'utf8') : undefined;
    const library = readChannelAssets(ctx.store.root)
      .filter((a) => a.kind === 'image' && a.description)
      .slice(-20)
      .map((a) => ({ id: a.id, description: a.description, tags: a.tags ?? [] }));
    // nhân vật (cast kênh + video, 031/032): ảnh tham chiếu cho prompt, bộ miệng + điểm miệng cho khẩu hình
    const vm = loadVideoModel(ctx.store.root, ctx.videoId, ctx.appDataDir);
    const castMembers = Object.entries(vm.cast)
      .filter(([, c]) => c.role !== 'narrator')
      .map(([id, c]) => ({
        id,
        name: c.name ?? id,
        ...((c as { description?: string }).description
          ? { description: (c as { description?: string }).description }
          : {}),
        reference_images: (c.reference_images ?? []) as string[],
        ...(c.mouth_set ? { mouth_set: c.mouth_set } : {}),
        ...(c.mouth_anchor ? { anchor: { x: c.mouth_anchor.x, y: c.mouth_anchor.y } } : {}),
      }));
    const music = cfg<boolean>('advanced.music') !== false;
    const heroAllowed = cfg<boolean>('advanced.custom_frames') === true;
    const language = vm.language;
    const prompt = directPrompt({
      brief: read(`${v}/BRIEF.md`) ?? '',
      language,
      width: profile.width,
      height: profile.height,
      lines,
      params,
      ...(read('profile/style-guide.md') ? { styleGuide: read('profile/style-guide.md')! } : {}),
      library,
      cast: castMembers,
      heroAllowed,
      music,
    });
    ctx.progress?.(0, 2, 'Đạo diễn: lên danh sách cảnh');
    let plan: DirectPlan | undefined;
    let error = '';
    let model = '';
    for (let attempt = 0; attempt < 2 && !plan; attempt++) {
      const res = await d.text.generate(
        'primary',
        {
          role: 'primary',
          messages: [
            {
              role: 'user',
              content: attempt
                ? `${prompt}\n\nYour previous answer could not be used (${error}). Reply with ONLY the JSON object.`
                : prompt,
            },
          ],
          max_tokens: 16000,
          response_format: 'json',
        },
        { store: ctx.store, videoId: ctx.videoId, model: DIRECTOR_MODEL },
      );
      model = res.model;
      try {
        plan = parsePlan(res.text);
      } catch (e) {
        error = (e as Error).message;
      }
    }
    if (!plan) throw new SfError('E_PROVIDER_FAILED', `director returned no usable plan: ${error}`);
    ctx.progress?.(1, 2, 'Đạo diễn: ghi storyboard');
    const maxShotMs = (params.max_shot_s ?? (vertical ? 6 : 8)) * 1000;
    const { frames, fixes } = normalizePlan(plan, lines, maxShotMs);
    const model0 = castMembers;
    const lipOn = cfg<boolean>('lipsync.enabled') === true;
    const text = planToStoryboard(ctx.videoId, plan, frames, {
      aspect: vertical ? '9:16' : '16:9',
      libraryIds: new Set(readChannelAssets(ctx.store.root).map((a) => a.id)),
      music,
      singleMusic: params.music !== 'per-scene',
      heroAllowed,
      castRefs: Object.fromEntries(model0.map((c) => [c.id, c.reference_images])),
      lipsync: Object.fromEntries(
        model0.map((c) => [
          c.id,
          // bộ miệng riêng hoặc bộ mặc định (032) — mọi nhân vật nói được khi bật khẩu hình
          { mouth: lipOn, ...(c.anchor ? { anchor: c.anchor } : {}) },
        ]),
      ),
    });
    const { text: withIds } = assignStoryboardIds(text);
    ctx.store.write(`${v}/STORYBOARD.md`, withIds, { by: 'direct' });
    const imgs = frames.filter((f) => f.shot.image).length;
    return {
      outputs: ['STORYBOARD.md'],
      summary: `Đạo diễn (${model}): ${frames.length} cảnh, ${imgs} cảnh có ảnh, ${plan.scenes.length} scene.${fixes.length ? ` App tự chỉnh: ${fixes.slice(0, 4).join('; ')}${fixes.length > 4 ? '…' : ''}.` : ''}`,
    };
  };
}
