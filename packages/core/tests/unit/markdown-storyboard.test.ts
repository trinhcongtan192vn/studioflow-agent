// 002 · FR-006, FR-007 — STORYBOARD.md (D3 5.5) và tài liệu khối (CAST, STORY).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assignStoryboardIds,
  parseBlocksDoc,
  parseStoryboard,
  serializeBlocksDoc,
  serializeStoryboard,
  toStoryboardDoc,
} from '../../src/index.js';
import { fixtureVideo } from '../domain-helpers.js';

const text = readFileSync(path.join(fixtureVideo, 'STORYBOARD.md'), 'utf8');

describe('STORYBOARD.md (002 FR-006)', () => {
  it('derives order, scene_id and frame_ids', () => {
    const doc = toStoryboardDoc(parseStoryboard(text));
    expect(doc.scenes).toHaveLength(1);
    expect(doc.scenes[0]).toMatchObject({
      id: 'sc_p0q2m5ka',
      order: 0,
      title: 'Kinh thành Thăng Long',
      frame_ids: ['fr_9x2b7cqe', 'fr_3m8k1w7d'],
      music: { query: 'trang nghiêm, chậm, đàn tranh', volume_db: -18 },
      config: { 'look.id': 'scene-look' },
    });
    expect(doc.frames.map((f) => [f.id, f.scene_id, f.order])).toEqual([
      ['fr_9x2b7cqe', 'sc_p0q2m5ka', 0],
      ['fr_3m8k1w7d', 'sc_p0q2m5ka', 1],
    ]);
    expect(doc.frames[0]!.layers[0]).toMatchObject({ id: 'el_t5w8n3ja', kind: 'background' });
  });

  it('round-trips byte-identically', () => {
    expect(serializeStoryboard(parseStoryboard(text))).toBe(text);
  });

  it('assigns ids to scenes, frames and layers without id', () => {
    const draft = text
      .replace('id: sc_p0q2m5ka\n', '')
      .replace('id: fr_3m8k1w7d\n', '')
      .replace('{ id: el_q2k7m4zp, kind: text', '{ kind: text');
    const { text: out, assigned } = assignStoryboardIds(draft, new Set());
    expect(assigned.map((a) => a.slice(0, 3)).sort()).toEqual(['el_', 'fr_', 'sc_']);
    const doc = toStoryboardDoc(parseStoryboard(out));
    expect(doc.scenes[0]!.id).toBe(assigned.find((a) => a.startsWith('sc_')));
    expect(doc.frames[0]!.layers[1]!.id).toBe(assigned.find((a) => a.startsWith('el_')));
    // phần không đổi giữ nguyên
    expect(out).toContain('Ghi chú văn xuôi tùy ý.');
    expect(out).toContain('intent: "Bản đồ Đại Việt hiện dần, chữ năm 1428 trượt vào"');
  });

  it('broken YAML in a block → E_PARSE_MARKER with line', () => {
    const bad = text.replace('beat_ids: [bt_4nd8w1zc]', 'beat_ids: [bt_4nd8w1zc');
    expect(() => parseStoryboard(bad)).toThrow(
      expect.objectContaining({ code: 'E_PARSE_MARKER', line: expect.any(Number) }),
    );
  });

  it('frame block before any scene → E_PARSE_MARKER', () => {
    const bad =
      '---\nschema_version: 1\nvideo_id: vd_8m2pq7rt\nstatus: draft\n---\n```sf-frame\nid: fr_9x2b7cqe\n```\n';
    expect(() => parseStoryboard(bad)).toThrow(expect.objectContaining({ code: 'E_PARSE_MARKER' }));
  });

  it('unterminated block → E_PARSE_MARKER', () => {
    const bad =
      '---\nschema_version: 1\nvideo_id: vd_8m2pq7rt\nstatus: draft\n---\n```sf-scene\nid: sc_p0q2m5ka\n';
    expect(() => parseStoryboard(bad)).toThrow(expect.objectContaining({ code: 'E_PARSE_MARKER' }));
  });
});

describe('block documents (CAST.md, STORY.md)', () => {
  it('CAST.md round-trips and exposes entries', () => {
    const cast = readFileSync(path.join(fixtureVideo, 'CAST.md'), 'utf8');
    const p = parseBlocksDoc(cast);
    expect(p.blocks.map((b) => b.tag)).toEqual(['sf-cast']);
    expect(p.blocks[0]!.data).toEqual([{ id: 'ca_a7f2k9wd', caption_color: '#ffcc00' }]);
    expect(serializeBlocksDoc(p)).toBe(cast);
  });

  it('changing a block re-renders only that block', () => {
    const story = readFileSync(path.join(fixtureVideo, 'STORY.md'), 'utf8');
    const p = parseBlocksDoc(story);
    (p.blocks[0]!.data as { title: string }).title = 'Đăng quang';
    const out = serializeBlocksDoc(p);
    expect(out).toContain('title: Đăng quang');
    expect(out).toContain('## Lên ngôi');
    expect(out.startsWith('---\nschema_version: 1\n')).toBe(true);
  });

  it('changing front matter re-renders only the front matter', () => {
    const brief = readFileSync(path.join(fixtureVideo, 'BRIEF.md'), 'utf8');
    const p = parseBlocksDoc(brief);
    (p.front as { approved_at: string | null }).approved_at = '2026-10-03T12:00:00+07:00';
    const out = serializeBlocksDoc(p);
    expect(out).toContain('approved_at: 2026-10-03T12:00:00+07:00');
    expect(out.slice(out.lastIndexOf('---'))).toBe(brief.slice(brief.lastIndexOf('---')));
  });
});
