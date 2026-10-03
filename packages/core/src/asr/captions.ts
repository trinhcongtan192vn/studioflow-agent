import { existsSync, readFileSync } from 'node:fs';
import type { AudioMeta, CaptionGroups } from '../contracts/types.js';
import { seededId } from '../domain/ids.js';
import type { Builder } from '../graph/graph.js';
import type { TimedWord } from './text.js';

export interface CaptionLineInput {
  line_id: string;
  start_ms: number;
  speaker: string;
  words: TimedWord[];
}

const ENDS = /[.,;:!?…»”"')\]]$/u;

/** Từ cần nhấn: có chữ số, hoặc viết hoa không ở đầu câu (FN-common mục 3). */
function emphasis(words: TimedWord[], range: [number, number]): number[] {
  const out: number[] = [];
  for (let i = range[0]; i <= range[1]; i++) {
    const w = words[i]!.text;
    const sentenceStart = i === 0 || /[.!?…]$/u.test(words[i - 1]!.text);
    if (/\d/.test(w) || (!sentenceStart && /^\p{Lu}/u.test(w))) out.push(i);
  }
  return out;
}

/** Cụm caption theo FN-common mục 3 và 010 R5 (mốc trên chuỗi lời đọc). */
export function buildCaptionGroups(input: {
  videoId: string;
  style: string;
  maxWords: number;
  lines: CaptionLineInput[];
}): CaptionGroups {
  const max = Math.max(1, input.maxWords);
  const groups: CaptionGroups['groups'] = [];
  const used = new Set<string>();
  for (const l of input.lines) {
    const ranges: [number, number][] = [];
    let start = 0;
    l.words.forEach((w, i) => {
      const n = i - start + 1;
      if (n >= max || (n >= 2 && ENDS.test(w.text)) || i === l.words.length - 1) {
        ranges.push([start, i]);
        start = i + 1;
      }
    });
    // cụm cuối một từ → gộp vào cụm trước nếu không quá max + 2
    const last = ranges[ranges.length - 1];
    const prev = ranges[ranges.length - 2];
    if (
      last &&
      prev &&
      last[0] === last[1] &&
      last[1] - prev[0] + 1 <= max + 2 &&
      !ENDS.test(l.words[prev[1]]!.text)
    ) {
      ranges.splice(-2, 2, [prev[0], last[1]]);
    }
    for (const r of ranges) {
      const id = seededId('cg', `${l.line_id}:${r[0]}-${r[1]}`, used);
      used.add(id);
      const em = emphasis(l.words, r).map((i) => i);
      groups.push({
        id: id as CaptionGroups['groups'][number]['id'],
        line_id: l.line_id as CaptionGroups['groups'][number]['line_id'],
        word_range: r,
        text: l.words
          .slice(r[0], r[1] + 1)
          .map((w) => w.text)
          .join(' '),
        start_ms: l.start_ms + l.words[r[0]]!.start_ms,
        end_ms: l.start_ms + l.words[r[1]]!.end_ms,
        ...(em.length ? { emphasis: em } : {}),
        speaker: l.speaker,
      });
    }
  }
  return {
    schema_version: 1,
    video_id: input.videoId as CaptionGroups['video_id'],
    style: input.style,
    groups,
  };
}

/** Builder nút `captions` (D4 mục 8.1) → `caption_groups.json`. */
export const captionsBuilder: Builder = async (ctx) => {
  const rel = `${ctx.videoRel}/audio_meta.json`;
  if (!existsSync(ctx.store.abs(rel))) throw new Error('audio_meta.json is missing');
  const meta = JSON.parse(readFileSync(ctx.store.abs(rel), 'utf8')) as AudioMeta;
  const g = buildCaptionGroups({
    videoId: ctx.videoId,
    style: String(ctx.model.config('caption.style')),
    maxWords: Number(ctx.model.config('caption.max_words')),
    lines: meta.lines.map((l) => ({
      line_id: l.line_id,
      start_ms: l.start_ms,
      speaker: l.speaker,
      words: l.words,
    })),
  });
  ctx.store.write(`${ctx.videoRel}/caption_groups.json`, `${JSON.stringify(g, null, 2)}\n`, {
    by: 'graph.build',
  });
  return { outputs: ['caption_groups.json'] };
};
