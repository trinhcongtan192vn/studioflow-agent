// 053 · FR-AP-09 — metadata YouTube: giới hạn tiêu đề/mô tả/thẻ, chương, khai báo AI, hẹn giờ chỉ khi đã kiểm duyệt, SRT.
import { describe, expect, it } from 'vitest';
import type { CaptionGroups, CaptionOverrides } from '../../src/contracts/types.js';
import {
  buildVideoMetadata,
  captionsToSrt,
  chaptersBlock,
  clampTags,
  cutDescription,
  cutTitle,
} from '../../src/publish/youtube-meta.js';

describe('title / description / tags limits', () => {
  it('title: no < >, single spaces, ≤ 100 characters with an ellipsis', () => {
    expect(cutTitle('  Lê  Lợi <lên> ngôi  ')).toBe('Lê Lợi lên ngôi');
    const t = cutTitle('x'.repeat(150));
    expect([...t].length).toBe(100);
    expect(t.endsWith('…')).toBe(true);
    expect(cutTitle('Tiêu đề ngắn')).toBe('Tiêu đề ngắn');
  });
  it('description: ≤ 5000 bytes of UTF-8 without splitting a character', () => {
    const d = cutDescription('Đ'.repeat(4000));
    expect(Buffer.byteLength(d, 'utf8')).toBeLessThanOrEqual(5000);
    expect(d.includes('�')).toBe(false);
    expect(d.length).toBeGreaterThan(2000);
    expect(cutDescription('a <b> c')).toBe('a b c');
  });
  it('tags: deduplicated, ≤ 500 characters in total, order kept', () => {
    expect(clampTags(['lịch sử', 'Lịch Sử', '', ' Lê Lợi ', 'lịch sử'])).toEqual([
      'lịch sử',
      'Lê Lợi',
    ]);
    const many = Array.from({ length: 200 }, (_, i) => `tag-số-${i}`);
    const out = clampTags(many);
    expect(out.length).toBeLessThan(200);
    expect(out.join(',').length).toBeLessThanOrEqual(500);
    expect(out[0]).toBe('tag-số-0');
  });
});

describe('chaptersBlock', () => {
  const ch = (...ms: number[]) => ms.map((m, i) => ({ start_ms: m, title: `Chương ${i + 1}` }));
  it('needs ≥ 3 chapters, the first at 0:00, ≥ 10 s apart', () => {
    expect(chaptersBlock(ch(0, 30_000, 95_000), 'mô tả')).toBe(
      '0:00 Chương 1\n0:30 Chương 2\n1:35 Chương 3',
    );
    expect(chaptersBlock(ch(0, 30_000), 'x')).toBe('');
    expect(chaptersBlock(ch(5000, 30_000, 60_000), 'x')).toBe('');
    expect(chaptersBlock(ch(0, 5000, 60_000), 'x')).toBe('');
    expect(chaptersBlock(undefined, 'x')).toBe('');
  });
  it('hours format and an existing 0:00 list in the description are respected', () => {
    expect(chaptersBlock(ch(0, 60_000, 3_700_000), 'x')).toContain('1:01:40 Chương 3');
    expect(chaptersBlock(ch(0, 30_000, 60_000), 'Mục lục\n0:00 Mở đầu\n0:30 Giữa')).toBe('');
  });
});

describe('buildVideoMetadata', () => {
  const base = {
    title: 'Năm 1428: Lê Lợi lên ngôi',
    description: 'Mô tả video.',
    tags: ['lịch sử'],
    chapters: [
      { start_ms: 0, title: 'Mở đầu' },
      { start_ms: 30_000, title: 'Giữa' },
      { start_ms: 70_000, title: 'Kết' },
    ],
    language: 'vi',
  };
  const at = new Date('2026-10-08T12:00:00.000Z');
  it('not audited: private, never a publishAt, AI-generated and not-for-kids declarations, category 22', () => {
    const m = buildVideoMetadata({ ...base, audited: false, publishAt: at });
    expect(m.status).toEqual({
      privacyStatus: 'private',
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    });
    expect(m.snippet).toMatchObject({
      title: 'Năm 1428: Lê Lợi lên ngôi',
      tags: ['lịch sử'],
      categoryId: '22',
      defaultLanguage: 'vi',
      defaultAudioLanguage: 'vi',
    });
    expect(m.snippet.description).toBe('Mô tả video.\n\n0:00 Mở đầu\n0:30 Giữa\n1:10 Kết');
  });
  it('audited: private + publishAt in ISO UTC', () => {
    const m = buildVideoMetadata({ ...base, audited: true, publishAt: at });
    expect(m.status).toMatchObject({
      privacyStatus: 'private',
      publishAt: '2026-10-08T12:00:00.000Z',
    });
    expect(buildVideoMetadata({ ...base, audited: true }).status).not.toHaveProperty('publishAt');
  });
});

describe('captionsToSrt', () => {
  const groups = {
    schema_version: 1,
    video_id: 'vd_8m2pq7rt',
    style: 's',
    groups: [
      {
        id: 'cg_00000002',
        line_id: 'ln_b',
        word_range: [0, 1],
        text: 'Hai',
        start_ms: 3_661_005,
        end_ms: 3_662_000,
      },
      {
        id: 'cg_00000001',
        line_id: 'ln_a',
        word_range: [0, 1],
        text: ' Một ',
        start_ms: 0,
        end_ms: 1200,
      },
      {
        id: 'cg_00000003',
        line_id: 'ln_c',
        word_range: [0, 1],
        text: '',
        start_ms: 5000,
        end_ms: 6000,
      },
    ],
  } as unknown as CaptionGroups;
  it('numbered cues sorted by time, SRT timestamps, empty cues dropped', () => {
    expect(captionsToSrt(groups)).toBe(
      '1\n00:00:00,000 --> 00:00:01,200\nMột\n\n2\n01:01:01,005 --> 01:01:02,000\nHai\n',
    );
  });
  it('manual edits (time and text) of the caption panel win', () => {
    const o = {
      groups: { cg_00000001: { text: 'Một (sửa)', end_ms: 1500 } },
    } as unknown as CaptionOverrides;
    expect(captionsToSrt(groups, o)).toContain('00:00:00,000 --> 00:00:01,500\nMột (sửa)');
  });
  it('no groups → empty', () => {
    expect(captionsToSrt(undefined)).toBe('');
    expect(captionsToSrt({ ...groups, groups: [] })).toBe('');
  });
});
