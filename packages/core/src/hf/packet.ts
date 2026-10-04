import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXTENSIONS_DIR } from '../agent/options.js';
import type { AssetManifest, FramePacket } from '../contracts/types.js';
import type { VideoModel } from '../graph/model.js';
import type { FrameTiming } from '../graph/timing.js';
import type { WriteStore } from '../store/writer.js';
import { framePlacements } from './index-html.js';
import { loadOutputProfile } from './outputs.js';

export function readChannelAssets(channelDir: string): AssetManifest['assets'] {
  const f = path.join(channelDir, 'assets', 'manifest.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as AssetManifest).assets : [];
}

/**
 * Đặt asset của frame vào `public/` của video (chép từ thư viện kênh nếu chưa có); trả danh sách cho
 * packet. Asset thiếu file → bỏ qua (packet ghi quy tắc vẽ bằng code thay thế).
 */
export function stageFrameAssets(
  store: WriteStore,
  videoId: string,
  layers: FramePacket['frame']['layers'],
  /** Asset do nút `asset` sinh cho layer chưa có `asset_id` (020): layer id → asset id. */
  generated: Record<string, string> = {},
): FramePacket['assets'] {
  const lib = readChannelAssets(store.root);
  const out: FramePacket['assets'] = [];
  for (const l of layers) {
    const assetId = l.asset_id ?? generated[l.id];
    if (!assetId) continue;
    const a = lib.find((x) => x.id === assetId);
    if (!a || !existsSync(store.abs(a.file))) continue;
    const file = `public/${a.id}${path.extname(a.file)}`;
    const dest = `videos/${videoId}/${file}`;
    if (!existsSync(store.abs(dest))) store.copyWithin(a.file, dest, { by: 'asset.stage' });
    out.push({
      asset_id: a.id,
      file,
      width: a.width ?? 0,
      height: a.height ?? 0,
      alpha: a.alpha ?? false,
    });
  }
  return out;
}

/** Frame packet (D6 mục 5) cho một frame. */
export function buildFramePacket(i: {
  model: VideoModel;
  timing: FrameTiming;
  frameId: string;
  assets: FramePacket['assets'];
  /** Asset do nút `asset` sinh (020): layer id → asset id; gắn vào layer của packet. */
  generated?: Record<string, string>;
}): FramePacket {
  const { model, timing } = i;
  const found = model.frames.find((f) => f.id === i.frameId);
  if (!found) throw new Error(`frame ${i.frameId} not in STORYBOARD.md`);
  const gen = i.generated ?? {};
  const frame = {
    ...found,
    layers: found.layers.map((l) =>
      !l.asset_id && gen[l.id] ? { ...l, asset_id: gen[l.id] as typeof l.asset_id } : l,
    ),
  };
  const scene = model.scenes.find((s) => s.id === frame.scene_id)!;
  const place = framePlacements(
    model.frames.map((f) => {
      const t = timing.frames.find((x) => x.id === f.id)!;
      return {
        id: f.id,
        start_ms: t.start_ms,
        duration_ms: t.duration_ms,
        ...(f.transition_in ? { transition_in: f.transition_in } : {}),
      };
    }),
  ).find((p) => p.id === frame.id)!;
  const profile = loadOutputProfile(model.config('output.profile') as string | null);
  const bp = frame.blueprint
    ? path.join(model.channelDir, 'profile', 'references', 'blueprints', frame.blueprint)
    : undefined;
  const missingAssets = frame.layers
    .filter((l) => l.asset_id && !i.assets.some((a) => a.asset_id === l.asset_id))
    .map((l) => l.id);
  const cutoff = Math.round(profile.height * 0.83);
  const karaoke = model.config('caption.style') === 'caption-pill-karaoke';
  return {
    video_id: model.videoId as FramePacket['video_id'],
    frame,
    scene,
    lines: model.lines.filter((l) => frame.line_ids.includes(l.id)),
    timing: {
      start_ms: Math.round(place.start * 1000),
      duration_ms: Math.round(place.duration * 1000),
    },
    design_system: 'frame.md',
    ...(bp && existsSync(bp)
      ? {
          blueprint: {
            id: frame.blueprint!,
            path: `profile/references/blueprints/${frame.blueprint}`,
            vars: {},
          },
        }
      : {}),
    assets: i.assets,
    output_path: `compositions/frames/${frame.id}.html`,
    rules: [
      // vùng an toàn lệch (shorts, 030) → nêu từng cạnh theo px; đều → câu cũ (giữ bản ghi LLM)
      Object.values(profile.safe_area).every((x) => x === profile.safe_area.left)
        ? `Canvas ${profile.width}×${profile.height}; vùng an toàn ${Math.round(profile.safe_area.left * 100)}% mỗi cạnh.`
        : `Canvas ${profile.width}×${profile.height}; vùng an toàn (chữ phải nằm trong): x ${Math.round(profile.width * profile.safe_area.left)}–${Math.round(profile.width * (1 - profile.safe_area.right))}px, y ${Math.round(profile.height * profile.safe_area.top)}–${Math.round(profile.height * (1 - profile.safe_area.bottom))}px.`,
      // 030: caption karaoke ở giữa màn hình (shorts) → dải giữ chỗ khác
      karaoke
        ? `Dải caption: y ${Math.round(profile.height * 0.5)}–${Math.round(profile.height * 0.66)}px để trống cho caption lớn; đặt chữ của frame phía trên hoặc dưới dải này.`
        : `Dải caption: mọi nội dung nằm trên y ≤ ${cutoff}px (17% dưới dành cho caption).`,
      `Ngôn ngữ chữ trên hình: ${model.language}. Chỉ dùng font-family chung (sans-serif, serif, system-ui, monospace) — không đặt tên font không có file.`,
      `Thời lượng frame ${place.duration.toFixed(3)} s${place.tail ? ` (gồm ${place.tail.toFixed(3)} s giữ khung cuối cho transition sang frame sau)` : ''}; mọi clip kéo tới hết thời lượng.`,
      ...(missingAssets.length
        ? [
            `Layer ${missingAssets.join(', ')} chưa có asset: vẽ bằng code (SVG/HTML) theo intent và notes.`,
          ]
        : []),
    ],
  };
}

export const FRAME_WORKER_ROLE = path.join(
  EXTENSIONS_DIR,
  'studioflow-core',
  'hf',
  'frame-worker.md',
);

/** Chỉ dẫn gửi phiên `frame` (011 R2): vai + packet + `frame.md`. */
export function frameInstruction(
  p: FramePacket,
  frameMd: string,
  stepId: string,
  feedback?: string,
): string {
  return [
    readFileSync(FRAME_WORKER_ROLE, 'utf8'),
    '',
    `# Nhiệm vụ`,
    `Dựng frame \`${p.frame.id}\` của video \`${p.video_id}\`. Ghi đúng một file \`${p.output_path}\` bằng tool artifact.write, rồi gọi workflow.step_complete với {"step_id": "${stepId}", "frame_id": "${p.frame.id}", "outputs": ["${p.output_path}"], "new_element_ids": [<data-sf-id phụ đã thêm>]}.`,
    ...(feedback ? ['', '# Lần trước chưa đạt — sửa hết các lỗi sau', feedback] : []),
    '',
    '# Frame packet',
    '```json',
    JSON.stringify(p, null, 2),
    '```',
    '',
    '# frame.md (design system)',
    frameMd,
  ].join('\n');
}
