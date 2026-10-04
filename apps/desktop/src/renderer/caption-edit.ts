/**
 * Thao tác bảng caption (UI-11, D9 mục 6, FN-026) — logic thuần, không phụ thuộc DOM. Mỗi thao tác trả
 * trạng thái mới (cụm hiển thị + `caption-overrides.json`); mốc theo chuỗi lời đọc (= mốc trên voice.wav).
 */

export interface Group {
  id: string;
  line_id: string;
  word_range: [number, number];
  text: string;
  start_ms: number;
  end_ms: number;
  emphasis?: number[];
  text_override?: true;
}

export interface Overrides {
  schema_version: number;
  video_id: string;
  style?: unknown;
  groups: Record<string, { start_ms?: number; end_ms?: number; text?: string }>;
  splits: { group_id: string; at_word: number; new_id: string }[];
  merges: { group_ids: string[]; new_id: string }[];
}

export interface Line {
  line_id: string;
  start_ms: number;
  duration_ms: number;
  words: { text: string; start_ms: number; end_ms: number }[];
}

export interface PanelState {
  groups: Group[];
  overrides: Overrides;
}

export const STEP_MS = 10;
export const SNAP_MS = 40;

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export function newGroupId(taken: Set<string>, rand: () => number = Math.random): string {
  for (;;) {
    let s = 'cg_';
    for (let i = 0; i < 8; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
    if (!taken.has(s)) return s;
  }
}

/** Mốc từ (tuyệt đối trên chuỗi lời đọc) của một line — dùng để bám mép. */
function wordEdges(line?: Line): number[] {
  if (!line) return [];
  return line.words.flatMap((w) => [line.start_ms + w.start_ms, line.start_ms + w.end_ms]);
}

/**
 * Kéo mép cụm: bước 10 ms, bám mốc từ trong ±40 ms, kẹp trong khoảng audio của line, không chồng lên
 * cụm kề cùng line (chặn tại mép cụm kề), giữ `start < end`.
 */
export function dragEdge(
  s: PanelState,
  lines: Line[],
  id: string,
  edge: 'start' | 'end',
  ms: number,
): PanelState {
  const i = s.groups.findIndex((g) => g.id === id);
  const g = s.groups[i];
  if (!g) return s;
  const line = lines.find((l) => l.line_id === g.line_id);
  let t = Math.round(ms / STEP_MS) * STEP_MS;
  const near = wordEdges(line)
    .map((e) => ({ e, d: Math.abs(e - ms) }))
    .filter((x) => x.d <= SNAP_MS)
    .sort((a, b) => a.d - b.d)[0];
  if (near) t = near.e;
  const same = s.groups.filter((x) => x.line_id === g.line_id && x.id !== id);
  const prev = same.filter((x) => x.end_ms <= g.start_ms).sort((a, b) => b.end_ms - a.end_ms)[0];
  const next = same
    .filter((x) => x.start_ms >= g.end_ms)
    .sort((a, b) => a.start_ms - b.start_ms)[0];
  const lo = Math.max(line?.start_ms ?? 0, prev?.end_ms ?? 0);
  const hi = Math.min(
    line ? line.start_ms + line.duration_ms : Infinity,
    next?.start_ms ?? Infinity,
  );
  if (edge === 'start') t = Math.max(lo, Math.min(t, g.end_ms - STEP_MS));
  else t = Math.min(hi, Math.max(t, g.start_ms + STEP_MS));
  if ((edge === 'start' ? g.start_ms : g.end_ms) === t) return s;
  const out = clone(s);
  const k = edge === 'start' ? 'start_ms' : 'end_ms';
  out.groups[i]![k] = t;
  out.overrides.groups[id] = { ...out.overrides.groups[id], [k]: t };
  return out;
}

/** Sửa chữ hiển thị (không đổi lời đọc — muốn đổi lời đọc thì sửa qua chat). */
export function setText(s: PanelState, id: string, text: string): PanelState {
  const i = s.groups.findIndex((g) => g.id === id);
  if (i < 0 || s.groups[i]!.text === text) return s;
  const out = clone(s);
  out.groups[i] = { ...out.groups[i]!, text, text_override: true };
  out.overrides.groups[id] = { ...out.overrides.groups[id], text };
  return out;
}

const mergedIds = (o: Overrides) => new Set(o.merges.map((m) => m.new_id));

/** Có tách được tại từ `at` không (cụm gộp không tách lại: thứ tự áp tách trước gộp, D3 5.8). */
export function canSplit(s: PanelState, id: string, at: number): boolean {
  const g = s.groups.find((x) => x.id === id);
  return Boolean(
    g && !mergedIds(s.overrides).has(id) && at > g.word_range[0] && at <= g.word_range[1],
  );
}

/** Tách cụm tại từ `at` (chỉ số word trong line, là từ đầu của cụm mới). */
export function split(
  s: PanelState,
  lines: Line[],
  id: string,
  at: number,
  newId: string,
): PanelState {
  if (!canSplit(s, id, at)) return s;
  const out = clone(s);
  const i = out.groups.findIndex((x) => x.id === id);
  const g = out.groups[i]!;
  const line = lines.find((l) => l.line_id === g.line_id);
  const w = line?.words ?? [];
  const cut = w[at] ? line!.start_ms + w[at]!.start_ms : Math.round((g.start_ms + g.end_ms) / 2);
  const prevEnd = w[at - 1] ? line!.start_ms + w[at - 1]!.end_ms : cut;
  const words = (r: [number, number]) =>
    w.length > r[1]
      ? w
          .slice(r[0], r[1] + 1)
          .map((x) => x.text)
          .join(' ')
      : g.text;
  const a: [number, number] = [g.word_range[0], at - 1];
  const b: [number, number] = [at, g.word_range[1]];
  const left: Group = {
    ...g,
    word_range: a,
    text: words(a),
    end_ms: Math.max(g.start_ms + STEP_MS, Math.min(prevEnd, cut)),
  };
  const right: Group = {
    ...g,
    id: newId,
    word_range: b,
    text: words(b),
    start_ms: Math.max(left.end_ms, cut),
  };
  delete left.text_override;
  delete right.text_override;
  if (g.emphasis) {
    left.emphasis = g.emphasis.filter((k) => k <= a[1]);
    right.emphasis = g.emphasis.filter((k) => k >= b[0]);
  }
  out.groups.splice(i, 1, left, right);
  // override cũ của cụm gốc: mép phải chuyển sang cụm mới; chữ sửa tay bỏ (đã tách theo từ)
  const old = out.overrides.groups[id] ?? {};
  out.overrides.splits.push({ group_id: id, at_word: at, new_id: newId });
  out.overrides.groups[id] = {
    ...(old.start_ms !== undefined ? { start_ms: old.start_ms } : {}),
    end_ms: left.end_ms,
  };
  out.overrides.groups[newId] = {
    start_ms: right.start_ms,
    ...(old.end_ms !== undefined ? { end_ms: old.end_ms } : {}),
  };
  return out;
}

/** Gộp cụm `id` với cụm kề sau nó (cùng line). */
export function mergeNext(s: PanelState, id: string, newId: string): PanelState {
  const i = s.groups.findIndex((g) => g.id === id);
  const a = s.groups[i];
  const b = s.groups[i + 1];
  if (!a || !b || a.line_id !== b.line_id) return s;
  const out = clone(s);
  const textEdited = Boolean(a.text_override || b.text_override);
  const merged: Group = {
    ...a,
    id: newId,
    word_range: [a.word_range[0], b.word_range[1]],
    text: `${a.text} ${b.text}`,
    start_ms: Math.min(a.start_ms, b.start_ms),
    end_ms: Math.max(a.end_ms, b.end_ms),
    ...(a.emphasis || b.emphasis
      ? { emphasis: [...(a.emphasis ?? []), ...(b.emphasis ?? [])] }
      : {}),
  };
  if (!textEdited) delete merged.text_override;
  out.groups.splice(i, 2, merged);
  out.overrides.merges.push({ group_ids: [a.id, b.id], new_id: newId });
  delete out.overrides.groups[a.id];
  delete out.overrides.groups[b.id];
  out.overrides.groups[newId] = {
    start_ms: merged.start_ms,
    end_ms: merged.end_ms,
    ...(textEdited ? { text: merged.text } : {}),
  };
  return out;
}

/** Cụm đang phát tại `ms` (hoặc cụm gần nhất phía trước). */
export function groupAt(groups: Group[], ms: number): Group | undefined {
  return (
    groups.find((g) => g.start_ms <= ms && ms < g.end_ms) ??
    [...groups].reverse().find((g) => g.start_ms <= ms)
  );
}

/** Lịch sử Ctrl+Z / Ctrl+Y. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(public current: T) {}
  push(next: T): T {
    if (next === this.current) return next;
    this.past.push(this.current);
    this.future = [];
    this.current = next;
    return next;
  }
  undo(): T {
    const p = this.past.pop();
    if (p !== undefined) {
      this.future.push(this.current);
      this.current = p;
    }
    return this.current;
  }
  redo(): T {
    const f = this.future.pop();
    if (f !== undefined) {
      this.past.push(this.current);
      this.current = f;
    }
    return this.current;
  }
  reset(v: T): void {
    this.past = [];
    this.future = [];
    this.current = v;
  }
}
