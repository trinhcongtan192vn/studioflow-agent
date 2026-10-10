import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfig } from '../config/resolve.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';
import { LAYOUTS, MOTIONS } from '../hf/templates.js';
import { extractJson, type TextService } from '../text/service.js';
import { DEFAULT_MODELS, type ModelRef } from '../text/models.js';

/**
 * Design system cấp kênh (Tan 2026-10-10): định nghĩa một lần trong `profile/design-system.json`, mọi video của
 * kênh theo đó — màu + chữ cho bộ layout, **phong cách ảnh khóa** cho mọi prompt ảnh, layout/chuyển động ưu tiên,
 * tâm trạng nhạc. Tạo bằng AI đề xuất (Opus, 2–3 phương án kèm ảnh mẫu Qwen), người dùng chọn rồi chỉnh.
 */
export interface ChannelDesign {
  schema_version: 1;
  name: string;
  /** Vì sao hợp kênh (một câu). */
  rationale?: string;
  colors: {
    canvas: string;
    surface: string;
    ink: string;
    muted: string;
    accent: string;
    accent2: string;
  };
  /** Họ font chung (chỉ font hệ thống: sans-serif, serif, system-ui, monospace + tên phổ biến). */
  fonts: { title: string; body: string };
  text: { case: 'upper' | 'sentence'; weight: number };
  image_style: {
    /** Chất liệu: ảnh thật điện ảnh, 3D, minh họa phẳng… */
    medium: string;
    lighting: string;
    palette: string;
    camera: string;
    /** Không bao giờ có trong ảnh. */
    avoid: string;
  };
  layouts: { prefer: string[]; avoid: string[] };
  motion: { pace: 'calm' | 'medium' | 'fast'; prefer: string[] };
  music: { mood: string };
  /** Ảnh mẫu (asset kênh) cho phương án. */
  sample_asset_id?: string;
  /** Chủ thể ảnh mẫu (prompt). */
  sample_subject?: string;
  updated_at?: string;
}

const REL = 'profile/design-system.json';
const PROPOSALS = 'profile/design-proposals.json';

const readJson = <T>(f: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

export function readChannelDesign(channelDir: string): ChannelDesign | undefined {
  return readJson<ChannelDesign>(path.join(channelDir, REL));
}

export function readProposals(channelDir: string): ChannelDesign[] {
  return (
    readJson<{ proposals: ChannelDesign[] }>(path.join(channelDir, PROPOSALS))?.proposals ?? []
  );
}

const HEX = /^#[0-9a-f]{6}$/i;
const clean = (s: unknown, max = 200) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Chuẩn hóa một design (từ AI hoặc người dùng sửa): màu hex 6 chữ số, layout/chuyển động hợp lệ. */
export function normalizeDesign(d: Partial<ChannelDesign>): ChannelDesign {
  const c = (d.colors ?? {}) as Partial<ChannelDesign['colors']>;
  const col = (v: unknown, dflt: string) =>
    typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : dflt;
  const lay = (xs: unknown) =>
    (Array.isArray(xs) ? xs : []).filter((x): x is string =>
      (LAYOUTS as readonly string[]).includes(x),
    );
  return {
    schema_version: 1,
    name: clean(d.name, 60) || 'Design system',
    ...(d.rationale ? { rationale: clean(d.rationale, 300) } : {}),
    colors: {
      canvas: col(c.canvas, '#101418'),
      surface: col(c.surface, '#1b222b'),
      ink: col(c.ink, '#f4f1ea'),
      muted: col(c.muted, '#a7b0ba'),
      accent: col(c.accent, '#e8b04a'),
      accent2: col(c.accent2, '#4fb3a9'),
    },
    fonts: {
      title: clean(d.fonts?.title, 80).replace(/[^\w\s,-]/g, '') || 'system-ui, sans-serif',
      body: clean(d.fonts?.body, 80).replace(/[^\w\s,-]/g, '') || 'sans-serif',
    },
    text: {
      case: d.text?.case === 'upper' ? 'upper' : 'sentence',
      weight: [400, 500, 600, 700, 800, 900].includes(Number(d.text?.weight))
        ? Number(d.text?.weight)
        : 800,
    },
    image_style: {
      medium: clean(d.image_style?.medium) || 'cinematic photoreal',
      lighting: clean(d.image_style?.lighting),
      palette: clean(d.image_style?.palette),
      camera: clean(d.image_style?.camera),
      avoid: clean(d.image_style?.avoid) || 'text, letters, logos, watermarks',
    },
    layouts: { prefer: lay(d.layouts?.prefer), avoid: lay(d.layouts?.avoid) },
    motion: {
      pace: d.motion?.pace === 'calm' || d.motion?.pace === 'fast' ? d.motion.pace : 'medium',
      prefer: (Array.isArray(d.motion?.prefer) ? d.motion!.prefer : []).filter((x) =>
        (MOTIONS as readonly string[]).includes(x),
      ),
    },
    music: { mood: clean(d.music?.mood) },
    ...(d.sample_asset_id ? { sample_asset_id: d.sample_asset_id } : {}),
    ...(d.sample_subject ? { sample_subject: clean(d.sample_subject, 300) } : {}),
  };
}

/** Phần prompt ảnh bắt buộc (mọi ảnh của kênh). */
export function imageStyleSuffix(d: ChannelDesign): string {
  const s = d.image_style;
  return [s.medium, s.lighting, s.palette, s.camera, s.avoid ? `no ${s.avoid}` : '']
    .filter(Boolean)
    .join(', ');
}

/** Băm phần "nhìn" (màu, chữ, layout, chuyển động) và phần "ảnh" (phong cách ảnh) — để biết video lệch phần nào. */
export function designHashes(d: ChannelDesign): { look: string; images: string } {
  return {
    look: sha256(
      canonicalJson({ c: d.colors, f: d.fonts, t: d.text, l: d.layouts, m: d.motion }),
    ).slice(0, 12),
    images: sha256(canonicalJson(d.image_style)).slice(0, 12),
  };
}

export function saveChannelDesign(store: WriteStore, d: Partial<ChannelDesign>): ChannelDesign {
  const n = { ...normalizeDesign(d), updated_at: new Date().toISOString() };
  store.write(REL, `${JSON.stringify(n, null, 2)}\n`, { by: 'design.save', validate: false });
  return n;
}

/** `frame.md` của video từ design kênh (định dạng bộ layout đọc: `- canvas: #hex`, `Họ font: \`…\``). */
export function frameMdFromDesign(d: ChannelDesign, channelName: string): string {
  const h = designHashes(d);
  const c = d.colors;
  return [
    '---',
    'schema_version: 1',
    `design_look: ${h.look}`,
    `design_images: ${h.images}`,
    '---',
    `# frame.md — design system của kênh: ${d.name}`,
    '',
    `Kênh: ${channelName}`,
    '',
    '## Màu',
    `- canvas: ${c.canvas}`,
    `- surface: ${c.surface}`,
    `- ink (chữ chính): ${c.ink}`,
    `- muted (chữ phụ): ${c.muted}`,
    `- accent (nhấn): ${c.accent}`,
    `- accent-2: ${c.accent2}`,
    '',
    '## Chữ',
    `- Họ font: \`${d.fonts.title}\` (tiêu đề), \`${d.fonts.body}\` (thân).`,
    `- text-case: ${d.text.case}`,
    `- weight: ${d.text.weight}`,
    '',
    '## Ảnh (khóa cho mọi ảnh của kênh)',
    `- ${imageStyleSuffix(d)}`,
    '',
    '## Bố cục và chuyển động',
    `- Layout ưu tiên: ${d.layouts.prefer.join(', ') || '—'}; tránh: ${d.layouts.avoid.join(', ') || '—'}`,
    `- Nhịp: ${d.motion.pace}; chuyển động ưu tiên: ${d.motion.prefer.join(', ') || '—'}`,
    '',
    '## Nhạc',
    `- ${d.music.mood || '—'}`,
    '',
  ].join('\n');
}

/** Video lệch design kênh: phần nhìn (dựng lại hình) hay phần ảnh (sinh lại ảnh). */
export function videoDesignStatus(
  store: WriteStore,
  videoId: string,
): { stale: false } | { stale: true; images: boolean; design: string } {
  const d = readChannelDesign(store.root);
  if (!d) return { stale: false };
  const f = store.abs(`videos/${videoId}/frame.md`);
  if (!existsSync(f)) return { stale: false };
  const text = readFileSync(f, 'utf8');
  const look = /^design_look: (\S+)$/m.exec(text)?.[1];
  const images = /^design_images: (\S+)$/m.exec(text)?.[1];
  const h = designHashes(d);
  if (look === h.look && images === h.images) return { stale: false };
  return { stale: true, images: images !== h.images, design: d.name };
}

export const DESIGNER_MODEL: ModelRef = { provider: 'claude', model: DEFAULT_MODELS.claude.critic };

/** Thông tin kênh cho AI đề xuất design: tên, ngôn ngữ, chủ đề trụ cột, hướng dẫn phong cách, video gần đây. */
function channelBrief(store: WriteStore, appDataDir?: string): string {
  const ch = readJson<{ name?: string; language?: string; config?: Record<string, unknown> }>(
    path.join(store.root, 'channel.json'),
  );
  const cfg = (k: string) => resolveConfig(k, { channelDir: store.root }, { appDataDir }).value;
  const style = existsSync(path.join(store.root, 'profile', 'style-guide.md'))
    ? readFileSync(path.join(store.root, 'profile', 'style-guide.md'), 'utf8').slice(0, 1500)
    : '';
  const vids = existsSync(path.join(store.root, 'videos'))
    ? readdirSync(path.join(store.root, 'videos'))
        .slice(-8)
        .map((v) => {
          const b = path.join(store.root, 'videos', v, 'BRIEF.md');
          return existsSync(b) ? /^title:\s*(.+)$/m.exec(readFileSync(b, 'utf8'))?.[1] : undefined;
        })
        .filter(Boolean)
    : [];
  return [
    `Channel: ${ch?.name ?? ''} (language: ${ch?.language ?? ''})`,
    `Pillars: ${JSON.stringify(cfg('autopilot.pillars') ?? [])}`,
    `Workflows: ${JSON.stringify(cfg('autopilot.workflows') ?? [])}`,
    ...(vids.length ? [`Recent videos: ${vids.join(' | ')}`] : []),
    ...(style ? ['Style guide:', style] : []),
  ].join('\n');
}

/** Opus đề xuất `n` design system khác nhau rõ rệt cho kênh (JSON), lưu `profile/design-proposals.json`. */
export async function proposeDesigns(
  text: TextService,
  store: WriteStore,
  appDataDir?: string,
  n = 3,
): Promise<ChannelDesign[]> {
  const prompt = [
    `You are the creative director of a faceless YouTube channel. Propose ${n} clearly different visual design systems for the channel below. Every video of the channel will follow the chosen one: a code layout engine uses the colors/fonts, and a local image model (Qwen Image) generates every shot with the image style.`,
    '',
    channelBrief(store, appDataDir),
    '',
    'Rules: colors are 6-digit hex with strong contrast between ink and canvas (WCAG AA); fonts are generic families only (sans-serif, serif, system-ui, monospace, or common system fonts like "Georgia, serif"); image_style is concrete enough to keep every image consistent (medium, lighting, palette, camera/composition, avoid). sample_subject is one representative shot for this channel to preview the style.',
    `Layouts: ${LAYOUTS.join(', ')}. Motions: ${MOTIONS.join(', ')}.`,
    '',
    'Reply with ONLY this JSON:',
    JSON.stringify({
      proposals: [
        {
          name: '…',
          rationale: 'why it fits the channel (one sentence)',
          colors: {
            canvas: '#…',
            surface: '#…',
            ink: '#…',
            muted: '#…',
            accent: '#…',
            accent2: '#…',
          },
          fonts: { title: 'system-ui, sans-serif', body: 'sans-serif' },
          text: { case: 'upper', weight: 800 },
          image_style: {
            medium: '…',
            lighting: '…',
            palette: '…',
            camera: '…',
            avoid: 'text, letters, logos',
          },
          layouts: { prefer: ['image-title'], avoid: [] },
          motion: { pace: 'medium', prefer: ['ken-burns-in'] },
          music: { mood: '…' },
          sample_subject: '…',
        },
      ],
    }),
  ].join('\n');
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await text.generate(
      'primary',
      {
        role: 'primary',
        messages: [
          {
            role: 'user',
            content: attempt
              ? `${prompt}\n\nPrevious answer was not valid JSON (${last}).`
              : prompt,
          },
        ],
        max_tokens: 8000,
        response_format: 'json',
      },
      { store, model: DESIGNER_MODEL },
    );
    try {
      const j = extractJson(r.text) as { proposals?: Partial<ChannelDesign>[] };
      const list = (j.proposals ?? []).slice(0, n).map(normalizeDesign);
      if (!list.length) throw new Error('no proposals');
      store.write(PROPOSALS, `${JSON.stringify({ proposals: list }, null, 2)}\n`, {
        by: 'design.propose',
        validate: false,
      });
      return list;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  throw new SfError('E_PROVIDER_FAILED', `design proposals: ${last}`);
}

/** Gắn ảnh mẫu (asset kênh) vào phương án `index`. */
export function setProposalSample(store: WriteStore, index: number, assetId: string): void {
  const list = readProposals(store.root);
  if (!list[index]) return;
  list[index] = { ...list[index]!, sample_asset_id: assetId };
  store.write(PROPOSALS, `${JSON.stringify({ proposals: list }, null, 2)}\n`, {
    by: 'design.sample',
    validate: false,
  });
}

/** Chọn phương án `index` làm design system của kênh. */
export function chooseProposal(store: WriteStore, index: number): ChannelDesign {
  const p = readProposals(store.root)[index];
  if (!p) throw new SfError('E_ID_UNKNOWN', `no design proposal #${index + 1}`);
  return saveChannelDesign(store, p);
}

/** Job nền `design.propose`: Opus đề xuất phương án, rồi sinh ảnh mẫu cho từng phương án (ảnh lỗi → bỏ qua). */
export async function runDesignProposal(
  d: {
    text: TextService;
    sample: (prompt: string) => Promise<string>;
  },
  store: WriteStore,
  appDataDir: string | undefined,
  progress?: (done: number, total: number, message?: string) => void,
): Promise<{ proposals: number; samples: number }> {
  progress?.(0, 4, 'AI đang đề xuất design system');
  const list = await proposeDesigns(d.text, store, appDataDir);
  let samples = 0;
  for (const [i, p] of list.entries()) {
    progress?.(i + 1, list.length + 1, `Ảnh mẫu phương án ${i + 1}/${list.length}`);
    try {
      const id = await d.sample(
        `${p.sample_subject ?? 'a representative scene'}, ${imageStyleSuffix(p)}`,
      );
      setProposalSample(store, i, id);
      samples++;
    } catch {
      /* máy chưa có bộ sinh ảnh / ảnh lỗi: phương án vẫn chọn được */
    }
  }
  return { proposals: list.length, samples };
}
