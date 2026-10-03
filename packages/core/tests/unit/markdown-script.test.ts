// 002 · US3 AC3–5 · FR-006, FR-007 — SCRIPT.md (D3 5.4).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assignScriptIds, parseScript, serializeScript, toScriptDoc } from '../../src/index.js';
import { fixtureVideo } from '../domain-helpers.js';

const text = readFileSync(path.join(fixtureVideo, 'SCRIPT.md'), 'utf8');

describe('SCRIPT.md parser (002 FR-006)', () => {
  it('extracts beats and lines with attributes', () => {
    const doc = toScriptDoc(parseScript(text));
    expect(doc.front).toEqual({
      schema_version: 1,
      video_id: 'vd_8m2pq7rt',
      language: 'vi',
      status: 'approved',
    });
    expect(doc.beats).toEqual([
      { id: 'bt_4nd8w1zc', order: 0, title: 'Mở đầu', line_ids: ['ln_2r7c4kxm', 'ln_9w3b6tqa'] },
      { id: 'bt_7c1v5p0e', order: 1, title: 'Kết', line_ids: ['ln_5h8q2m3x'] },
    ]);
    expect(doc.lines[0]).toEqual({
      id: 'ln_2r7c4kxm',
      beat_id: 'bt_4nd8w1zc',
      order: 0,
      speaker: 'narrator',
      emotion: 'calm',
      pause_after_ms: 300,
      text: 'Năm 1428, Lê Lợi lên ngôi.',
      tts_text: 'Năm một nghìn bốn trăm hai mươi tám, Lê Lợi lên ngôi.',
    });
    expect(doc.lines[1]).toMatchObject({
      speaker: 'ca_a7f2k9wd',
      direction: 'giọng run',
      text: 'Bệ hạ…',
    });
    expect(doc.lines[2]).toMatchObject({
      order: 2,
      text: 'Triều Hậu Lê bắt đầu\nkéo dài hơn ba trăm năm.',
    });
  });

  it('round-trips byte-identically', () => {
    expect(serializeScript(parseScript(text))).toBe(text);
  });

  it('CRLF input parses like LF', () => {
    const crlf = text.replace(/\n/g, '\r\n');
    expect(toScriptDoc(parseScript(crlf))).toEqual(toScriptDoc(parseScript(text)));
  });

  it('editing one line text changes only that line and keeps its id', () => {
    const parsed = parseScript(text);
    parsed.lines[1]!.text = 'Tâu bệ hạ…';
    const out = serializeScript(parsed);
    const a = text.split('\n');
    const b = out.split('\n');
    expect(b.length).toBe(a.length);
    expect(a.filter((l, i) => l !== b[i])).toEqual(['Bệ hạ…']);
    expect(toScriptDoc(parseScript(out)).lines[1]!.id).toBe('ln_9w3b6tqa');
  });

  it('editing marker attributes rewrites only the marker', () => {
    const parsed = parseScript(text);
    parsed.lines[0]!.attrs.emotion = 'sad';
    const out = serializeScript(parsed);
    expect(out).toContain(
      '<!-- sf:line id=ln_2r7c4kxm speaker=narrator emotion=sad pause_after_ms=300 -->',
    );
    expect(out.replace('emotion=sad', 'emotion=calm')).toBe(text);
  });
});

describe('ID assignment (002 FR-007)', () => {
  const draft = [
    '---',
    'schema_version: 1',
    'video_id: vd_8m2pq7rt',
    'language: vi',
    'status: draft',
    '---',
    '## Mở đầu <!-- sf:beat -->',
    '',
    '<!-- sf:line speaker=narrator -->',
    'Câu một.',
    '',
    '<!-- sf:line id=ln_2r7c4kxm speaker=narrator -->',
    'Câu hai.',
    '',
  ].join('\n');

  it('assigns new ids to beats/lines without id, keeps existing', () => {
    const { text: out, assigned } = assignScriptIds(draft, new Set(['ln_2r7c4kxm']));
    expect(assigned).toHaveLength(2);
    expect(assigned[0]).toMatch(/^bt_[0-9a-z]{8}$/);
    expect(assigned[1]).toMatch(/^ln_[0-9a-z]{8}$/);
    const doc = toScriptDoc(parseScript(out));
    expect(doc.lines.map((l) => l.id)).toEqual([assigned[1], 'ln_2r7c4kxm']);
    expect(out).toContain(`## Mở đầu <!-- sf:beat id=${assigned[0]} -->`);
  });

  it('toScriptDoc rejects missing ids', () => {
    expect(() => toScriptDoc(parseScript(draft))).toThrow(
      expect.objectContaining({ code: 'E_SCHEMA_INVALID' }),
    );
  });
});

describe('marker errors (002 US3 AC5)', () => {
  it('line marker without paragraph → E_PARSE_MARKER with line number', () => {
    const bad =
      '---\nschema_version: 1\nvideo_id: vd_8m2pq7rt\nlanguage: vi\nstatus: draft\n---\n## A <!-- sf:beat id=bt_4nd8w1zc -->\n\n<!-- sf:line id=ln_2r7c4kxm speaker=narrator -->\n\nx\n';
    expect(() => parseScript(bad)).toThrow(
      expect.objectContaining({ code: 'E_PARSE_MARKER', line: 9 }),
    );
  });

  it('unterminated quoted attribute → E_PARSE_MARKER', () => {
    const bad =
      '---\nschema_version: 1\nvideo_id: vd_8m2pq7rt\nlanguage: vi\nstatus: draft\n---\n## A <!-- sf:beat id=bt_4nd8w1zc -->\n\n<!-- sf:line speaker=narrator direction="run -->\nx\n';
    expect(() => parseScript(bad)).toThrow(expect.objectContaining({ code: 'E_PARSE_MARKER' }));
  });

  it('line before any beat → E_PARSE_MARKER', () => {
    const bad =
      '---\nschema_version: 1\nvideo_id: vd_8m2pq7rt\nlanguage: vi\nstatus: draft\n---\n<!-- sf:line speaker=narrator -->\nx\n';
    expect(() => parseScript(bad)).toThrow(
      expect.objectContaining({ code: 'E_PARSE_MARKER', line: 7 }),
    );
  });

  it('missing front matter → E_PARSE_MARKER', () => {
    expect(() => parseScript('## A <!-- sf:beat -->\n')).toThrow(
      expect.objectContaining({ code: 'E_PARSE_MARKER' }),
    );
  });

  it('unknown sf marker → E_PARSE_MARKER', () => {
    const bad =
      '---\nschema_version: 1\nvideo_id: vd_8m2pq7rt\nlanguage: vi\nstatus: draft\n---\n<!-- sf:bogus -->\n';
    expect(() => parseScript(bad)).toThrow(expect.objectContaining({ code: 'E_PARSE_MARKER' }));
  });
});
