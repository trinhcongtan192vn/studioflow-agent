// STORY.md do model viết: beat có dấu ": " không đặt trong ngoặc (YAML đọc thành map) được ghép lại thành chuỗi
// trước khi kiểm schema (vd_ojl8icgh, 2026-10-10).
import { expect, it } from 'vitest';
import { repairStoryBlocks } from '../../src/text/executors.js';
import { validateArtifact } from '../../src/index.js';

const story = (beats: string) =>
  [
    '---',
    'schema_version: 1',
    'video_id: vd_aaaaaaaa',
    'status: draft',
    '---',
    '## The ball test',
    '```sf-story',
    'title: The ball test',
    'summary: Grandpa drops two balls.',
    'characters:',
    '  - maya',
    'setting: A grassy hill',
    'beats:',
    beats,
    '```',
    '',
  ].join('\n');

it('beats with an unquoted colon become strings again', () => {
  const bad = story(
    [
      '  - Grandpa drops a small blue ball.',
      '  - Maya cheers: "So blue is lighter, that\'s why it flies!"',
      '  - He drops the balls again: "The blue light gets knocked around."',
    ].join('\n'),
  );
  expect(validateArtifact('videos/vd_aaaaaaaa/STORY.md', bad).valid).toBe(false);
  const fixed = repairStoryBlocks(bad);
  expect(validateArtifact('videos/vd_aaaaaaaa/STORY.md', fixed)).toMatchObject({ valid: true });
  expect(fixed).toContain("Maya cheers: So blue is lighter, that's why it flies!");
  // khối đúng sẵn giữ nguyên từng ký tự
  const good = story('  - Grandpa drops a small blue ball.');
  expect(repairStoryBlocks(good)).toBe(good);
});
