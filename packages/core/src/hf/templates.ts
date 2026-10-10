import type { FramePacket, OutputProfile } from '../contracts/types.js';

/**
 * Bộ layout (luồng v2; gốc 086/088): HTML frame tất định từ frame packet + `frame.md`, không phiên agent
 * (0 token). Đúng hợp đồng frame worker (`extensions/studioflow-core/hf/frame-worker.md`) ngay khi dựng: một
 * `<template>`, root `data-composition-id`, nền clip riêng, một timeline GSAP dừng, mỗi layer một `data-sf-id`,
 * không hiệu ứng thoát, không animate visibility trên clip, không đặt CSS transform lên phần tử GSAP animate.
 * Chữ luôn trong hộp nội dung (vùng an toàn, tránh dải caption), tự co cho vừa; chữ trên ảnh có lớp tối.
 */

/** Phiên bản layout: tăng khi đổi cách dựng → frame layout đã dựng được dựng lại (088). */
export const TEMPLATE_VERSION = 3;

export interface DesignTokens {
  canvas: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  font: string;
  /** Chữ trên hình viết hoa (design kênh). */
  upper?: boolean;
  /** Độ đậm chữ trên hình. */
  weight?: number;
}

const DEFAULT_TOKENS: DesignTokens = {
  canvas: '#101418',
  surface: '#1b222b',
  ink: '#f4f1ea',
  muted: '#a7b0ba',
  accent: '#e8b04a',
  accent2: '#4fb3a9',
  font: 'system-ui, sans-serif',
};

/** Màu/chữ trong `frame.md` (`- canvas: #hex`, `- accent (nhấn): #hex`, họ font trong backtick). */
export function parseDesignTokens(frameMd: string): DesignTokens {
  const color = (name: string) =>
    new RegExp(`^[-*]\\s*${name}\\b[^:\\n]*:\\s*(#[0-9a-f]{3,8})\\b`, 'im').exec(frameMd)?.[1];
  const font = /Họ font:\s*`([^`]+)`/i.exec(frameMd)?.[1];
  const generic = font && /^[\w\s,-]+$/.test(font) ? font : undefined;
  return {
    canvas: color('canvas') ?? DEFAULT_TOKENS.canvas,
    surface: color('surface') ?? DEFAULT_TOKENS.surface,
    ink: color('ink') ?? DEFAULT_TOKENS.ink,
    muted: color('muted') ?? DEFAULT_TOKENS.muted,
    accent: color('accent') ?? DEFAULT_TOKENS.accent,
    accent2: color('accent-2') ?? DEFAULT_TOKENS.accent2,
    font: generic ?? DEFAULT_TOKENS.font,
    ...(/^[-*]\s*text-case:\s*upper/im.test(frameMd) ? { upper: true } : {}),
    ...(/^[-*]\s*weight:\s*(\d{3})/im.exec(frameMd)
      ? { weight: Number(/^[-*]\s*weight:\s*(\d{3})/im.exec(frameMd)![1]) }
      : {}),
  };
}

/** Bộ layout v1 (luồng v2). */
export const LAYOUTS = [
  'scene',
  'image-title',
  'image-caption',
  'image-split',
  'image-zoom-detail',
  'split-text',
  'stat-pop',
  'big-text',
  'list',
  'quote',
  'chart-bar',
] as const;
export type Layout = (typeof LAYOUTS)[number];
/** Tên cũ (086) vẫn đọc được. */
export const TEMPLATE_KINDS = LAYOUTS;
export type TemplateKind = Layout;
const ALIASES: Record<string, Layout> = {
  'split-reveal': 'split-text',
  'image-focus': 'image-title',
};

/** Mô tả cho bước đạo diễn: layout cần mấy ảnh, chữ đặt thế nào. */
export const LAYOUT_INFO: Record<Layout, { images: 0 | 1 | 2; texts: string; use: string }> = {
  scene: {
    images: 1,
    texts: 'main tùy chọn (≤ 5 từ, đặt trên cao)',
    use: 'cảnh ghép: ảnh nền + nhân vật/đối tượng tách nền (tư thế theo câu, đi vào, cử động) — mặc định khi video có nhân vật/đối tượng',
  },
  'image-title': {
    images: 1,
    texts: 'main (≤ 6 từ), sub tùy chọn',
    use: 'ảnh tràn khung + câu chữ lớn — mặc định cho hầu hết cảnh',
  },
  'image-caption': {
    images: 1,
    texts: 'main ngắn (nhãn ≤ 5 từ)',
    use: 'để ảnh tự kể, chỉ một nhãn nhỏ',
  },
  'image-split': {
    images: 2,
    texts: 'main = nhãn ảnh 1, sub = nhãn ảnh 2',
    use: 'so sánh / nghịch lý giữa hai hình',
  },
  'image-zoom-detail': {
    images: 1,
    texts: 'main = nhãn chi tiết',
    use: 'phóng vào một chi tiết trong ảnh',
  },
  'split-text': {
    images: 0,
    texts: 'main = vế 1, sub = vế 2',
    use: 'hai vế đối lập bằng chữ (ảnh làm nền mờ nếu có)',
  },
  'stat-pop': {
    images: 0,
    texts: 'number = con số, main = nhãn',
    use: 'con số / tỉ lệ nổi bật',
  },
  'big-text': { images: 0, texts: 'main (≤ 6 từ)', use: 'câu chốt, hook chữ' },
  list: { images: 0, texts: 'items: 2–4 ý ngắn', use: 'liệt kê bước / lý do' },
  quote: { images: 0, texts: 'main = trích dẫn, sub = nguồn', use: 'trích dẫn' },
  'chart-bar': {
    images: 0,
    texts: 'items: "Nhãn: số" (2–5 cột), main = tiêu đề tùy chọn',
    use: 'so sánh số liệu',
  },
};

export const MOTIONS = [
  'ken-burns-in',
  'ken-burns-out',
  'pan-left',
  'pan-up',
  'pop',
  'slide-up',
  'pan-right',
  'static',
] as const;
export type Motion = (typeof MOTIONS)[number];

const HAS_NUMBER = /\d/;
const SPLIT = /\s*(?:≠|\bvs\.?\b|↔|\/)\s*/i;
const NEEDS_IMAGE: Partial<Record<Layout, Layout>> = {
  scene: 'big-text',
  'image-title': 'big-text',
  'image-caption': 'big-text',
  'image-zoom-detail': 'big-text',
  'image-split': 'split-text',
};

const asLayout = (s: string | undefined): Layout | undefined => {
  if (!s) return undefined;
  const k = ALIASES[s] ?? s;
  return (LAYOUTS as readonly string[]).includes(k) ? (k as Layout) : undefined;
};

type L = FramePacket['frame']['layers'][number];
const isVisual = (l: L) => l.kind === 'background' || l.kind === 'image' || l.kind === 'object';

function visuals(p: FramePacket): { layer: L; file: string; alpha: boolean }[] {
  return p.frame.layers.flatMap((l) => {
    const a = isVisual(l) ? p.assets.find((x) => x.asset_id === l.asset_id) : undefined;
    return a ? [{ layer: l, file: a.file, alpha: a.alpha }] : [];
  });
}

/**
 * Chọn layout: `frame.layout` → từ đầu `intent` → suy từ layer. Layout cần ảnh mà ảnh chưa có (sinh lỗi,
 * GPU tắt) → layout chữ tương ứng.
 */
export function pickTemplate(p: FramePacket): Layout {
  const f = p.frame as FramePacket['frame'] & { layout?: string };
  const named =
    asLayout(f.layout) ?? asLayout(/^\s*([a-z][a-z-]+)/.exec(f.intent ?? '')?.[1] ?? undefined);
  const imgs = visuals(p).length;
  const texts = p.frame.layers.filter((l) => l.kind === 'text' && l.text);
  let k: Layout;
  if (named) k = named;
  else if (imgs >= 2) k = 'image-split';
  else if (imgs === 1) k = texts.length ? 'image-title' : 'image-caption';
  else if (texts.length >= 3) k = 'list';
  else if (texts.length === 2 || (texts.length === 1 && SPLIT.test(texts[0]!.text!)))
    k = 'split-text';
  else if (texts.length === 1 && HAS_NUMBER.test(texts[0]!.text!) && texts[0]!.text!.length <= 16)
    k = 'stat-pop';
  else k = 'big-text';
  if (k === 'image-split' && imgs === 1) return 'image-title';
  return LAYOUT_INFO[k].images > imgs ? (NEEDS_IMAGE[k] ?? k) : k;
}

/** Độ sáng tương đối (WCAG 2.x) của màu `#rgb`/`#rrggbb`. */
function luminance(hex: string): number {
  let h = hex.replace('#', '').slice(0, 6);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
}

/** Màu chữ đọc được trên nền: giữ `color` nếu đủ tương phản, không thì `ink`, không thì đen/trắng. */
export function readable(color: string, bg: string, ink: string, min = 4.5): string {
  if (contrast(color, bg) >= min) return color;
  if (contrast(ink, bg) >= min) return ink;
  return contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000';
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 1000) / 1000;
/** `#rrggbb` + alpha (00–ff). */
const alpha = (hex: string, a: string) => {
  let h = hex.replace('#', '').slice(0, 6);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return `#${h}${a}`;
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bề rộng ước lượng của một ký tự theo em (đậm 800): hoa/số rộng hơn thường; khoảng trắng hẹp. */
function charEm(c: string): number {
  if (c === ' ') return 0.3;
  if (/[\p{Lu}\p{N}%]/u.test(c)) return 0.74;
  if (/[iljtfrI.,:;!'’|]/.test(c)) return 0.36;
  return 0.6;
}

/** Số dòng khi xuống dòng theo từ (tham lam); `Infinity` nếu một từ dài hơn dòng. */
export function wrapLines(text: string, size: number, width: number): number {
  const wordW = (w: string) => [...w].reduce((a, c) => a + charEm(c), 0) * size;
  const space = 0.3 * size;
  let lines = 1;
  let cur = 0;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const ww = wordW(w);
    if (ww > width) return Infinity;
    if (cur === 0) cur = ww;
    else if (cur + space + ww <= width) cur += space + ww;
    else {
      lines++;
      cur = ww;
    }
  }
  return lines;
}

/**
 * Cỡ chữ vừa hộp (088): mô phỏng xuống dòng theo từ; mỗi dòng tính 1,35 em (chữ Việt có dấu chồng cao
 * hơn dòng 1,15); chừa 12% bề rộng và 15% bề cao cho hiệu ứng phóng to và sai số font.
 */
export function fitFontSize(text: string, box: { w: number; h: number }, max: number): number {
  for (let size = max; size > 28; size -= 4) {
    const lines = wrapLines(text, size, box.w * 0.88);
    if (lines * size * 1.35 <= box.h * 0.85) return size;
  }
  return 28;
}

/** Vùng đặt chữ: trong vùng an toàn, tránh dải caption (dưới 17%, hoặc dải giữa với karaoke dọc). */
export function contentBox(profile: OutputProfile, karaoke: boolean): Box {
  const { width: W, height: H, safe_area: s } = profile;
  const x = Math.round(W * s.left);
  const w = Math.round(W * (1 - s.left - s.right));
  // 088: lùi 24 px vào trong vùng an toàn (gate `text_safe_area` đo hộp chữ thật, dung sai 2 px)
  const top = Math.round(H * s.top) + 24;
  const bottom = karaoke ? Math.round(H * 0.5) - 24 : Math.round(H * 0.83) - 24;
  return { x, y: top, w, h: bottom - top };
}

/** Chuyển động ảnh (GSAP trên `<img>`, không trên clip). */
function imageMotion(sel: string, motion: string | undefined, dur: number, order: number): string {
  const m = (MOTIONS as readonly string[]).includes(motion ?? '')
    ? (motion as Motion)
    : (['ken-burns-in', 'pan-left', 'ken-burns-out', 'pan-up'] as const)[order % 4]!;
  const d = r1(dur);
  switch (m) {
    case 'ken-burns-out':
      return `tl.fromTo("${sel}", { scale: 1.12 }, { scale: 1, duration: ${d}, ease: "none" }, 0);`;
    case 'pan-left':
      return `tl.fromTo("${sel}", { scale: 1.15, xPercent: 3 }, { scale: 1.15, xPercent: -3, duration: ${d}, ease: "none" }, 0);`;
    case 'pan-up':
      return `tl.fromTo("${sel}", { scale: 1.15, yPercent: 3 }, { scale: 1.15, yPercent: -3, duration: ${d}, ease: "none" }, 0);`;
    case 'pan-right':
      return `tl.fromTo("${sel}", { scale: 1.15, xPercent: -3 }, { scale: 1.15, xPercent: 3, duration: ${d}, ease: "none" }, 0);`;
    case 'static':
      return `tl.fromTo("${sel}", { scale: 1.02 }, { scale: 1.03, duration: ${d}, ease: "none" }, 0);`;
    default:
      return `tl.fromTo("${sel}", { scale: 1 }, { scale: 1.12, duration: ${d}, ease: "none" }, 0);`;
  }
}

/** Chữ nhấn: `notes: "accent: <từ>"` trên layer chữ → tô màu nhấn từ đó. */
function withAccent(text: string, notes: string | undefined, color: string): string {
  const w = /accent:\s*(.+)$/i.exec(notes ?? '')?.[1]?.trim();
  const safe = esc(text);
  if (!w) return safe;
  const i = text.toLowerCase().indexOf(w.toLowerCase());
  if (i < 0) return safe;
  return `${esc(text.slice(0, i))}<span style="color:${color}">${esc(text.slice(i, i + w.length))}</span>${esc(text.slice(i + w.length))}`;
}

export function templateFrame(
  p0: FramePacket,
  profile: OutputProfile,
  tokens: DesignTokens,
  opts: { karaoke: boolean },
): string {
  // design kênh viết hoa: đổi chữ trước khi đo (co chữ theo bề rộng thật của chữ hoa)
  const p: FramePacket = tokens.upper
    ? {
        ...p0,
        frame: {
          ...p0.frame,
          layers: p0.frame.layers.map((l) =>
            l.kind === 'text' && l.text ? { ...l, text: l.text.toLocaleUpperCase() } : l,
          ),
        },
      }
    : p0;
  const id = p.frame.id;
  const P = `${id}-`;
  const dur = r1(p.timing.duration_ms / 1000);
  const { width: W, height: H } = profile;
  const vertical = H > W;
  const kind = pickTemplate(p);
  const motion = (p.frame as { motion?: string }).motion;
  const box = contentBox(profile, opts.karaoke);
  const css: string[] = [
    `#root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; font-family: ${tokens.font}; }`,
    `.${P}bg { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; background: ${tokens.canvas}; overflow: hidden; }`,
    `.${P}fill { width: 100%; height: 100%; object-fit: cover; display: block; }`,
    `.${P}t > span { display: inline-block; }`,
    `.${P}t { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: ${tokens.ink}; font-weight: ${tokens.weight ?? 800}; letter-spacing: -0.02em; line-height: 1.15; overflow-wrap: anywhere; overflow: hidden; }`,
  ];
  const els: string[] = [];
  const anim: string[] = [];
  let track = 0;
  const clip = (cls: string, inner: string, sfId?: string) =>
    `<div class="clip ${cls}"${sfId ? ` data-sf-id="${sfId}"` : ''} data-start="0" data-duration="${dur}" data-track-index="${track++}">${inner}</div>`;

  const vis = visuals(p);
  const texts = p.frame.layers.filter((l) => l.kind === 'text');
  const bgLayer =
    p.frame.layers.find((l) => l.kind === 'background') ?? (vis.length ? vis[0]!.layer : undefined);
  const placed = new Set<string>();
  const imageLayout = kind.startsWith('image-');
  // nền: ảnh tràn khung (layout ảnh: rõ; layout chữ: mờ sau lớp tối) hoặc màu canvas
  // ảnh tràn khung: ảnh của layer nền, không thì ảnh đầu tiên không trong suốt (ảnh tách nền → khung phụ)
  const hero = vis.find((v) => v.layer.id === bgLayer?.id && !v.alpha) ?? vis.find((v) => !v.alpha);
  if (kind === 'scene') {
    sceneLayout({ p, P, W, H, dur, motion, vis, bgLayer, els, css, anim, placed, clip });
  } else if (kind === 'image-split' && vis.length >= 2) {
    // hai cột ảnh cạnh nhau (cả khung dọc lẫn ngang)
    const colW = Math.floor((W - 12) / 2);
    const bgId = p.frame.layers.find(
      (l) => l.kind === 'background' && !vis.slice(0, 2).some((v) => v.layer.id === l.id),
    )?.id;
    els.push(clip(`${P}bg`, '', bgId));
    if (bgId) placed.add(bgId);
    vis.slice(0, 2).forEach((v, i) => {
      const cls = `${P}${v.layer.id}`;
      css.push(
        `.${cls} { position: absolute; left: ${i ? colW + 12 : 0}px; top: 0; width: ${colW}px; height: ${H}px; overflow: hidden; }`,
      );
      els.push(
        clip(cls, `<img class="${P}fill ${cls}-img" src="${esc(v.file)}" alt="">`, v.layer.id),
      );
      anim.push(imageMotion(`.${cls}-img`, i ? 'ken-burns-out' : 'ken-burns-in', dur, i));
      placed.add(v.layer.id);
    });
  } else {
    const bgId = bgLayer?.kind === 'background' ? bgLayer.id : hero?.layer.id;
    els.push(
      clip(
        `${P}bg`,
        hero
          ? `<img class="${P}fill ${P}bgimg"${hero.layer.id !== bgId ? ` data-sf-id="${hero.layer.id}"` : ''} src="${esc(hero.file)}" alt="">`
          : '',
        bgId,
      ),
    );
    if (bgId) placed.add(bgId);
    if (hero) {
      placed.add(hero.layer.id);
      anim.push(
        kind === 'image-zoom-detail'
          ? `tl.fromTo(".${P}bgimg", { scale: 1 }, { scale: 1.45, duration: ${dur}, ease: "power1.inOut" }, 0);`
          : imageMotion(`.${P}bgimg`, motion, dur, p.frame.order ?? 0),
      );
      css.push(`.${P}bgimg { transform-origin: 50% 40%; }`);
    }
  }
  // lớp tối giữ tương phản cho chữ (WCAG AA — hyperframes check đo trên điểm ảnh thật)
  const c = tokens.canvas;
  const scrim =
    kind === 'scene'
      ? texts.some((l) => l.text)
        ? `linear-gradient(180deg, ${alpha(c, 'd9')} 0%, ${alpha(c, '80')} ${Math.round(((box.y + box.h * 0.3) / H) * 100)}%, ${alpha(c, '00')} ${Math.round(((box.y + box.h * 0.45) / H) * 100)}%)`
        : `linear-gradient(180deg, ${alpha(c, '00')}, ${alpha(c, '00')})`
      : !vis.length
        ? `radial-gradient(ellipse at 50% 35%, ${alpha(tokens.accent, '22')}, ${alpha(c, '00')} 65%)`
        : imageLayout && kind !== 'image-split'
          ? vertical
            ? `linear-gradient(180deg, ${alpha(c, 'f2')} 0%, ${alpha(c, 'd9')} ${Math.round(((box.y + box.h * 0.5) / H) * 100)}%, ${alpha(c, '00')} ${Math.round(((box.y + box.h) / H) * 100) + 8}%)`
            : `linear-gradient(180deg, ${alpha(c, 'e6')} 0%, ${alpha(c, 'b3')} 55%, ${alpha(c, '33')} 100%)`
          : kind === 'image-split'
            ? `linear-gradient(180deg, ${alpha(c, 'f2')} 0%, ${alpha(c, 'cc')} ${Math.round(((box.y + box.h * 0.4) / H) * 100)}%, ${alpha(c, '00')} ${Math.round(((box.y + box.h * 0.7) / H) * 100)}%)`
            : `linear-gradient(180deg, ${alpha(c, 'e6')}, ${alpha(c, 'cc')})`;
  css.push(
    `.${P}scrim { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; background: ${scrim}; }`,
  );
  els.push(clip(`${P}scrim`, `<div class="${P}scrim-in" style="width:100%;height:100%"></div>`));
  anim.push(
    `tl.fromTo(".${P}scrim-in", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" }, 0);`,
  );

  const bgColor = c; // chữ luôn đặt trên lớp tối màu canvas
  const col = (x: string) => readable(x, bgColor, tokens.ink);
  const at = (i: number, n: number) =>
    r1(Math.min(0.15 + i * Math.min(0.6, (dur * 0.5) / Math.max(1, n)), dur * 0.7));
  const from = (kind2: 'up' | 'pop' | 'left' | 'right') =>
    kind2 === 'pop'
      ? '{ opacity: 0, scale: 0.55 }'
      : kind2 === 'left'
        ? '{ opacity: 0, x: -70 }'
        : kind2 === 'right'
          ? '{ opacity: 0, x: 70 }'
          : '{ opacity: 0, y: 48 }';
  const textEl = (
    l: L,
    b: Box,
    size: number,
    color: string,
    i: number,
    n: number,
    entry: 'up' | 'pop' | 'left' | 'right',
    extra = '',
    body?: string,
  ) => {
    const cls = `${P}${l.id}`;
    css.push(
      `.${cls} { left: ${b.x}px; top: ${b.y}px; width: ${b.w}px; height: ${b.h}px; font-size: ${size}px; color: ${col(color)};${extra} }`,
    );
    els.push(
      clip(
        `${P}t ${cls}`,
        `<span class="${cls}-in">${body ?? withAccent(l.text ?? '', l.notes, col(tokens.accent))}</span>`,
        l.id,
      ),
    );
    anim.push(
      `tl.fromTo(".${cls}-in", ${from(entry)}, { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.55, ease: "${entry === 'pop' ? 'back.out(1.8)' : 'power3.out'}" }, ${at(i, n)});`,
    );
    placed.add(l.id);
  };
  const maxSize = Math.round(Math.min(W, H) * 0.14);
  const subSize = Math.round(Math.min(W, H) * 0.06);
  const entryOf = (fallback: 'up' | 'pop') =>
    motion === 'pop' ? 'pop' : motion === 'slide-up' ? 'up' : fallback;
  const stack = (b: Box, ls: L[], first: string, rest: string, entry: 'up' | 'pop') => {
    // main lớn + các dòng phụ nhỏ hơn bên dưới
    if (!ls.length) return;
    const mainH = ls.length > 1 ? Math.round(b.h * 0.66) : b.h;
    textEl(
      ls[0]!,
      { ...b, h: mainH - 8 },
      fitFontSize(ls[0]!.text ?? '', { w: b.w, h: mainH - 8 }, maxSize),
      first,
      0,
      ls.length,
      entry,
    );
    const restH = Math.floor((b.h - mainH) / Math.max(1, ls.length - 1));
    ls.slice(1).forEach((l, i) => {
      const bb = { ...b, y: b.y + mainH + i * restH, h: restH - 8 };
      textEl(l, bb, fitFontSize(l.text ?? '', bb, subSize), rest, i + 1, ls.length, 'up');
    });
  };

  if (kind === 'scene') {
    // chữ (nếu có) trên cao, nhường khung cho nhân vật
    stack({ ...box, h: Math.round(box.h * 0.3) }, texts, tokens.ink, tokens.muted, entryOf('up'));
  } else if (kind === 'image-title') {
    stack({ ...box, h: Math.round(box.h * 0.55) }, texts, tokens.ink, tokens.muted, entryOf('up'));
  } else if (kind === 'image-caption' || kind === 'image-zoom-detail') {
    texts.slice(0, 1).forEach((l) => {
      const b = { ...box, h: Math.round(box.h * 0.22) };
      textEl(
        l,
        b,
        fitFontSize(l.text ?? '', b, Math.round(maxSize * 0.62)),
        tokens.ink,
        0,
        1,
        entryOf('up'),
      );
    });
  } else if (kind === 'image-split') {
    const colW = Math.floor((box.w - 24) / 2);
    texts.slice(0, 2).forEach((l, i) => {
      const b = { x: box.x + i * (colW + 24), y: box.y, w: colW, h: Math.round(box.h * 0.4) };
      textEl(
        l,
        b,
        fitFontSize(l.text ?? '', b, Math.round(maxSize * 0.7)),
        i ? tokens.accent : tokens.ink,
        i,
        2,
        i ? 'right' : 'left',
      );
    });
  } else if (kind === 'split-text' && texts.length) {
    const parts =
      texts.length >= 2
        ? texts.slice(0, 2).map((l) => ({ l, text: l.text ?? '' }))
        : (texts[0]!.text ?? '')
            .split(SPLIT)
            .slice(0, 2)
            .map((t) => ({ l: texts[0]!, text: t }));
    const halves: Box[] = vertical
      ? [
          { ...box, h: Math.round(box.h / 2) - 12 },
          { ...box, y: box.y + Math.round(box.h / 2) + 12, h: Math.round(box.h / 2) - 12 },
        ]
      : [
          { ...box, w: Math.round(box.w / 2) - 16 },
          { ...box, x: box.x + Math.round(box.w / 2) + 16, w: Math.round(box.w / 2) - 16 },
        ];
    if (texts.length >= 2) {
      parts.forEach((x, i) =>
        textEl(
          { ...x.l, text: x.text },
          halves[i]!,
          fitFontSize(x.text, halves[i]!, maxSize),
          i ? tokens.accent : tokens.ink,
          i,
          2,
          vertical ? 'up' : i ? 'right' : 'left',
        ),
      );
    } else {
      // một layer "A ≠ B": layer giữ cả câu, hai vế là span con
      const l = texts[0]!;
      const cls = `${P}${l.id}`;
      const size = Math.min(...parts.map((x, i) => fitFontSize(x.text, halves[i]!, maxSize)));
      css.push(
        `.${cls} { left: ${box.x}px; top: ${box.y}px; width: ${box.w}px; height: ${box.h}px; font-size: ${size}px; flex-direction: ${vertical ? 'column' : 'row'}; gap: 0.4em; }`,
        `.${cls}-b { color: ${col(tokens.accent)}; }`,
      );
      els.push(
        clip(
          `${P}t ${cls}`,
          `<span class="${cls}-a">${esc(parts[0]?.text ?? '')}</span><span class="${cls}-sep" style="color:${col(tokens.muted)}">≠</span><span class="${cls}-b">${esc(parts[1]?.text ?? '')}</span>`,
          l.id,
        ),
      );
      anim.push(
        `tl.fromTo(".${cls}-a", { opacity: 0, ${vertical ? 'y: -60' : 'x: -80'} }, { opacity: 1, x: 0, y: 0, duration: 0.55, ease: "power3.out" }, 0.15);`,
        `tl.fromTo(".${cls}-sep", { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(2)" }, 0.45);`,
        `tl.fromTo(".${cls}-b", { opacity: 0, ${vertical ? 'y: 60' : 'x: 80'} }, { opacity: 1, x: 0, y: 0, duration: 0.55, ease: "power3.out" }, 0.6);`,
      );
      placed.add(l.id);
    }
  } else if (kind === 'list' && texts.length) {
    const rowH = Math.floor(box.h / texts.length);
    texts.forEach((l, i) => {
      const b = { ...box, y: box.y + i * rowH, h: rowH - 12 };
      textEl(
        l,
        b,
        fitFontSize(l.text ?? '', b, Math.round(maxSize * 0.6)),
        i === 0 ? tokens.accent : tokens.ink,
        i,
        texts.length,
        'left',
      );
    });
  } else if (kind === 'quote' && texts.length) {
    const markH = Math.round(box.h * 0.2);
    const cls = `${P}mark`;
    css.push(
      `.${cls} { position: absolute; left: ${box.x}px; top: ${box.y}px; width: ${box.w}px; height: ${markH}px; font-size: ${Math.round(markH * 1.1)}px; line-height: 1; color: ${col(tokens.accent)}; font-family: Georgia, serif; text-align: center; }`,
    );
    els.push(clip(cls, `<span class="${cls}-in" style="display:inline-block">“</span>`));
    anim.push(
      `tl.fromTo(".${cls}-in", { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2)" }, 0.05);`,
    );
    stack({ ...box, y: box.y + markH, h: box.h - markH }, texts, tokens.ink, tokens.muted, 'up');
  } else if (kind === 'chart-bar' && texts.length) {
    const rows = texts
      .map((l) => ({ l, m: /^(.*?)[:\s]\s*(-?\d+(?:[.,]\d+)?)\s*(%?)\s*$/.exec(l.text ?? '') }))
      .filter((x) => x.m);
    const title = texts.find((l) => !rows.some((r) => r.l.id === l.id));
    let top = box.y;
    if (title) {
      const b = { ...box, h: Math.round(box.h * 0.2) };
      textEl(
        title,
        b,
        fitFontSize(title.text ?? '', b, Math.round(maxSize * 0.5)),
        tokens.ink,
        0,
        1,
        'up',
      );
      top += b.h + 12;
    }
    const max = Math.max(1, ...rows.map((r) => Math.abs(Number(r.m![2]!.replace(',', '.')))));
    const rowH = Math.floor((box.y + box.h - top) / Math.max(1, rows.length));
    const labelSize = Math.max(28, Math.min(Math.round(rowH * 0.3), subSize));
    rows.forEach(({ l, m }, i) => {
      const cls = `${P}${l.id}`;
      const v = Math.abs(Number(m![2]!.replace(',', '.')));
      const y = top + i * rowH;
      const barH = Math.max(14, Math.round(rowH * 0.32));
      const barW = Math.max(8, Math.round((box.w * 0.82 * v) / max));
      css.push(
        `.${cls} { position: absolute; left: ${box.x}px; top: ${y}px; width: ${box.w}px; height: ${rowH - 8}px; color: ${col(tokens.ink)}; font-weight: 700; font-size: ${labelSize}px; }`,
        `.${cls}-bar { position: absolute; left: 0; top: ${Math.round(labelSize * 1.35)}px; width: ${barW}px; height: ${barH}px; border-radius: ${Math.round(barH / 2)}px; background: ${i % 2 ? tokens.accent2 : tokens.accent}; transform-origin: 0 50%; }`,
        `.${cls}-lab { position: absolute; left: 0; top: 0; width: ${box.w}px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
      );
      els.push(
        clip(
          cls,
          `<div class="${cls}-lab">${esc(m![1]!.trim())} — ${esc(m![2]!)}${esc(m![3] ?? '')}</div><div class="${cls}-bar"></div>`,
          l.id,
        ),
      );
      anim.push(
        `tl.fromTo(".${cls}-bar", { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: "power3.out" }, ${r1(0.3 + i * 0.25)});`,
        `tl.fromTo(".${cls}-lab", { opacity: 0 }, { opacity: 1, duration: 0.4 }, ${r1(0.2 + i * 0.25)});`,
      );
      placed.add(l.id);
    });
  } else if (kind === 'stat-pop' && texts.length) {
    const num = texts.find((l) => HAS_NUMBER.test(l.text ?? '')) ?? texts[0]!;
    const rest = texts.filter((l) => l.id !== num.id);
    const numH = rest.length ? Math.round(box.h * 0.62) : box.h;
    const b = { ...box, h: numH - 8 };
    textEl(
      num,
      b,
      fitFontSize(num.text ?? '', b, Math.round(maxSize * 1.4)),
      tokens.accent,
      0,
      texts.length,
      'pop',
    );
    anim.push(
      `tl.to(".${P}${num.id}-in", { scale: 1.06, duration: 0.25, ease: "power2.out" }, ${r1(at(0, texts.length) + 0.55)});`,
      `tl.to(".${P}${num.id}-in", { scale: 1, duration: 0.3, ease: "power2.inOut" }, ${r1(at(0, texts.length) + 0.8)});`,
    );
    const rh = Math.floor((box.h - numH) / Math.max(1, rest.length));
    rest.forEach((l, i) => {
      const bb = { ...box, y: box.y + numH + i * rh, h: rh - 8 };
      textEl(l, bb, fitFontSize(l.text ?? '', bb, subSize), tokens.ink, i + 1, texts.length, 'up');
    });
  } else {
    // big-text (và layout chữ không đủ dữ liệu)
    stack(box, texts, tokens.ink, tokens.muted, entryOf('up'));
  }

  // ảnh phụ chưa đặt (vd. ảnh thứ hai ở layout một ảnh): khung ảnh nhỏ dưới hộp chữ
  vis
    .filter((v) => !placed.has(v.layer.id))
    .slice(0, 1)
    .forEach((v) => {
      const cls = `${P}${v.layer.id}`;
      const h = Math.round(box.h * 0.35);
      css.push(
        `.${cls} { position: absolute; left: ${box.x + Math.round(box.w * 0.15)}px; top: ${box.y + box.h - h}px; width: ${Math.round(box.w * 0.7)}px; height: ${h}px; overflow: hidden; border-radius: 16px; }`,
      );
      els.push(
        clip(
          cls,
          `<img class="${cls}-img" src="${esc(v.file)}" alt="" style="width:100%;height:100%;object-fit:${v.alpha ? 'contain' : 'cover'}">`,
          v.layer.id,
        ),
      );
      anim.push(
        `tl.fromTo(".${cls}-img", { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 0.8, ease: "power2.out" }, 0.3);`,
      );
      placed.add(v.layer.id);
    });

  // layer còn lại (shape, chart, overlay, ảnh chưa có, chữ dư, mouth): phần tử đặt chỗ tối giản
  p.frame.layers
    .filter((l) => !placed.has(l.id))
    .forEach((l, i) => {
      const cls = `${P}${l.id}`;
      if (l.kind === 'mouth') {
        // điểm miệng của nhân vật (tỉ lệ trên ảnh tràn khung, `notes: "anchor: x,y"`); không có → giữa khung
        const a = /anchor:\s*([\d.]+)\s*,\s*([\d.]+)/.exec(l.notes ?? '');
        // cảnh ghép: miệng trên đầu nhân vật đầu tiên (ước lượng theo hộp ảnh tách nền)
        const head = kind === 'scene' ? actorHead(p, W, H) : undefined;
        const mx = head ? head.x : a ? Number(a[1]) * W : W / 2;
        const my = head ? head.y : a ? Number(a[2]) * H : H * 0.45 + W * 0.018;
        css.push(
          `.${cls} { position: absolute; left: ${Math.round(mx - W * 0.03)}px; top: ${Math.round(my - W * 0.018)}px; width: ${Math.round(W * 0.06)}px; height: ${Math.round(W * 0.036)}px; }`,
        );
        els.push(clip(cls, '', l.id));
        return;
      }
      // dải nhấn màu accent ở đáy hộp nội dung (người dùng thay/vẽ lại trong Studio)
      const y = box.y + box.h - 16 - i * 20;
      css.push(
        `.${cls} { position: absolute; left: ${box.x + Math.round(box.w * 0.3)}px; top: ${y}px; width: ${Math.round(box.w * 0.4)}px; height: 10px; }`,
      );
      els.push(
        clip(
          cls,
          `<div class="${cls}-bar" style="width:100%;height:100%;border-radius:5px;background:${i % 2 ? tokens.accent2 : tokens.accent};transform-origin:50% 50%"></div>`,
          l.id,
        ),
      );
      anim.push(
        `tl.fromTo(".${cls}-bar", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power3.out" }, ${r1(0.5 + i * 0.15)});`,
      );
    });

  return [
    '<template>',
    '<style>',
    ...css.map((x) => `  ${x}`),
    '</style>',
    `<div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}" data-start="0" data-duration="${dur}">`,
    ...els.map((e) => `  ${e}`),
    '  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>',
    '  <script>',
    '    window.__timelines = window.__timelines || {};',
    '    const tl = gsap.timeline({ paused: true });',
    ...anim.map((a) => `    ${a}`),
    // giữ khung cuối tới hết thời lượng
    `    tl.set({}, {}, ${dur});`,
    `    window.__timelines["${id}"] = tl;`,
    '  </script>',
    '</div>',
    '</template>',
    '',
  ].join('\n');
}

/** Một nhân vật/đối tượng trong cảnh ghép (`notes: "actor: cast=c1; x=0.3; size=0.8; facing=left; enter=left; action=walk"`). */
export interface ActorSpec {
  cast?: string;
  /** Tâm ngang (0–1 bề rộng khung). */
  x: number;
  /** Chiều cao (0–1 bề cao khung). */
  size: number;
  facing: 'left' | 'right' | 'camera';
  enter: 'left' | 'right' | 'bottom' | 'fade' | 'none';
  action: string;
}

export const ACTOR_ACTIONS = [
  'idle',
  'walk',
  'bob',
  'nod',
  'shake',
  'jump',
  'lean',
  'point',
  'turn',
  'float',
] as const;

export function parseActor(notes: string | undefined, i = 0, n = 1): ActorSpec {
  const kv = Object.fromEntries(
    [...(notes ?? '').replace(/^\s*actor:\s*/i, '').matchAll(/([a-z_]+)\s*=\s*([^;]+)/gi)].map(
      (m) => [m[1]!.toLowerCase(), m[2]!.trim()],
    ),
  );
  const num = (v: string | undefined, d: number, lo: number, hi: number) => {
    const x = Number(v);
    return v !== undefined && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  };
  const defX = n === 1 ? 0.5 : 0.25 + (0.5 * i) / Math.max(1, n - 1);
  const pick = <T extends string>(v: string | undefined, all: readonly T[], d: T): T =>
    (all as readonly string[]).includes(v ?? '') ? (v as T) : d;
  return {
    ...(kv.cast ? { cast: kv.cast } : {}),
    x: num(kv.x, defX, 0.05, 0.95),
    size: num(kv.size, n === 1 ? 0.78 : 0.62, 0.2, 1),
    facing: pick(kv.facing, ['left', 'right', 'camera'] as const, 'camera'),
    enter: pick(kv.enter, ['left', 'right', 'bottom', 'fade', 'none'] as const, 'fade'),
    action: pick(kv.action, ACTOR_ACTIONS, 'idle'),
  };
}

const isActor = (l: L) => l.kind === 'object' || /^\s*actor:/i.test(l.notes ?? '');

/** Hộp của một nhân vật: chân chạm đáy khung (lấn dải phụ đề như người thật trong phim), giữ tỉ lệ ảnh. */
function actorBox(
  a: ActorSpec,
  asset: { width: number; height: number } | undefined,
  W: number,
  H: number,
): Box {
  const h = Math.round(H * a.size);
  const ratio = asset && asset.height ? asset.width / asset.height : 0.75;
  const w = Math.round(h * ratio);
  return { x: Math.round(a.x * W - w / 2), y: H - h + Math.round(H * 0.02), w, h };
}

/** Điểm miệng ước lượng của nhân vật đầu tiên (đầu ≈ 14% chiều cao từ đỉnh). */
function actorHead(p: FramePacket, W: number, H: number): { x: number; y: number } | undefined {
  const actors = p.frame.layers.filter(isActor);
  const l = actors[0];
  if (!l) return undefined;
  const asset = p.assets.find((x) => x.asset_id === l.asset_id);
  const b = actorBox(parseActor(l.notes, 0, actors.length), asset, W, H);
  return { x: b.x + b.w / 2, y: b.y + b.h * 0.14 };
}

/** Cử động lặp của nhân vật trong suốt cảnh (GSAP; số lần lặp hữu hạn để seek được). */
function actorAction(
  sel: string,
  action: string,
  dur: number,
  start: number,
  W: number,
  dir: 1 | -1,
): string[] {
  const left = Math.max(0.1, dur - start);
  const rep = (period: number) => Math.max(1, Math.floor(left / period) - 1);
  const t = r1(start);
  switch (action) {
    case 'walk':
      return [
        // bước theo hướng nhìn (lớp -walk riêng, không đụng lớp đi vào / parallax)
        `tl.fromTo("${sel}-walk", { x: ${-dir * Math.round(W * 0.05)} }, { x: ${dir * Math.round(W * 0.05)}, duration: ${r1(left)}, ease: "none" }, ${t});`,
        `tl.to("${sel}-in", { y: -10, duration: 0.28, ease: "sine.inOut", yoyo: true, repeat: ${rep(0.28)} }, ${t});`,
      ];
    case 'bob':
      return [
        `tl.to("${sel}-in", { y: -14, duration: 0.6, ease: "sine.inOut", yoyo: true, repeat: ${rep(0.6)} }, ${t});`,
      ];
    case 'float':
      return [
        `tl.to("${sel}-in", { y: -26, rotation: 2, duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: ${rep(1.4)} }, ${t});`,
      ];
    case 'nod':
      return [
        `tl.to("${sel}-in", { rotation: 3, duration: 0.35, ease: "sine.inOut", yoyo: true, repeat: ${Math.min(5, rep(0.35))} }, ${t});`,
      ];
    case 'shake':
      return [
        `tl.to("${sel}-in", { rotation: -3, duration: 0.12, ease: "sine.inOut", yoyo: true, repeat: ${Math.min(9, rep(0.12))} }, ${t});`,
      ];
    case 'jump':
      return [
        `tl.to("${sel}-in", { y: -70, duration: 0.32, ease: "power2.out" }, ${t});`,
        `tl.to("${sel}-in", { y: 0, duration: 0.4, ease: "bounce.out" }, ${r1(start + 0.32)});`,
      ];
    case 'lean':
      return [
        `tl.to("${sel}-in", { rotation: 4, duration: ${r1(Math.min(1.2, left))}, ease: "power2.out" }, ${t});`,
      ];
    case 'point':
      return [
        `tl.to("${sel}-in", { scale: 1.05, duration: 0.3, ease: "back.out(2)" }, ${t});`,
        `tl.to("${sel}-in", { scale: 1, duration: 0.5, ease: "power2.inOut" }, ${r1(start + 0.3)});`,
      ];
    case 'turn':
      return [
        `tl.to("${sel}-flip", { scaleX: -1, duration: 0.3, ease: "power2.inOut" }, ${r1(start + left * 0.5)});`,
      ];
    default:
      // thở nhẹ: không có cảm giác ảnh dán tĩnh
      return [
        `tl.to("${sel}-in", { scaleY: 1.012, duration: 1.6, ease: "sine.inOut", yoyo: true, repeat: ${rep(1.6)} }, ${t});`,
      ];
  }
}

/**
 * Layout `scene` (cảnh ghép 2.5D): ảnh nền tràn khung + chuyển động camera; mỗi nhân vật/đối tượng tách nền đặt
 * theo `actor:` (vị trí, cỡ, hướng), đi vào khung, cử động lặp, bóng dưới chân, lệch nhẹ ngược camera (parallax).
 */
function sceneLayout(o: {
  p: FramePacket;
  P: string;
  W: number;
  H: number;
  dur: number;
  motion: string | undefined;
  vis: { layer: L; file: string; alpha: boolean }[];
  bgLayer: L | undefined;
  els: string[];
  css: string[];
  anim: string[];
  placed: Set<string>;
  clip: (cls: string, inner: string, sfId?: string) => string;
}): void {
  const { p, P, W, H, dur, vis, els, css, anim, placed, clip } = o;
  const actors = vis.filter((v) => isActor(v.layer));
  const bg =
    vis.find((v) => v.layer.kind === 'background' && !isActor(v.layer)) ??
    vis.find((v) => !v.alpha && !isActor(v.layer));
  const bgId = o.bgLayer && !isActor(o.bgLayer) ? o.bgLayer.id : bg?.layer.id;
  els.push(
    clip(
      `${P}bg`,
      bg
        ? `<img class="${P}fill ${P}bgimg"${bg.layer.id !== bgId ? ` data-sf-id="${bg.layer.id}"` : ''} src="${esc(bg.file)}" alt="">`
        : '',
      bgId,
    ),
  );
  if (bgId) placed.add(bgId);
  if (bg) {
    placed.add(bg.layer.id);
    css.push(`.${P}bgimg { transform-origin: 50% 55%; }`);
    anim.push(imageMotion(`.${P}bgimg`, o.motion, dur, p.frame.order ?? 0));
  }
  // parallax: nhân vật trôi ngược chiều camera một chút
  const drift = o.motion === 'pan-left' ? 1 : o.motion === 'pan-right' ? -1 : 0;
  actors.forEach((v, i) => {
    const a = parseActor(v.layer.notes, i, actors.length);
    const asset = p.assets.find((x) => x.asset_id === v.layer.asset_id);
    const b = actorBox(a, asset, W, H);
    const cls = `${P}${v.layer.id}`;
    css.push(
      `.${cls} { position: absolute; left: ${b.x}px; top: ${b.y}px; width: ${b.w}px; height: ${b.h}px; }`,
      `.${cls}-flip { position: absolute; left: 0; top: 0; width: 100%; height: 100%; transform-origin: 50% 100%;${a.facing === 'left' ? ' transform: scaleX(-1);' : ''} }`,
      `.${cls}-in { position: absolute; left: 0; top: 0; width: 100%; height: 100%; transform-origin: 50% 100%; }`,
      `.${cls}-img { width: 100%; height: 100%; object-fit: contain; object-position: 50% 100%; display: block; filter: drop-shadow(0 ${Math.round(H * 0.01)}px ${Math.round(H * 0.02)}px rgba(0,0,0,0.45)); }`,
      `.${cls}-shadow { position: absolute; left: 15%; bottom: ${-Math.round(H * 0.012)}px; width: 70%; height: ${Math.round(H * 0.035)}px; border-radius: 50%; background: radial-gradient(ellipse at center, rgba(0,0,0,0.45), rgba(0,0,0,0) 70%); }`,
    );
    els.push(
      clip(
        cls,
        `<div class="${cls}-move" style="position:absolute;left:0;top:0;width:100%;height:100%"><div class="${cls}-walk" style="position:absolute;left:0;top:0;width:100%;height:100%"><div class="${cls}-shadow"></div><div class="${cls}-flip"><div class="${cls}-in"><img class="${cls}-img" src="${esc(v.file)}" alt=""></div></div></div></div>`,
        v.layer.id,
      ),
    );
    placed.add(v.layer.id);
    const delay = 0.1 + i * 0.25;
    const off = Math.round(W * 0.45);
    const from =
      a.enter === 'left'
        ? `{ x: ${-off}, opacity: 1 }`
        : a.enter === 'right'
          ? `{ x: ${off}, opacity: 1 }`
          : a.enter === 'bottom'
            ? `{ y: ${Math.round(H * 0.5)}, opacity: 1 }`
            : a.enter === 'none'
              ? '{ opacity: 1 }'
              : '{ opacity: 0, y: 24 }';
    const enterDur =
      a.enter === 'none' ? 0.01 : a.enter === 'left' || a.enter === 'right' ? 0.9 : 0.6;
    anim.push(
      `tl.fromTo(".${cls}-move", ${from}, { x: 0, y: 0, opacity: 1, duration: ${enterDur}, ease: "power2.out" }, ${r1(delay)});`,
    );
    if (drift)
      anim.push(
        `tl.to(".${cls}", { x: ${drift * Math.round(W * 0.02)}, duration: ${dur}, ease: "none" }, 0);`,
      );
    anim.push(
      ...actorAction(`.${cls}`, a.action, dur, delay + enterDur, W, a.facing === 'left' ? -1 : 1),
    );
  });
}
