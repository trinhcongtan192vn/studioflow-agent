// 002 · US1, US2 · FR-011, FR-012 (FR-WS-01, FR-WS-03).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createVideo,
  detectChannel,
  initChannel,
  validateArtifact,
  WriteStore,
} from '../../src/index.js';
import { fixtureChannel, tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));
function tmp(): string {
  const t = tempDir('kênh ');
  cleanups.push(t.cleanup);
  return t.dir;
}

describe('channel detection (002 US1)', () => {
  it('recognises a folder with a valid channel.json', () => {
    const r = detectChannel(fixtureChannel);
    expect(r).toMatchObject({ kind: 'channel', config: { id: 'ch_k3v9q2xa', name: 'Sử Việt' } });
  });

  it('an empty folder is not a channel and nothing is written', () => {
    const dir = tmp();
    expect(detectChannel(dir)).toEqual({ kind: 'not_channel' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a broken channel.json is reported with field path, not overwritten', () => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'channel.json'), '{"schema_version":1,"id":"bad"}');
    expect(() => detectChannel(dir)).toThrow(expect.objectContaining({ code: 'E_SCHEMA_INVALID' }));
    expect(readFileSync(path.join(dir, 'channel.json'), 'utf8')).toBe(
      '{"schema_version":1,"id":"bad"}',
    );
  });

  it('initialises a channel on request, keeping existing files', () => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'ghi-chú.txt'), 'giữ lại');
    const cfg = initChannel(dir, { name: 'Kênh thử', language: 'de' });
    expect(cfg.id).toMatch(/^ch_[0-9a-z]{8}$/);
    const r = detectChannel(dir);
    expect(r.kind).toBe('channel');
    for (const d of [
      'profile/.claude-plugin/plugin.json',
      'profile/skills/channel/SKILL.md',
      'videos',
      'assets',
      'voices',
      'music',
      'cache',
      'characters',
    ]) {
      expect(existsSync(path.join(dir, d)), d).toBe(true);
    }
    expect(readFileSync(path.join(dir, 'ghi-chú.txt'), 'utf8')).toBe('giữ lại');
    expect(
      validateArtifact('channel.json', readFileSync(path.join(dir, 'channel.json'), 'utf8')).valid,
    ).toBe(true);
  });

  it('refuses to re-initialise an existing channel', () => {
    const dir = tmp();
    initChannel(dir, { name: 'A', language: 'vi' });
    expect(() => initChannel(dir, { name: 'B', language: 'vi' })).toThrow();
  });
});

describe('video creation (002 US2)', () => {
  it('creates several videos with briefing state and unique IDs', () => {
    const dir = tmp();
    initChannel(dir, { name: 'K', language: 'vi' });
    const store = new WriteStore(dir);
    const ids = [
      createVideo(store, { title: 'Một' }),
      createVideo(store),
      createVideo(store, { title: 'Ba' }),
    ].map((v) => v.video_id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      const state = JSON.parse(readFileSync(path.join(dir, 'videos', id, 'state.json'), 'utf8'));
      expect(state).toMatchObject({
        video_id: id,
        phase: 'briefing',
        workflow: null,
        output_profile: null,
        owner: 'agent',
      });
      const brief = readFileSync(path.join(dir, 'videos', id, 'BRIEF.md'), 'utf8');
      expect(validateArtifact(`videos/${id}/BRIEF.md`, brief).valid).toBe(true);
      expect(brief).toContain(`video_id: ${id}`);
    }
    expect(readFileSync(path.join(dir, 'videos', ids[0]!, 'BRIEF.md'), 'utf8')).toContain(
      'title_working: Một',
    );
    expect(store.log().filter((e) => e.by === 'video.create')).toHaveLength(6);
  });
});
