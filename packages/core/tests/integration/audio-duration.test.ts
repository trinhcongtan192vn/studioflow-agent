// 016 R4 — thời lượng đo trên audio thật, không ước từ số từ/phút (D6 mục 4.2 `audio_duration`).
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { audioDurationCheck, beatDurations, configKeySpec, WriteStore } from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function setup(targetMs: number, lines: [string, number][]) {
  const c = copyChannel();
  cleanups.push(c.cleanup);
  const store = new WriteStore(c.dir);
  const v = `videos/${fixtureVideoId}`;
  const brief = store.abs(`${v}/BRIEF.md`);
  writeFileSync(
    brief,
    readFileSync(brief, 'utf8').replace(
      /target_duration_ms: \d+/,
      `target_duration_ms: ${targetMs}`,
    ),
  );
  const metaF = store.abs(`${v}/audio_meta.json`);
  const meta = JSON.parse(readFileSync(metaF, 'utf8'));
  const proto = meta.lines[0];
  let t = 0;
  meta.lines = lines.map(([id, ms]) => {
    const l = { ...proto, line_id: id, start_ms: t, duration_ms: ms };
    t += ms;
    return l;
  });
  meta.total_duration_ms = t;
  writeFileSync(metaF, JSON.stringify(meta));
  return store;
}

const LINES: [string, number][] = [
  ['ln_2r7c4kxm', 2400],
  ['ln_9w3b6tqa', 3000],
  ['ln_5h8q2m3x', 4600],
];

describe('audio_duration (016 R4)', () => {
  it('passes when real audio is within check.duration_tolerance of the target', () => {
    const store = setup(10_000, LINES);
    expect(audioDurationCheck(store, fixtureVideoId, fixtureAppData)).toEqual({ pass: true });
  });

  it('fails with real per-beat durations so the agent fixes the scene that is off', () => {
    const store = setup(20_000, LINES);
    const r = audioDurationCheck(store, fixtureVideoId, fixtureAppData);
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('10 s');
    expect(r.detail).toContain('20 s');
    expect(r.detail).toContain('Mở đầu');
    expect(r.detail).toContain('Kết');
  });

  it('beat durations come from audio_meta (lines + pause_after_ms), not word counts', () => {
    const store = setup(10_000, LINES);
    const b = beatDurations(store, fixtureVideoId);
    expect(b.map((x) => x.title)).toEqual(['Mở đầu', 'Kết']);
    expect(b[0]).toMatchObject({ start_ms: 0, duration_ms: 2400 + 300 + 3000 });
    expect(b[1]).toMatchObject({ start_ms: 5700, duration_ms: 4600 });
  });

  it('missing audio fails; no target passes with a note', () => {
    const store = setup(10_000, LINES);
    const v = `videos/${fixtureVideoId}`;
    const brief = store.abs(`${v}/BRIEF.md`);
    writeFileSync(
      brief,
      readFileSync(brief, 'utf8').replace(/target_duration_ms: \d+/, 'target_duration_ms: null'),
    );
    expect(audioDurationCheck(store, fixtureVideoId, fixtureAppData)).toMatchObject({
      pass: true,
      detail: expect.stringContaining('no target'),
    });
    rmSync(store.abs(`${v}/audio_meta.json`));
    expect(audioDurationCheck(store, fixtureVideoId, fixtureAppData).pass).toBe(false);
  });

  it('no reading-rate config key exists', () => {
    expect(configKeySpec('script.wpm.vi')).toBeUndefined();
    expect(configKeySpec('check.length_tolerance')).toBeUndefined();
  });
});
