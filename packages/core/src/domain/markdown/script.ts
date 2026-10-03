import type { Beat, Line, ScriptDoc, ScriptFrontMatter } from '../../contracts/types.js';
import { SfError } from '../../errors.js';
import { newId, seededId } from '../ids.js';
import { renderBody } from './blocks.js';
import {
  parseError,
  renderFrontMatter,
  splitFrontMatter,
  toJsonKey,
  type FrontMatter,
} from './frontmatter.js';

/** Thuộc tính của marker `<!-- sf:x a=b c="d e" -->`, giữ thứ tự. */
export type Attrs = Record<string, string>;

export function parseAttrs(src: string, line: number): Attrs {
  const attrs: Attrs = {};
  let i = 0;
  const s = src.trim();
  while (i < s.length) {
    while (s[i] === ' ' || s[i] === '\t') i++;
    if (i >= s.length) break;
    const key = /^[a-z_][a-z0-9_]*/.exec(s.slice(i))?.[0];
    if (!key || s[i + key.length] !== '=')
      throw parseError(line, `bad marker attribute near "${s.slice(i, i + 20)}"`);
    i += key.length + 1;
    let value = '';
    if (s[i] === '"') {
      i++;
      for (;;) {
        if (i >= s.length) throw parseError(line, `unterminated quoted value for ${key}`);
        if (s[i] === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) {
          value += s[i + 1];
          i += 2;
        } else if (s[i] === '"') {
          i++;
          break;
        } else value += s[i++];
      }
    } else {
      const m = /^[^\s"]+/.exec(s.slice(i))?.[0] ?? '';
      value = m;
      i += m.length;
    }
    attrs[key] = value;
  }
  return attrs;
}

export function renderAttrs(attrs: Attrs): string {
  return Object.entries(attrs)
    .map(([k, v]) =>
      v === '' || /[\s"\\]/.test(v) || v.includes('-->')
        ? `${k}="${v.replace(/[\\"]/g, '\\$&')}"`
        : `${k}=${v}`,
    )
    .join(' ');
}

export interface ParsedBeat {
  title: string;
  attrs: Attrs;
  index: number; // dòng heading trong body
  orig: string;
}

export interface ParsedLine {
  attrs: Attrs;
  text: string;
  tts?: string;
  beat: number; // chỉ số beat
  marker: number; // dòng marker trong body
  textStart: number;
  textEnd: number; // loại trừ
  ttsLine?: number;
  orig: { attrs: string; text: string; tts?: string };
}

export interface ParsedScript {
  front: Record<string, unknown>;
  frontMatter: FrontMatter;
  body: string[];
  bodyStart: number;
  beats: ParsedBeat[];
  lines: ParsedLine[];
}

const BEAT = /^##\s+(.*?)\s*<!--\s*sf:beat(?:\s+(.*?))?\s*-->\s*$/;
const LINE = /^<!--\s*sf:line(?:\s+(.*?))?\s*-->\s*$/;
const TTS = /^<!--\s*sf:tts(?:\s+(.*?))?\s*-->\s*$/;
const ANY_SF = /<!--\s*sf:/;

/** Parse `SCRIPT.md` (D3 5.4). Line/beat chưa có `id` được giữ để gán sau. */
export function parseScript(text: string): ParsedScript {
  const { front, body, bodyStart } = splitFrontMatter(text);
  const beats: ParsedBeat[] = [];
  const lines: ParsedLine[] = [];
  for (let i = 0; i < body.length; i++) {
    const row = body[i]!;
    const lineNo = bodyStart + i;
    const b = BEAT.exec(row);
    if (b) {
      const attrs = parseAttrs(b[2] ?? '', lineNo);
      beats.push({ title: b[1]!, attrs, index: i, orig: toJsonKey([b[1], attrs]) });
      continue;
    }
    const l = LINE.exec(row);
    if (l) {
      if (!beats.length) throw parseError(lineNo, 'sf:line before any sf:beat heading');
      const attrs = parseAttrs(l[1] ?? '', lineNo);
      let j = i + 1;
      while (j < body.length && body[j]!.trim() !== '' && !ANY_SF.test(body[j]!)) j++;
      if (j === i + 1) throw parseError(lineNo, 'sf:line must be followed by a paragraph');
      const textLines = body.slice(i + 1, j);
      const parsed: ParsedLine = {
        attrs,
        text: textLines.join('\n'),
        beat: beats.length - 1,
        marker: i,
        textStart: i + 1,
        textEnd: j,
        orig: { attrs: toJsonKey(attrs), text: textLines.join('\n') },
      };
      const t = j < body.length ? TTS.exec(body[j]!) : null;
      if (t) {
        const tAttrs = parseAttrs(t[1] ?? '', bodyStart + j);
        if (tAttrs.text === undefined) throw parseError(bodyStart + j, 'sf:tts requires text="…"');
        parsed.tts = tAttrs.text;
        parsed.ttsLine = j;
        parsed.orig.tts = tAttrs.text;
        j++;
      }
      lines.push(parsed);
      i = j - 1;
      continue;
    }
    if (ANY_SF.test(row)) throw parseError(lineNo, `unexpected marker: ${row.trim()}`);
  }
  return { front: front.data, frontMatter: front, body, bodyStart, beats, lines };
}

/** Ghi lại: chỉ dòng của phần đã đổi được thay (round-trip byte-đồng nhất khi không đổi). */
export function serializeScript(p: ParsedScript): string {
  const reps: { start: number; end: number; lines: string[] }[] = [];
  for (const b of p.beats) {
    if (toJsonKey([b.title, b.attrs]) !== b.orig) {
      reps.push({
        start: b.index,
        end: b.index + 1,
        lines: [
          `## ${b.title} <!-- sf:beat ${renderAttrs(b.attrs)} -->`.replace(
            ' sf:beat  -->',
            ' sf:beat -->',
          ),
        ],
      });
    }
  }
  for (const l of p.lines) {
    if (toJsonKey(l.attrs) !== l.orig.attrs) {
      const a = renderAttrs(l.attrs);
      reps.push({
        start: l.marker,
        end: l.marker + 1,
        lines: [`<!-- sf:line${a ? ` ${a}` : ''} -->`],
      });
    }
    if (l.text !== l.orig.text)
      reps.push({ start: l.textStart, end: l.textEnd, lines: l.text.split('\n') });
    if (l.tts !== l.orig.tts) {
      const ttsRow = l.tts === undefined ? [] : [`<!-- sf:tts ${renderAttrs({ text: l.tts })} -->`];
      if (l.ttsLine !== undefined)
        reps.push({ start: l.ttsLine, end: l.ttsLine + 1, lines: ttsRow });
      else reps.push({ start: l.textEnd, end: l.textEnd, lines: ttsRow });
    }
  }
  p.frontMatter.data = p.front;
  return [...renderFrontMatter(p.frontMatter), ...renderBody(p.body, reps)].join('\n');
}

function withIdFirst(attrs: Attrs, id: string): Attrs {
  return { id, ...attrs };
}

/** Gán ID cho beat/line chưa có (D3 5.4); trả văn bản mới và danh sách ID đã gán theo thứ tự xuất hiện. */
export function assignScriptIds(
  text: string,
  taken: ReadonlySet<string> = new Set(),
  opts: { seed?: string } = {},
): { text: string; assigned: string[] } {
  const p = parseScript(text);
  const used = new Set<string>(taken);
  for (const b of p.beats) if (b.attrs.id) used.add(b.attrs.id);
  for (const l of p.lines) if (l.attrs.id) used.add(l.attrs.id);
  const items = [
    ...p.beats.map((b) => ({ at: b.index, kind: 'bt' as const, obj: b })),
    ...p.lines.map((l) => ({ at: l.marker, kind: 'ln' as const, obj: l })),
  ].sort((a, b) => a.at - b.at);
  const assigned: string[] = [];
  for (const it of items) {
    if (it.obj.attrs.id) continue;
    const id = opts.seed
      ? seededId(it.kind, `${opts.seed}:${assigned.length}`, used)
      : newId(it.kind, used);
    used.add(id);
    it.obj.attrs = withIdFirst(it.obj.attrs, id);
    assigned.push(id);
  }
  return { text: assigned.length ? serializeScript(p) : text, assigned };
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Mô hình `ScriptDoc` (D3 mục 4). `loose`: bỏ qua ID thiếu (để schema báo lỗi theo đường dẫn
 * trường) thay vì ném lỗi.
 */
export function toScriptDoc(p: ParsedScript, opts: { loose?: boolean } = {}): ScriptDoc {
  const missing = () => {
    if (!opts.loose)
      throw new SfError(
        'E_SCHEMA_INVALID',
        'SCRIPT.md has beats/lines without id; assign ids before use',
      );
  };
  const beats: Beat[] = p.beats.map((b, order) => {
    if (!b.attrs.id) missing();
    const { id, ...rest } = b.attrs;
    return {
      ...(id ? { id } : {}),
      order,
      title: b.title,
      ...rest,
      line_ids: [],
    } as unknown as Beat;
  });
  const lines: Line[] = p.lines.map((l, order) => {
    if (!l.attrs.id) missing();
    const beat = beats[l.beat]!;
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(l.attrs))
      fields[k] = k === 'pause_after_ms' && NUMERIC.test(v) ? Number(v) : v;
    const line = {
      ...fields,
      beat_id: beat.id,
      order,
      text: l.text,
      ...(l.tts === undefined ? {} : { tts_text: l.tts }),
    } as unknown as Line;
    if (line.id) beat.line_ids.push(line.id);
    return line;
  });
  return { front: p.front as unknown as ScriptFrontMatter, beats, lines };
}
