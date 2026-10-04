import type { AudioMeta, CaptionGroups, CaptionOverrides } from '../contracts/types.js';
import { GSAP_SRC } from './index-html.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r3 = (x: number) => Math.round(x * 1000) / 1000;

type Group = CaptionGroups['groups'][number];
export type EffectiveGroup = Group & { text_override?: true };
/** Từ (mốc tương đối đầu line) của từng line trên chuỗi lời đọc — lấy từ `audio_meta.json`. */
export type LineWords = Map<
  string,
  { start_ms: number; words: { text: string; start_ms: number; end_ms: number }[] }
>;

export const lineWordsOf = (meta?: AudioMeta | null): LineWords =>
  new Map((meta?.lines ?? []).map((l) => [l.line_id, { start_ms: l.start_ms, words: l.words }]));

export interface EffectiveCaptions {
  groups: EffectiveGroup[];
  /** Override trỏ tới group không còn (D3 5.8: giữ lại, đánh dấu `orphan`). */
  orphans: string[];
}

/**
 * Áp `caption-overrides.json` lên `caption_groups.json` (D3 5.8, D9 6, 026): tách (`splits`, `at_word` là
 * chỉ số word đầu cụm mới), gộp (`merges`, cụm kề cùng line), rồi mốc/chữ theo group. Mốc theo chuỗi lời đọc.
 */
export function effectiveCaptions(
  g: CaptionGroups,
  o?: CaptionOverrides | null,
  lines: LineWords = new Map(),
): EffectiveCaptions {
  const out: EffectiveGroup[] = g.groups.map((x) => ({ ...x }));
  const orphans: string[] = [];
  const textOf = (x: Group, r: [number, number]) => {
    const l = lines.get(x.line_id);
    if (l && l.words.length > r[1])
      return l.words
        .slice(r[0], r[1] + 1)
        .map((w) => w.text)
        .join(' ');
    return x.text
      .split(/\s+/)
      .slice(r[0] - x.word_range[0], r[1] - x.word_range[0] + 1)
      .join(' ');
  };
  const withEmphasis = (x: EffectiveGroup, em: number[]): EffectiveGroup => {
    const { emphasis: _e, ...rest } = x;
    void _e;
    return em.length ? { ...rest, emphasis: em } : rest;
  };
  for (const sp of o?.splits ?? []) {
    const i = out.findIndex((x) => x.id === sp.group_id);
    const x = out[i];
    if (!x || sp.at_word <= x.word_range[0] || sp.at_word > x.word_range[1]) {
      orphans.push(`split:${sp.group_id}`);
      continue;
    }
    const l = lines.get(x.line_id);
    const a: [number, number] = [x.word_range[0], sp.at_word - 1];
    const b: [number, number] = [sp.at_word, x.word_range[1]];
    const cut = l?.words[sp.at_word]
      ? l.start_ms + l.words[sp.at_word]!.start_ms
      : Math.round(
          x.start_ms +
            ((x.end_ms - x.start_ms) * (sp.at_word - x.word_range[0])) /
              (x.word_range[1] - x.word_range[0] + 1),
        );
    const prevEnd = l?.words[sp.at_word - 1] ? l.start_ms + l.words[sp.at_word - 1]!.end_ms : cut;
    const em = x.emphasis ?? [];
    out.splice(
      i,
      1,
      withEmphasis(
        { ...x, word_range: a, text: textOf(x, a), end_ms: Math.min(prevEnd, cut) },
        em.filter((k) => k <= a[1]),
      ),
      withEmphasis(
        { ...x, id: sp.new_id, word_range: b, text: textOf(x, b), start_ms: cut },
        em.filter((k) => k >= b[0]),
      ),
    );
  }
  for (const m of o?.merges ?? []) {
    const idx = m.group_ids.map((id) => out.findIndex((x) => x.id === id)).sort((p, q) => p - q);
    const ys = idx.map((k) => out[k]!);
    const ok =
      idx.length >= 2 &&
      idx.every((k) => k >= 0) &&
      ys.every((y) => y.line_id === ys[0]!.line_id) &&
      idx.every((k, n) => n === 0 || k === idx[n - 1]! + 1);
    if (!ok) {
      orphans.push(`merge:${m.group_ids.join('+')}`);
      continue;
    }
    const r: [number, number] = [ys[0]!.word_range[0], ys.at(-1)!.word_range[1]];
    out.splice(
      idx[0]!,
      ys.length,
      withEmphasis(
        {
          ...ys[0]!,
          id: m.new_id,
          word_range: r,
          text: textOf(ys[0]!, r),
          start_ms: Math.min(...ys.map((y) => y.start_ms)),
          end_ms: Math.max(...ys.map((y) => y.end_ms)),
        },
        ys.flatMap((y) => y.emphasis ?? []),
      ),
    );
  }
  for (const [id, ov] of Object.entries(o?.groups ?? {})) {
    const x = out.find((y) => y.id === id);
    if (!x) {
      orphans.push(id);
      continue;
    }
    if (ov.start_ms !== undefined) x.start_ms = ov.start_ms;
    if (ov.end_ms !== undefined) x.end_ms = ov.end_ms;
    if (ov.text !== undefined && ov.text !== x.text) {
      x.text = ov.text;
      x.text_override = true;
    }
  }
  return { groups: out, orphans };
}

/** Áp override, chỉ lấy danh sách cụm. */
export function applyCaptionOverrides(
  g: CaptionGroups,
  o?: CaptionOverrides | null,
  lines?: LineWords,
): EffectiveGroup[] {
  return effectiveCaptions(g, o, lines).groups;
}

/**
 * Bất biến khi lưu (D9 6): cụm cùng line không chồng nhau; `start_ms < end_ms`; mốc nằm trong khoảng
 * audio của line. Trả danh sách vi phạm (rỗng = hợp lệ).
 */
export function captionViolations(groups: EffectiveGroup[], meta: AudioMeta): string[] {
  const bad: string[] = [];
  const lines = new Map(meta.lines.map((l) => [l.line_id, l]));
  const byLine = new Map<string, EffectiveGroup[]>();
  for (const x of groups) {
    if (!(x.start_ms < x.end_ms)) bad.push(`${x.id}: start_ms must be < end_ms`);
    const l = lines.get(x.line_id);
    if (l && (x.start_ms < l.start_ms || x.end_ms > l.start_ms + l.duration_ms))
      bad.push(
        `${x.id}: ${x.start_ms}–${x.end_ms} ms is outside line ${l.line_id} audio ${l.start_ms}–${l.start_ms + l.duration_ms} ms`,
      );
    byLine.set(x.line_id, [...(byLine.get(x.line_id) ?? []), x]);
  }
  for (const xs of byLine.values()) {
    const s = [...xs].sort((a, b) => a.start_ms - b.start_ms);
    for (let k = 1; k < s.length; k++)
      if (s[k]!.start_ms < s[k - 1]!.end_ms) bad.push(`${s[k - 1]!.id} overlaps ${s[k]!.id}`);
  }
  return bad;
}

export interface CaptionWordTiming {
  /** Mốc tuyệt đối trên video (ms) của từng từ trong group, cùng thứ tự với chữ. */
  words: { text: string; start_ms: number }[];
}

/**
 * `compositions/captions.html` — sub-composition caption (FN-common mục 3): mỗi group một clip ở dải
 * dưới (vùng giữ chỗ ~17% của frame worker), từ đang đọc được tô màu nhấn.
 */
export function buildCaptionsHtml(i: {
  width: number;
  height: number;
  groups: (CaptionGroups['groups'][number] & {
    abs_start_ms: number;
    abs_end_ms: number;
    words: { text: string; start_ms: number }[];
  })[];
  style?: string;
}): string {
  const fontPx = Math.round(i.height * 0.045);
  const bottom = Math.round(i.height * 0.06);
  const clips = i.groups.map((g, n) => {
    const words = g.words
      .map((w, k) => `<span class="w" id="cap-${g.id}-${k}">${esc(w.text)}</span>`)
      .join(' ');
    return `    <div class="clip cap" id="cap-${g.id}" data-sf-caption="${g.id}" data-start="${r3(g.abs_start_ms / 1000)}" data-duration="${r3(Math.max(1, g.abs_end_ms - g.abs_start_ms) / 1000)}" data-track-index="${n % 2}"><div class="pill">${words}</div></div>`;
  });
  const tweens = i.groups.flatMap((g) =>
    g.words.map(
      (w, k) => `    tl.set("#cap-${g.id}-${k}", { color: "#FFD54A" }, ${r3(w.start_ms / 1000)});`,
    ),
  );
  return `<template>
  <div id="root" data-composition-id="captions" data-width="${i.width}" data-height="${i.height}">
    <script src="${GSAP_SRC}"></script>
    <style>
      #root { position: relative; width: ${i.width}px; height: ${i.height}px; }
      .cap { position: absolute; left: 0; right: 0; bottom: ${bottom}px; display: flex; justify-content: center; }
      .pill { max-width: ${Math.round(i.width * 0.8)}px; padding: ${Math.round(fontPx * 0.3)}px ${Math.round(fontPx * 0.6)}px; border-radius: ${Math.round(fontPx * 0.4)}px; background: rgba(0, 0, 0, 0.62); color: #ffffff; font-family: sans-serif; font-weight: 700; font-size: ${fontPx}px; line-height: 1.25; text-align: center; }
      .w { color: #ffffff; }
    </style>
${clips.join('\n')}
    <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
${tweens.join('\n')}
    window.__timelines["captions"] = tl;
    </script>
  </div>
</template>
`;
}
