// 009 · US3 · FR-004, FR-005 — gói prompt (D6 6.2) và rubric (D6 4.3).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPrompt,
  estimateTokens,
  loadPromptPack,
  loadRubric,
  rubricShort,
} from '../../src/index.js';
import { copyChannel, fixtureChannel } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));
const vars = {
  brief: 'Chủ đề: bầu trời',
  target_duration: '45 giây',
  language: 'vi',
  rubric_short: 'hook; clarity',
  issues: '',
  draft: '',
};

describe('prompt pack (009 US3)', () => {
  it('falls back to the app default pack and fills variables + includes', () => {
    const pack = loadPromptPack(fixtureChannel);
    expect(pack.source).toBe('app');
    const p = buildPrompt(pack, 'script', vars, { channelDir: fixtureChannel });
    expect(p.text).toContain('Chủ đề: bầu trời');
    expect(p.text).toContain('khoảng 45 giây');
    expect(p.text).toContain('## Giọng văn'); // include common/voice.md
    expect(p.text).toContain('Ngôn ngữ video: vi');
    expect(p.text).not.toMatch(/\{\{/);
    expect(p.summarized).toBe(false);
  });

  it('resolves {{config:key}} through the config tiers', () => {
    const pack = loadPromptPack(fixtureChannel);
    const p = buildPrompt(pack, 'description', vars, { channelDir: fixtureChannel });
    expect(p.text).toContain('≤ 100 ký tự');
  });

  it('uses the channel pack when present, swaps summaries over the cap, then E_PROMPT_TOO_LONG', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const dir = path.join(c.dir, 'profile', 'references', 'prompts');
    mkdirSync(path.join(dir, 'common'), { recursive: true });
    writeFileSync(path.join(dir, 'script.md'), 'Viết: {{brief}}');
    writeFileSync(path.join(dir, 'common', 'long.md'), 'x'.repeat(3000));
    writeFileSync(path.join(dir, 'common', 'long.summary.md'), 'ngắn');
    writeFileSync(
      path.join(dir, 'pack.yaml'),
      'schema_version: 1\nsteps:\n  script: { template: script.md, include: [common/long.md], token_cap: 200 }\n  tiny: { template: script.md, include: [], token_cap: 1 }\nsummaries: { common/long.md: common/long.summary.md }\n',
    );
    const pack = loadPromptPack(c.dir);
    expect(pack.source).toBe('channel');
    const p = buildPrompt(pack, 'script', vars, { channelDir: c.dir });
    expect(p.summarized).toBe(true);
    expect(p.text).toContain('ngắn');
    expect(p.tokens).toBeLessThanOrEqual(200);
    expect(() => buildPrompt(pack, 'tiny', vars, { channelDir: c.dir })).toThrow(
      expect.objectContaining({ code: 'E_PROMPT_TOO_LONG' }),
    );
  });

  it('037: the cap covers the pack (template + includes), not the video data filled in', () => {
    const pack = loadPromptPack(fixtureChannel);
    // kịch bản phim 3 phút ~ 3 000 token: không làm hỏng bước tiêu đề/mô tả
    const p = buildPrompt(
      pack,
      'description',
      { ...vars, draft: 'câu thoại '.repeat(3000) },
      {
        channelDir: fixtureChannel,
      },
    );
    expect(p.tokens).toBeGreaterThan(2000);
    expect(p.text).toContain('câu thoại');
  });

  it('estimates tokens from characters', () => {
    expect(estimateTokens('abcdef')).toBe(2);
  });
});

describe('rubrics (009 FR-005)', () => {
  it('loads the app default, channel override wins, weights must sum to 1', () => {
    const r = loadRubric('script-default', { channelDir: fixtureChannel });
    expect(r).toMatchObject({ id: 'script-default', scale: 10 });
    expect(rubricShort(r)).toContain('hook: 30 giây đầu');
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const dir = path.join(c.dir, 'profile', 'references', 'rubrics');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'script-default.yaml'),
      'id: script-default\nversion: 2\nscale: 10\ncriteria:\n  - { id: a, weight: 0.5, prompt: A }\n  - { id: b, weight: 0.4, prompt: B }\nseverity_rules: x\n',
    );
    expect(() => loadRubric('script-default', { channelDir: c.dir })).toThrow(
      expect.objectContaining({ code: 'E_SCHEMA_INVALID' }),
    );
    writeFileSync(
      path.join(dir, 'script-default.yaml'),
      'id: script-default\nversion: 2\nscale: 10\ncriteria:\n  - { id: a, weight: 0.5, prompt: A }\n  - { id: b, weight: 0.5, prompt: B }\nseverity_rules: x\n',
    );
    expect(loadRubric('script-default', { channelDir: c.dir }).version).toBe(2);
    expect(() => loadRubric('nope', { channelDir: c.dir })).toThrow(
      expect.objectContaining({ code: 'E_ID_UNKNOWN' }),
    );
  });
});
