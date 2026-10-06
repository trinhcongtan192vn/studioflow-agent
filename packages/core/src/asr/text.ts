/** Từ có mốc (D3 5.7 `words`, tương đối đầu line). */
export interface TimedWord {
  i: number;
  text: string;
  start_ms: number;
  end_ms: number;
  conf?: number;
}

const PUNCT = /[\p{P}\p{S}]+/gu;

/** Chuẩn hóa một từ: NFC, chữ thường, bỏ dấu câu/ký hiệu (010 R2). */
export const normalizeWord = (w: string): string =>
  w.normalize('NFC').toLowerCase().replace(PUNCT, '');

/** Từ hiển thị (giữ dấu câu) — tách theo khoảng trắng. */
export const displayWords = (text: string): string[] => text.split(/\s+/).filter(Boolean);

export const normalizeTokens = (text: string): string[] =>
  displayWords(text).map(normalizeWord).filter(Boolean);

/** Khoảng cách Levenshtein theo token + bảng truy vết (dùng chung cho WER và căn từ). */
function editTable(a: string[], b: string[]): number[][] {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d;
}

/** WER = khoảng cách token / số token tham chiếu (tham chiếu rỗng → 0 nếu giả thuyết rỗng, ngược lại 1). */
export function wordErrorRate(ref: string[], hyp: string[]): number {
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return Math.min(1, editTable(ref, hyp)[ref.length]![hyp.length]! / ref.length);
}

/**
 * Âm tiết tiếng Việt quy về một dạng cho các phụ âm đầu ASR hay nghe lẫn (Whisper, giọng Bắc):
 * tr→ch, s→x, gi/r→d (038). Không đổi vần/thanh.
 */
const foldViSyllable = (s: string): string =>
  s
    .replace(/^tr/, 'ch')
    .replace(/^s/, 'x')
    .replace(/^gi(?=[^n]|$)/, 'd')
    .replace(/^r/, 'd');

/**
 * Tỷ lệ đọc sai của một line (038). Tiếng Việt: so theo ký tự sau khi bỏ khoảng trắng và quy phụ âm
 * đầu dễ lẫn — Whisper hay dính tiểu từ ("ngay ạ" → "ngayạ"), mỗi chỗ dính tính 2 lỗi nếu so theo từ.
 * Ngôn ngữ khác: WER theo từ.
 */
export function asrErrorRate(expected: string, transcript: string, language: string): number {
  const ref = normalizeTokens(expected);
  const hyp = normalizeTokens(transcript);
  if (language !== 'vi') return wordErrorRate(ref, hyp);
  const chars = (t: string[]) => [...t.map(foldViSyllable).join('')];
  const a = chars(ref);
  const b = chars(hyp);
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  return Math.min(1, editTable(a, b)[a.length]![b.length]! / a.length);
}

/** Cặp chỉ số khớp đúng (a_i ↔ b_j) theo đường đi Levenshtein tối ưu. */
function matches(a: string[], b: string[]): Map<number, number> {
  const d = editTable(a, b);
  const out = new Map<number, number>();
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1] && d[i]![j] === d[i - 1]![j - 1]) {
      out.set(i - 1, j - 1);
      i--;
      j--;
    } else if (d[i]![j] === d[i - 1]![j - 1]! + 1) {
      i--;
      j--;
    } else if (d[i]![j] === d[i - 1]![j]! + 1) i--;
    else j--;
  }
  return out;
}

/** Rải các từ theo tỉ lệ số ký tự trên [from, to]. */
function spread(words: string[], from: number, to: number): { start_ms: number; end_ms: number }[] {
  const weights = words.map((w) => Math.max(1, normalizeWord(w).length || w.length));
  const total = weights.reduce((s, x) => s + x, 0);
  let t = from;
  return weights.map((wt, k) => {
    const start = Math.round(t);
    t += ((to - from) * wt) / total;
    return { start_ms: start, end_ms: k === weights.length - 1 ? Math.round(to) : Math.round(t) };
  });
}

/**
 * Mốc cho **từ hiển thị** của line (010 R2): từ khớp lấy mốc ASR; từ không khớp nội suy giữa hai
 * mốc lân cận; `spoken` khác chữ hiển thị (tts_text) → rải theo tỉ lệ trên khoảng lời đọc.
 */
export function alignWords(
  text: string,
  spoken: string | undefined,
  asr: { text: string; start_ms: number; end_ms: number; conf?: number }[],
  durationMs: number,
): TimedWord[] {
  const shown = displayWords(text);
  if (shown.length === 0) return [];
  const span = asr.length
    ? { from: asr[0]!.start_ms, to: asr[asr.length - 1]!.end_ms }
    : { from: 0, to: durationMs };
  if (!asr.length || (spoken && spoken.trim() !== text.trim())) {
    return spread(shown, span.from, span.to).map((t, i) => ({ i, text: shown[i]!, ...t }));
  }
  const m = matches(
    shown.map(normalizeWord),
    asr.map((w) => normalizeWord(w.text)),
  );
  const out: TimedWord[] = shown.map((t, i) => {
    const j = m.get(i);
    const a = j === undefined ? undefined : asr[j]!;
    return a
      ? {
          i,
          text: t,
          start_ms: a.start_ms,
          end_ms: a.end_ms,
          ...(a.conf === undefined ? {} : { conf: a.conf }),
        }
      : { i, text: t, start_ms: -1, end_ms: -1 };
  });
  // nội suy các đoạn không khớp
  for (let i = 0; i < out.length;) {
    if (out[i]!.start_ms >= 0) {
      i++;
      continue;
    }
    let k = i;
    while (k < out.length && out[k]!.start_ms < 0) k++;
    const from = i === 0 ? span.from : out[i - 1]!.end_ms;
    const to = k === out.length ? span.to : out[k]!.start_ms;
    spread(
      out.slice(i, k).map((x) => x.text),
      from,
      Math.max(from, to),
    ).forEach((t, n) => Object.assign(out[i + n]!, t));
    i = k;
  }
  return out;
}
