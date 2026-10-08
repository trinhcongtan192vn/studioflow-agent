import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CaptionGroups, CaptionOverrides } from '../contracts/types.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { SfError } from '../errors.js';
import { captionsToSrt } from '../publish/youtube-meta.js';
import { copyOutsideProject, writeOutsideProject } from '../store/scratch.js';

/**
 * 066 — xuất video ra thư mục người dùng chọn (constitution 1.2, Điều VI ngoại lệ): chỉ **sao chép** bản
 * render (+ hình đại diện, phụ đề, mô tả) ra ngoài kênh; không ghi đè (trùng tên → ` (2)`…); project chỉ đọc.
 */
export interface RenderEntry {
  render_id: string;
  mode: 'draft' | 'release';
  output_profile: string;
  finished_at: string;
  duration_ms?: number;
  /** Đường dẫn tuyệt đối tới `video.mp4`. */
  file: string;
}

export interface ExportInclude {
  thumbnail?: boolean;
  captions?: boolean;
  description?: boolean;
}

/** Bản render đã xong và còn file, mới nhất trước. */
export function listRenders(channel: string, video: string): RenderEntry[] {
  const vdir = path.join(channel, 'videos', video);
  const dir = path.join(vdir, 'renders');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((rd): RenderEntry[] => {
      try {
        const r = JSON.parse(readFileSync(path.join(dir, rd, 'render.json'), 'utf8')) as {
          id: string;
          mode: RenderEntry['mode'];
          status: string;
          file?: string;
          output_profile: string;
          duration_ms?: number;
          finished_at?: string;
        };
        if (r.status !== 'done' || !r.file) return [];
        const file = path.join(vdir, ...r.file.split('/'));
        if (!existsSync(file)) return [];
        return [
          {
            render_id: r.id,
            mode: r.mode,
            output_profile: r.output_profile,
            finished_at: r.finished_at ?? '',
            ...(r.duration_ms ? { duration_ms: r.duration_ms } : {}),
            file,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.finished_at.localeCompare(a.finished_at));
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Tên file hợp lệ trên Windows: bỏ ký tự cấm, gộp khoảng trắng, bỏ dấu chấm/khoảng ở cuối. */
export function safeFileName(name: string): string {
  const s = name
    .replace(/[<>:"/\\|?*]/g, '')
    // ký tự điều khiển (Windows cấm) → khoảng trắng, gộp ở bước sau
    .replace(/[\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 150)
    .trim();
  if (!s) return 'video';
  return RESERVED.test(s) ? `${s}_` : s;
}

const clock = (ms: number) => {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

function readMeta(vdir: string) {
  const pf = path.join(vdir, 'publish.md');
  let working = '';
  try {
    working = String(
      parseBlocksDoc(readFileSync(path.join(vdir, 'BRIEF.md'), 'utf8')).front.title_working ?? '',
    );
  } catch {
    /* không có brief */
  }
  if (!existsSync(pf)) return { title: working, publish: undefined };
  const b = parseBlocksDoc(readFileSync(pf, 'utf8'));
  return {
    title: String(b.front.title ?? '') || working,
    publish: {
      description: b.body.join('\n').trim(),
      tags: Array.isArray(b.front.tags) ? (b.front.tags as unknown[]).map(String) : [],
      chapters: Array.isArray(b.front.chapters)
        ? (b.front.chapters as { start_ms: number; title: string }[])
        : [],
    },
  };
}

export function exportVideo(o: {
  channel: string;
  video: string;
  dest_dir: string;
  render_id?: string;
  include?: ExportInclude;
  name?: string;
}): { dir: string; files: string[]; skipped: (keyof ExportInclude)[] } {
  const renders = listRenders(o.channel, o.video);
  const r = o.render_id
    ? renders.find((x) => x.render_id === o.render_id)
    : (renders.find((x) => x.mode === 'release') ?? renders[0]);
  if (!r)
    throw new SfError(
      'E_FILE_NOT_FOUND',
      o.render_id ? `render ${o.render_id} not found` : 'video has no finished render to export',
    );
  const dest = path.resolve(o.dest_dir);
  const rel = path.relative(path.resolve(o.channel), dest);
  if (!path.isAbsolute(o.dest_dir) || !rel || (!rel.startsWith('..') && !path.isAbsolute(rel)))
    throw new SfError('E_SCHEMA_INVALID', 'choose a folder outside the channel to export into');
  if (!existsSync(dest) || !statSync(dest).isDirectory())
    throw new SfError('E_FILE_NOT_FOUND', `folder ${dest} does not exist`);

  const vdir = path.join(o.channel, 'videos', o.video);
  const meta = readMeta(vdir);
  const inc = o.include ?? {};
  const skipped: (keyof ExportInclude)[] = [];
  // nguồn của từng file: [đuôi, nội dung | đường dẫn nguồn]
  const parts: [string, { copy: string } | { text: string }][] = [['.mp4', { copy: r.file }]];
  if (inc.thumbnail) {
    const t = ['thumbnail.jpg', 'thumbnail.png'].find((f) => existsSync(path.join(vdir, f)));
    if (t) parts.push([path.extname(t), { copy: path.join(vdir, t) }]);
    else skipped.push('thumbnail');
  }
  if (inc.captions) {
    let srt = '';
    try {
      const gf = path.join(vdir, 'caption_groups.json');
      const of = path.join(vdir, 'caption-overrides.json');
      if (existsSync(gf))
        srt = captionsToSrt(
          JSON.parse(readFileSync(gf, 'utf8')) as CaptionGroups,
          existsSync(of) ? (JSON.parse(readFileSync(of, 'utf8')) as CaptionOverrides) : undefined,
        );
    } catch {
      srt = '';
    }
    if (srt) parts.push(['.srt', { text: srt }]);
    else skipped.push('captions');
  }
  if (inc.description) {
    const p = meta.publish;
    if (p && (meta.title || p.description)) {
      const text = [
        meta.title,
        p.description,
        p.chapters.length
          ? p.chapters.map((c) => `${clock(c.start_ms)} ${c.title}`).join('\n')
          : '',
        p.tags.length ? p.tags.map((t) => `#${t.replace(/\s+/g, '')}`).join(' ') : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      parts.push(['.txt', { text: `${text}\n` }]);
    } else skipped.push('description');
  }

  const base =
    safeFileName(o.name?.trim() || meta.title || o.video) +
    (r.mode === 'draft' && !o.name ? ' (nháp)' : '');
  let name = base;
  for (let n = 2; parts.some(([ext]) => existsSync(path.join(dest, name + ext))); n++)
    name = `${base} (${n})`;
  const files = parts.map(([ext, src]) => {
    const f = path.join(dest, name + ext);
    if ('copy' in src) copyOutsideProject(src.copy, f);
    else writeOutsideProject(f, src.text);
    return f;
  });
  return { dir: dest, files, skipped };
}
