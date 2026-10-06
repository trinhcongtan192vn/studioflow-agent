// 029 · FR-WF-07 — tầng cấu hình workflow (`config_defaults`), khoảng lặng mặc định, kiểu caption.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCaptionsHtml, loadPack, withDefaultPause } from '../../src/index.js';

const ESSAY = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'extensions',
  'workflows',
  'essay-audiobook',
);

describe('workflow config tier (029)', () => {
  it('validates config_defaults: known key, channel/video tier, type', () => {
    expect(loadPack(ESSAY).errors).toEqual([]);
    const d = mkdtempSync(path.join(os.tmpdir(), 'wf-'));
    try {
      cpSync(ESSAY, d, { recursive: true });
      const f = path.join(d, 'workflow.yaml');
      writeFileSync(
        f,
        readFileSync(f, 'utf8').replace(
          'caption.max_words: 10',
          "caption.max_words: '10'\n  no.such.key: 1\n  frame_build.parallel: 2",
        ),
      );
      expect(
        loadPack(d)
          .errors.map((e) => e.code)
          .sort(),
      ).toEqual(['E_CONFIG_SCOPE', 'E_CONFIG_UNKNOWN_KEY', 'E_SCHEMA_INVALID']);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('applies the default pause only to lines without pause_after_ms', () => {
    const lines = [{ id: 'a' }, { id: 'b', pause_after_ms: 0 }, { id: 'c', pause_after_ms: 200 }];
    expect(withDefaultPause(lines, () => 600).map((l) => l.pause_after_ms)).toEqual([600, 0, 200]);
    expect(withDefaultPause(lines, () => 0)).toBe(lines);
  });

  it('caption styles: static has no word highlight, karaoke is large and centred', () => {
    const groups = [
      {
        id: 'cg_aaaaaaaa',
        line_id: 'ln_aaaaaaaa',
        word_range: [0, 1] as [number, number],
        text: 'Xin chào',
        start_ms: 0,
        end_ms: 900,
        abs_start_ms: 0,
        abs_end_ms: 900,
        words: [
          { text: 'Xin', start_ms: 0 },
          { text: 'chào', start_ms: 400 },
        ],
      },
    ] as never;
    const hi = buildCaptionsHtml({ width: 1920, height: 1080, groups });
    expect(hi).toMatch(/tl\.set\("#cap-cg_aaaaaaaa-1"/);
    const st = buildCaptionsHtml({ width: 1920, height: 1080, groups, style: 'caption-static' });
    expect(st).not.toMatch(/tl\.set\("#cap-/);
    const k = buildCaptionsHtml({
      width: 1080,
      height: 1920,
      groups,
      style: 'caption-pill-karaoke',
    });
    expect(k).toMatch(/tl\.set\("#cap-cg_aaaaaaaa-1"/);
    expect(k).toContain('top: 1114px; transform: translateY(-50%);');
    expect(k).toContain('font-size: 81px');
  });
});

describe('short-film defaults (039)', () => {
  it('turns lip-sync on by default (workflow tier; channel/video can turn it off)', () => {
    const p = loadPack(path.join(ESSAY, '..', 'short-film'));
    expect(p.errors).toEqual([]);
    expect(p.manifest.config_defaults).toMatchObject({ 'lipsync.enabled': true });
  });
});
