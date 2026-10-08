import type { FramePacket, OutputProfile } from '../contracts/types.js';

/**
 * 086 (FR-FB-86-01): frame dựng từ mẫu — HTML tất định từ frame packet + `frame.md`, không phiên agent
 * (0 token). Tuân hợp đồng frame worker (`extensions/studioflow-core/hf/frame-worker.md`): một
 * `<template>`, root `data-composition-id`, nền clip riêng, một timeline GSAP dừng, mỗi layer một
 * `data-sf-id`, không hiệu ứng thoát, không animate visibility trên clip.
 */

export interface DesignTokens {
  canvas: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  font: string;
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
  };
}

export const TEMPLATE_KINDS = [
  'big-text',
  'stat-pop',
  'split-reveal',
  'image-focus',
  'list',
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

const HAS_NUMBER = /\d/;
const SPLIT = /\s*(?:≠|\bvs\.?\b|↔|\/)\s*/i;

/** Chọn mẫu: từ đầu `intent` nếu là tên mẫu; không thì theo layer (ảnh → image-focus, số → stat-pop…). */
export function pickTemplate(p: FramePacket): TemplateKind {
  const first = /^\s*([a-z][a-z-]+)/.exec(p.frame.intent ?? '')?.[1];
  if (first && (TEMPLATE_KINDS as readonly string[]).includes(first)) return first as TemplateKind;
  const texts = p.frame.layers.filter((l) => l.kind === 'text' && l.text);
  if (
    p.assets.some((a) =>
      p.frame.layers.some((l) => l.asset_id === a.asset_id && l.kind !== 'background'),
    )
  )
    return 'image-focus';
  if (texts.length >= 3) return 'list';
  if (texts.length === 2 || (texts.length === 1 && SPLIT.test(texts[0]!.text!)))
    return 'split-reveal';
  if (texts.length === 1 && HAS_NUMBER.test(texts[0]!.text!) && texts[0]!.text!.length <= 16)
    return 'stat-pop';
  return 'big-text';
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

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Cỡ chữ vừa hộp: ước lượng ký tự ≈ 0,56 em, dòng 1,15 em. */
export function fitFontSize(text: string, box: { w: number; h: number }, max: number): number {
  const n = Math.max(4, [...text].length);
  for (let size = max; size > 28; size -= 4) {
    const perLine = Math.max(1, Math.floor(box.w / (size * 0.56)));
    const lines = Math.ceil(n / perLine);
    if (lines * size * 1.15 <= box.h) return size;
  }
  return 28;
}

/** Vùng đặt chữ: trong vùng an toàn, tránh dải caption (dưới 17%, hoặc dải giữa với karaoke dọc). */
export function contentBox(profile: OutputProfile, karaoke: boolean): Box {
  const { width: W, height: H, safe_area: s } = profile;
  const x = Math.round(W * s.left);
  const w = Math.round(W * (1 - s.left - s.right));
  const top = Math.round(H * s.top);
  const bottom = karaoke ? Math.round(H * 0.5) - 24 : Math.round(H * 0.83) - 24;
  return { x, y: top, w, h: bottom - top };
}

export function templateFrame(
  p: FramePacket,
  profile: OutputProfile,
  tokens: DesignTokens,
  opts: { karaoke: boolean },
): string {
  const id = p.frame.id;
  const P = `${id}-`;
  const dur = r1(p.timing.duration_ms / 1000);
  const { width: W, height: H } = profile;
  const kind = pickTemplate(p);
  const box = contentBox(profile, opts.karaoke);
  const css: string[] = [
    `#root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; font-family: ${tokens.font}; }`,
    `.${P}bg { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; background: ${tokens.canvas}; }`,
    `.${P}glow { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; background: radial-gradient(ellipse at 50% 35%, ${tokens.accent}22, ${tokens.canvas}00 65%); }`,
    `.${P}t > span { display: inline-block; }`,
    `.${P}t { position: absolute; display: flex; align-items: center; justify-content: center; text-align: center; color: ${tokens.ink}; font-weight: 800; letter-spacing: -0.02em; line-height: 1.15; overflow-wrap: anywhere; }`,
  ];
  const els: string[] = [];
  const anim: string[] = [];
  let track = 0;
  const clip = (cls: string, inner: string, sfId?: string) =>
    `<div class="clip ${cls}"${sfId ? ` data-sf-id="${sfId}"` : ''} data-start="0" data-duration="${dur}" data-track-index="${track++}">${inner}</div>`;

  // nền: layer background có ảnh → ảnh phủ kín; không thì màu canvas (+ quầng sáng nhẹ)
  const bgLayer = p.frame.layers.find((l) => l.kind === 'background');
  const assetOf = (layerAsset?: string) => p.assets.find((a) => a.asset_id === layerAsset);
  const bgAsset = assetOf(bgLayer?.asset_id);
  els.push(
    clip(
      `${P}bg`,
      bgAsset
        ? `<img class="${P}bgimg" src="${esc(bgAsset.file)}" alt="" style="width:100%;height:100%;object-fit:cover;opacity:0.35">`
        : '',
      bgLayer?.id,
    ),
  );
  if (bgAsset)
    anim.push(
      `tl.fromTo(".${P}bgimg", { scale: 1 }, { scale: 1.06, duration: ${dur}, ease: "none" }, 0);`,
    );
  // ảnh nền: lớp phủ màu canvas giữ tương phản cho chữ (WCAG AA — hyperframes check)
  if (bgAsset)
    css.push(
      `.${P}glow { background: linear-gradient(180deg, ${tokens.canvas}d9, ${tokens.canvas}b3); }`,
    );
  els.push(clip(`${P}glow`, ''));
  anim.push(
    `tl.fromTo(".${P}glow", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power2.out" }, 0);`,
  );

  const texts = p.frame.layers.filter((l) => l.kind === 'text');
  const media = p.frame.layers.filter(
    (l) => (l.kind === 'image' || l.kind === 'object') && assetOf(l.asset_id),
  );
  // chữ và ảnh chiếm hộp nội dung; ảnh ở nửa dưới hộp khi có chữ
  const textBox: Box = media.length && texts.length ? { ...box, h: Math.round(box.h * 0.42) } : box;
  const mediaBox: Box =
    media.length && texts.length
      ? { x: box.x, y: box.y + Math.round(box.h * 0.46), w: box.w, h: Math.round(box.h * 0.54) }
      : box;
  const at = (i: number, n: number) =>
    r1(Math.min(0.15 + i * Math.min(0.6, (dur * 0.5) / Math.max(1, n)), dur * 0.7));
  const col = (c: string) => readable(c, tokens.canvas, tokens.ink);
  const textEl = (
    l: (typeof texts)[number],
    b: Box,
    size: number,
    color: string,
    i: number,
    from: string,
  ) => {
    const cls = `${P}${l.id}`;
    css.push(
      `.${cls} { left: ${b.x}px; top: ${b.y}px; width: ${b.w}px; height: ${b.h}px; font-size: ${size}px; color: ${col(color)}; }`,
    );
    els.push(clip(`${P}t ${cls}`, `<span class="${cls}-in">${esc(l.text ?? '')}</span>`, l.id));
    anim.push(
      `tl.fromTo(".${cls}-in", ${from}, { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.55, ease: "power3.out" }, ${at(i, texts.length)});`,
    );
  };
  const maxSize = Math.round(Math.min(W, H) * 0.15);

  if (kind === 'split-reveal' && texts.length) {
    const parts =
      texts.length >= 2
        ? texts.slice(0, 2).map((l) => ({ l, text: l.text ?? '' }))
        : (texts[0]!.text ?? '')
            .split(SPLIT)
            .slice(0, 2)
            .map((t) => ({ l: texts[0]!, text: t }));
    const vertical = H > W;
    const halves: Box[] = vertical
      ? [
          { ...textBox, h: Math.round(textBox.h / 2) - 12 },
          {
            ...textBox,
            y: textBox.y + Math.round(textBox.h / 2) + 12,
            h: Math.round(textBox.h / 2) - 12,
          },
        ]
      : [
          { ...textBox, w: Math.round(textBox.w / 2) - 16 },
          {
            ...textBox,
            x: textBox.x + Math.round(textBox.w / 2) + 16,
            w: Math.round(textBox.w / 2) - 16,
          },
        ];
    if (texts.length >= 2) {
      parts.forEach((x, i) =>
        textEl(
          { ...x.l, text: x.text },
          halves[i]!,
          fitFontSize(x.text, halves[i]!, maxSize),
          i ? tokens.accent : tokens.ink,
          i,
          vertical ? `{ opacity: 0, y: ${i ? 60 : -60} }` : `{ opacity: 0, x: ${i ? 80 : -80} }`,
        ),
      );
    } else {
      // một layer có "A ≠ B": layer giữ cả câu, hai nửa là span con
      const l = texts[0]!;
      const cls = `${P}${l.id}`;
      const size = Math.min(...parts.map((x, i) => fitFontSize(x.text, halves[i]!, maxSize)));
      css.push(
        `.${cls} { left: ${textBox.x}px; top: ${textBox.y}px; width: ${textBox.w}px; height: ${textBox.h}px; font-size: ${size}px; flex-direction: ${vertical ? 'column' : 'row'}; gap: 0.4em; }`,
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
    }
    texts.slice(parts.length >= 2 && texts.length >= 2 ? 2 : 1).forEach((l, i) => {
      const b = { ...textBox, y: textBox.y + textBox.h - 120, h: 110 };
      textEl(l, b, fitFontSize(l.text ?? '', b, 56), tokens.muted, i + 2, '{ opacity: 0, y: 30 }');
    });
  } else if (kind === 'list' && texts.length) {
    const rowH = Math.floor(textBox.h / texts.length);
    texts.forEach((l, i) => {
      const b = { ...textBox, y: textBox.y + i * rowH, h: rowH - 12 };
      textEl(
        l,
        b,
        fitFontSize(l.text ?? '', b, Math.round(maxSize * 0.6)),
        i === 0 ? tokens.accent : tokens.ink,
        i,
        '{ opacity: 0, x: -60 }',
      );
    });
  } else {
    texts.forEach((l, i) => {
      const n = texts.length;
      const h = Math.floor(textBox.h / n);
      const b = { ...textBox, y: textBox.y + i * h, h: h - 12 };
      const stat = kind === 'stat-pop' && i === 0;
      textEl(
        l,
        b,
        fitFontSize(l.text ?? '', b, stat ? Math.round(maxSize * 1.3) : maxSize),
        stat ? tokens.accent : i === 0 ? tokens.ink : tokens.muted,
        i,
        stat ? '{ opacity: 0, scale: 0.55 }' : '{ opacity: 0, y: 48 }',
      );
      if (stat)
        anim.push(
          `tl.to(".${P}${l.id}-in", { scale: 1.06, duration: 0.25, ease: "power2.out" }, ${r1(at(0, n) + 0.55)});`,
          `tl.to(".${P}${l.id}-in", { scale: 1, duration: 0.3, ease: "power2.inOut" }, ${r1(at(0, n) + 0.8)});`,
        );
    });
  }

  // ảnh/vật thể có asset: khung ảnh + Ken Burns chậm
  media.forEach((l, i) => {
    const a = assetOf(l.asset_id)!;
    const cls = `${P}${l.id}`;
    const n = media.length;
    const w = Math.floor((mediaBox.w - (n - 1) * 24) / n);
    css.push(
      `.${cls} { position: absolute; left: ${mediaBox.x + i * (w + 24)}px; top: ${mediaBox.y}px; width: ${w}px; height: ${mediaBox.h}px; overflow: hidden; border-radius: 16px; }`,
      `.${cls} img { width: 100%; height: 100%; object-fit: ${a.alpha ? 'contain' : 'cover'}; }`,
    );
    els.push(clip(cls, `<img class="${cls}-img" src="${esc(a.file)}" alt="">`, l.id));
    anim.push(
      `tl.fromTo(".${cls}-img", { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1.08, duration: 0.5, ease: "power2.out" }, ${r1(0.1 + i * 0.2)});`,
      `tl.to(".${cls}-img", { scale: 1, duration: ${r1(Math.max(0.5, dur - 0.6))}, ease: "none" }, ${r1(0.6 + i * 0.2)});`,
    );
  });

  // layer còn lại (shape, chart, overlay, object/image thiếu ảnh, mouth): phần tử đặt chỗ tối giản
  const placed = new Set([bgLayer?.id, ...texts.map((l) => l.id), ...media.map((l) => l.id)]);
  p.frame.layers
    .filter((l) => !placed.has(l.id))
    .forEach((l, i) => {
      const cls = `${P}${l.id}`;
      if (l.kind === 'mouth') {
        css.push(
          `.${cls} { position: absolute; left: ${Math.round(W / 2 - W * 0.03)}px; top: ${Math.round(H * 0.45)}px; width: ${Math.round(W * 0.06)}px; height: ${Math.round(W * 0.036)}px; }`,
        );
        els.push(clip(cls, '', l.id));
        return;
      }
      // dải nhấn màu accent dưới hộp chữ (không thay nội dung — người dùng thay ảnh/vẽ lại trong Studio)
      const y = Math.min(box.y + box.h - 16, textBox.y + textBox.h + 8 + i * 20);
      css.push(
        `.${cls} { position: absolute; left: ${box.x + Math.round(box.w * 0.3)}px; top: ${y}px; width: ${Math.round(box.w * 0.4)}px; height: 10px; border-radius: 5px; background: ${i % 2 ? tokens.accent2 : tokens.accent}; transform-origin: 50% 50%; }`,
      );
      els.push(
        clip(
          cls,
          `<div class="${cls}-bar" style="width:100%;height:100%;border-radius:5px;background:inherit"></div>`,
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
    ...css.map((c) => `  ${c}`),
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
