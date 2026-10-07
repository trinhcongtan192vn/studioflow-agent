import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveConfig } from '../config/resolve.js';
import type { ProviderRegistry } from '../capability/registry.js';
import { SfError } from '../errors.js';
import { runHf } from '../hf/cli.js';
import { gsapSource, GSAP_LOCAL } from '../hf/gsap.js';
import { groundColor } from '../hf/index-builder.js';
import { generateImage } from '../image/service.js';
import { ffmpegPath } from '../models/install.js';
import { loadOutputProfile } from '../hf/outputs.js';
import { createScratchDir, writeOutsideProject } from '../store/scratch.js';
import type { Db } from '../store/db.js';
import type { TextService } from '../text/service.js';
import type { StepRunContext } from '../workflow/engine.js';
import { registerObjective } from '../workflow/gates.js';

/**
 * 063: bước `thumbnail` — hình đại diện YouTube 1280×720 (JPEG ≤ 2 MB) theo phong cách kênh: một câu móc
 * ngắn chữ to + ảnh nền sinh theo look kênh (hỏng → ảnh lớn nhất của video, hoặc nền màu kênh). Video dọc (Shorts)
 * bỏ qua (API YouTube không đặt hình đại diện cho Shorts). Publisher 053 tải `thumbnail.jpg` lên.
 */
export const THUMB_W = 1280;
export const THUMB_H = 720;
export const THUMB_FILE = 'thumbnail.jpg';
export const THUMB_MAX_BYTES = 2 * 1024 * 1024;

/** Kích thước ảnh JPEG từ marker SOF (không giải mã ảnh); không phải JPEG → undefined. */
export function jpegSize(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return undefined;
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 trừ DHT(C4), JPG(C8), DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return undefined;
}

/** Màu nhấn trong `frame.md` (`accent: #xxxxxx` hoặc `--accent`). */
export function accentColor(frameMd: string | undefined): string | undefined {
  if (!frameMd) return undefined;
  return /\baccent\b[^#\n]*?(#[0-9a-fA-F]{3,8})\b/.exec(frameMd)?.[1];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Trang HyperFrames một khung: ảnh nền + câu móc chữ to (font/màu kênh). */
export function thumbnailHtml(o: {
  headline: string;
  bg: string;
  font: string;
  accent: string;
  ground: string;
}): string {
  return `<!doctype html><html><head><meta charset="UTF-8" /><script src="${GSAP_LOCAL}"></script><style>
html,body{margin:0;width:${THUMB_W}px;height:${THUMB_H}px;overflow:hidden;background:${o.ground}}
#root{position:relative;width:${THUMB_W}px;height:${THUMB_H}px;overflow:hidden;background:${o.ground}}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.78) 0%,rgba(0,0,0,.45) 48%,rgba(0,0,0,0) 75%)}
.bar{position:absolute;left:64px;bottom:96px;width:14px;height:300px;background:${o.accent};border-radius:7px}
.hl{position:absolute;left:104px;bottom:90px;width:760px;font-family:"${esc(o.font)}",sans-serif;font-weight:900;font-size:104px;line-height:1.02;color:#fff;text-transform:uppercase;letter-spacing:-1px;text-shadow:0 6px 0 rgba(0,0,0,.55),0 0 24px rgba(0,0,0,.6)}
.hl b{color:${o.accent}}
</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="1" data-width="${THUMB_W}" data-height="${THUMB_H}">
${
  o.bg
    ? `<img class="clip bg" src="${esc(o.bg)}" data-start="0" data-duration="1" data-track-index="0" alt="" />
`
    : ''
}<div class="clip shade" data-start="0" data-duration="1" data-track-index="1"></div>
<div class="clip bar" data-start="0" data-duration="1" data-track-index="2"></div>
<div class="clip hl" data-start="0" data-duration="1" data-track-index="3">${headlineHtml(o.headline)}</div>
</div><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});tl.set("#root",{opacity:1},1);window.__timelines["main"]=tl;</script></body></html>`;
}

/** Từ cuối câu móc tô màu nhấn (nhấn mạnh), phần còn lại trắng. */
export function headlineHtml(headline: string): string {
  const words = headline.trim().split(/\s+/);
  if (words.length < 2) return esc(headline.trim());
  return `${esc(words.slice(0, -1).join(' '))} <b>${esc(words[words.length - 1]!)}</b>`;
}

/** Câu móc ≤ 5 từ: rút gọn tiêu đề khi không có LLM. */
export function fallbackHeadline(title: string): string {
  const clean = title
    .replace(/[|–—:].*$/, '')
    .replace(/[?!.…"“”]/g, '')
    .trim();
  return clean.split(/\s+/).slice(0, 5).join(' ');
}

/** Đầu ra LLM → `{headline, image_prompt}` (bỏ qua chữ thừa quanh JSON). */
export function parseThumbnailIdea(
  text: string,
): { headline: string; image_prompt: string } | undefined {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return undefined;
  try {
    const j = JSON.parse(m[0]) as { headline?: unknown; image_prompt?: unknown };
    const headline = String(j.headline ?? '').trim();
    const image_prompt = String(j.image_prompt ?? '').trim();
    if (!headline || !image_prompt) return undefined;
    return { headline: headline.split(/\s+/).slice(0, 6).join(' '), image_prompt };
  } catch {
    return undefined;
  }
}

/** Kiểm `thumbnail_valid`: video ngang có `thumbnail.jpg` JPEG 16:9 ≤ 2 MB; video dọc bỏ qua. */
export function thumbnailCheck(
  abs: (rel: string) => string,
  videoId: string,
  vertical: boolean,
): { pass: boolean; detail?: string } {
  if (vertical) return { pass: true };
  const f = abs(`videos/${videoId}/${THUMB_FILE}`);
  if (!existsSync(f)) return { pass: false, detail: `${THUMB_FILE} missing` };
  const size = statSync(f).size;
  if (size > THUMB_MAX_BYTES)
    return { pass: false, detail: `${THUMB_FILE} is ${size} bytes (> 2 MB)` };
  const dim = jpegSize(readFileSync(f));
  if (!dim) return { pass: false, detail: `${THUMB_FILE} is not a JPEG` };
  if (Math.abs(dim.width / dim.height - 16 / 9) > 0.02)
    return { pass: false, detail: `${THUMB_FILE} is ${dim.width}×${dim.height}, expected 16:9` };
  return { pass: true };
}

const isVertical = (channelDir: string, videoId: string, appDataDir?: string) => {
  const p = loadOutputProfile(
    resolveConfig('output.profile', { channelDir, videoId }, { appDataDir }).value as string | null,
  );
  return p.height > p.width;
};

registerObjective('thumbnail_valid', (ctx) =>
  thumbnailCheck(
    (rel) => ctx.store.abs(rel),
    ctx.videoId,
    isVertical(ctx.store.root, ctx.videoId, ctx.appDataDir),
  ),
);

function ffmpeg(appDataDir: string | undefined, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(appDataDir ?? ''), ['-hide_banner', '-loglevel', 'error', ...args], {
      windowsHide: true,
    });
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', (e) => reject(new SfError('E_PROVIDER_UNAVAILABLE', `ffmpeg: ${e.message}`)));
    p.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new SfError('E_PROVIDER_FAILED', `ffmpeg thumbnail failed: ${err.slice(-300)}`)),
    );
  });
}

export interface ThumbnailDeps {
  text: TextService;
  providers: ProviderRegistry;
  db?: Db;
}

/** Executor bước `thumbnail` (engine). */
export function thumbnailExecutor(d: ThumbnailDeps) {
  return async (ctx: StepRunContext): Promise<{ outputs: string[]; summary: string }> => {
    const v = `videos/${ctx.videoId}`;
    if (isVertical(ctx.channelDir, ctx.videoId, ctx.appDataDir))
      return { outputs: [], summary: 'Bỏ qua: video dọc (Shorts) dùng khung hình của video.' };
    const read = (rel: string) =>
      existsSync(ctx.store.abs(`${v}/${rel}`))
        ? readFileSync(ctx.store.abs(`${v}/${rel}`), 'utf8')
        : '';
    const title = /^title:\s*"?(.*?)"?\s*$/m.exec(read('publish.md'))?.[1] ?? '';
    const brief = read('BRIEF.md').slice(0, 1500);
    const frameMd = read('frame.md');
    const cfg = (k: string) =>
      resolveConfig(
        k,
        { channelDir: ctx.channelDir, videoId: ctx.videoId },
        { appDataDir: ctx.appDataDir },
      ).value;
    const lang = String(
      (
        JSON.parse(readFileSync(path.join(ctx.channelDir, 'channel.json'), 'utf8')) as {
          language?: string;
        }
      ).language ?? 'vi',
    );
    const notes: string[] = [];
    // 1. câu móc + mô tả ảnh nền (LLM phụ); lỗi → rút gọn tiêu đề
    let idea: { headline: string; image_prompt: string } | undefined;
    try {
      const out = await d.text.generate(
        'aux',
        {
          role: 'aux',
          max_tokens: 400,
          response_format: 'json',
          messages: [
            {
              role: 'system',
              content:
                'You design YouTube thumbnails. Reply with JSON only: {"headline": "<2–5 word hook in the video language, curiosity or contrast, no punctuation>", "image_prompt": "<English prompt for one striking background image: the main subject, close-up, high contrast, dramatic light, no text, no letters, no logos>"}.',
            },
            {
              role: 'user',
              content: `Language: ${lang}\nTitle: ${title}\nBrief:\n${brief}`,
            },
          ],
        },
        { store: ctx.store, videoId: ctx.videoId },
      );
      idea = parseThumbnailIdea(out.text);
    } catch (e) {
      notes.push(`không gọi được LLM (${(e as Error).message.slice(0, 80)}), dùng tiêu đề`);
    }
    const headline = idea?.headline || fallbackHeadline(title || ctx.videoId);
    // 2. ảnh nền: sinh theo look kênh; hỏng → ảnh lớn nhất của video
    let bg: string | undefined;
    if (idea?.image_prompt) {
      try {
        const look = cfg('look.id');
        const r = await generateImage(
          { providers: d.providers, ...(d.db ? { db: d.db } : {}) },
          ctx.store,
          {
            prompt: idea.image_prompt,
            width: THUMB_W,
            height: THUMB_H,
            ...(typeof look === 'string' ? { look } : {}),
            tags: ['thumbnail'],
          },
          { videoId: ctx.videoId, ...(ctx.appDataDir ? { appDataDir: ctx.appDataDir } : {}) },
        );
        bg = ctx.store.abs(r.file);
      } catch (e) {
        notes.push(
          `không sinh được ảnh nền (${(e as Error).message.slice(0, 80)}), dùng ảnh có sẵn`,
        );
      }
    }
    if (!bg) {
      // ảnh lớn nhất video đang dùng (ảnh sinh/nạp trong public/, không phải miệng/vendor) — sạch hơn ảnh
      // chụp frame (có phụ đề, overlay); không có → nền màu kênh
      const dir = ctx.store.abs(`${v}/public`);
      const best = existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name))
            .map((e) => ({ f: path.join(dir, e.name), n: statSync(path.join(dir, e.name)).size }))
            .sort((a, b) => b.n - a.n)[0]
        : undefined;
      if (best) {
        bg = best.f;
        notes.push('nền là ảnh lớn nhất của video');
      } else notes.push('nền màu kênh');
    }
    // 3. ghép chữ lên nền (HyperFrames chụp một khung) → JPEG 1280×720
    const s = createScratchDir('sf-thumb-');
    try {
      writeOutsideProject(path.join(s.dir, GSAP_LOCAL), gsapSource());
      let bgRel = '';
      if (bg && existsSync(bg)) {
        bgRel = `public/bg${path.extname(bg) || '.png'}`;
        writeOutsideProject(path.join(s.dir, bgRel), readFileSync(bg));
      }
      const font = String(cfg('font.family') ?? 'Be Vietnam Pro');
      writeOutsideProject(
        path.join(s.dir, 'index.html'),
        thumbnailHtml({
          headline,
          bg: bgRel,
          font,
          accent: accentColor(frameMd) ?? '#FFD54A',
          ground: groundColor(frameMd) ?? '#101418',
        }),
      );
      const out = path.join(s.dir, 'out');
      await runHf(['snapshot', '.', '-o', out, '--describe', 'false', '--at', '0.5'], {
        cwd: s.dir,
        timeoutMs: 180_000,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      const png = existsSync(out)
        ? readdirSync(out).find((f) => /\.png$/i.test(f) && !/contact/i.test(f))
        : undefined;
      if (!png) throw new SfError('E_PROVIDER_FAILED', 'hyperframes snapshot produced no image');
      const jpg = path.join(s.dir, THUMB_FILE);
      await ffmpeg(ctx.appDataDir, [
        '-y',
        '-i',
        path.join(out, png),
        '-vf',
        `scale=${THUMB_W}:${THUMB_H}`,
        '-q:v',
        '3',
        jpg,
      ]);
      ctx.store.importFile(jpg, `${v}/${THUMB_FILE}`, { by: 'thumbnail' });
    } finally {
      s.cleanup();
    }
    return {
      outputs: [THUMB_FILE],
      summary: `Thumbnail: "${headline}"${notes.length ? ` (${notes.join('; ')})` : ''}.`,
    };
  };
}
