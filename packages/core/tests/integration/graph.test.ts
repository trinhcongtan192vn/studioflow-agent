// 004 · US3 · FR-013..017 · SC-001 (FR-VO-04).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateArtifact } from '../../src/index.js';
import { fixtureVideoId } from '../domain-helpers.js';
import { graphFixture, V } from '../graph-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));
function fx(opts?: Parameters<typeof graphFixture>[0]) {
  const f = graphFixture(opts);
  cleanups.push(f.cleanup);
  return f;
}
const ALL = [
  'audio.line:ln_2r7c4kxm',
  'audio.line:ln_9w3b6tqa',
  'audio.line:ln_5h8q2m3x',
  'asr.line:ln_2r7c4kxm',
  'asr.line:ln_9w3b6tqa',
  'asr.line:ln_5h8q2m3x',
  'audio_meta',
  'captions',
  'frame_timing',
  'index',
];
function editScript(dir: string, fn: (s: string) => string) {
  const p = path.join(dir, V, 'SCRIPT.md');
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
}

describe('build graph (004 US3)', () => {
  it('unbuilt video: every node missing; plan ordered by phase', () => {
    const { graph } = fx();
    const st = graph.nodeStates(fixtureVideoId);
    expect(st.map((n) => n.id).sort()).toEqual([...ALL].sort());
    expect(new Set(st.map((n) => n.status))).toEqual(new Set(['missing']));
    const plan = graph.planNodes(fixtureVideoId);
    expect(plan.jobs.map((j) => j.phase)).toEqual([
      'tts',
      'tts',
      'tts',
      'asr',
      'asr',
      'asr',
      'assemble',
      'assemble',
      'assemble',
      'assemble',
    ]);
    expect(plan.jobs.map((j) => j.node).slice(6)).toEqual([
      'audio_meta',
      'captions',
      'frame_timing',
      'index',
    ]);
    expect(plan.estimate).toEqual({ seconds: null, cost_usd: 0 });
  });

  it('build makes every node fresh and writes graph.json + audio_meta.json', async () => {
    const { graph, dir } = fx();
    const r = await graph.build(fixtureVideoId);
    expect(r.status).toBe('succeeded');
    expect(graph.nodeStates(fixtureVideoId).every((n) => n.status === 'fresh')).toBe(true);
    const g = JSON.parse(readFileSync(path.join(dir, V, '.sf/graph.json'), 'utf8'));
    expect(g.nodes['audio_meta']).toMatchObject({
      key: '',
      type: 'audio_meta',
      status: 'fresh',
      input_hash: expect.any(String),
      output_hash: expect.any(String),
      updated_at: expect.any(String),
    });
    const meta = readFileSync(path.join(dir, V, 'audio_meta.json'), 'utf8');
    expect(validateArtifact(`${V}/audio_meta.json`, meta).errors).toEqual([]);
    expect(graph.planNodes(fixtureVideoId).jobs).toEqual([]);
  });

  it('editing one line text plans exactly the six affected nodes (SC-001)', async () => {
    const { graph, dir, calls } = fx();
    await graph.build(fixtureVideoId);
    editScript(dir, (s) => s.replace('Bệ hạ…', 'Tâu bệ hạ…'));
    const stale = graph
      .nodeStates(fixtureVideoId)
      .filter((n) => n.status !== 'fresh')
      .map((n) => n.id);
    expect(stale.sort()).toEqual(
      [
        'asr.line:ln_9w3b6tqa',
        'audio.line:ln_9w3b6tqa',
        'audio_meta',
        'captions',
        'frame_timing',
        'index',
      ].sort(),
    );
    expect(graph.planNodes(fixtureVideoId).jobs.map((j) => j.node)).toEqual([
      'audio.line:ln_9w3b6tqa',
      'asr.line:ln_9w3b6tqa',
      'audio_meta',
      'captions',
      'frame_timing',
      'index',
    ]);
    calls.length = 0;
    await graph.build(fixtureVideoId);
    expect(calls).toEqual(['audio.line:ln_9w3b6tqa', 'asr.line:ln_9w3b6tqa', 'captions', 'index']);
    expect(graph.nodeStates(fixtureVideoId).every((n) => n.status === 'fresh')).toBe(true);
  });

  it('changing pause_after_ms does not regenerate audio', async () => {
    const { graph, dir } = fx();
    await graph.build(fixtureVideoId);
    editScript(dir, (s) => s.replace('pause_after_ms=300', 'pause_after_ms=800'));
    const plan = graph.planNodes(fixtureVideoId).jobs.map((j) => j.node);
    expect(plan).toEqual(['audio_meta', 'captions', 'frame_timing', 'index']);
  });

  it('a failing builder marks the node failed, skips dependents, build is partial', async () => {
    const { graph } = fx({ failAudio: 'ln_9w3b6tqa' });
    const r = await graph.build(fixtureVideoId);
    expect(r.status).toBe('partial');
    expect(r.nodes['audio.line:ln_9w3b6tqa']).toMatchObject({
      status: 'failed',
      error: { message: 'tts crashed' },
    });
    expect(r.nodes['audio_meta']!.status).toBe('skipped');
    const st = Object.fromEntries(graph.nodeStates(fixtureVideoId).map((n) => [n.id, n.status]));
    expect(st['audio.line:ln_9w3b6tqa']).toBe('failed');
    expect(st['audio.line:ln_2r7c4kxm']).toBe('fresh');
    expect(st['audio_meta']).toBe('missing');
  });

  it('node types without a builder are inactive (not planned, not dependencies)', async () => {
    const { graph, dir } = fx({ withAsr: false });
    expect(graph.nodeStates(fixtureVideoId).some((n) => n.type === 'asr.line')).toBe(false);
    const r = await graph.build(fixtureVideoId);
    expect(r.status).toBe('succeeded');
    const meta = JSON.parse(readFileSync(path.join(dir, V, 'audio_meta.json'), 'utf8'));
    expect(meta.lines[0].words).toEqual([]);
  });

  it('a corrupt graph.json is treated as unbuilt', async () => {
    const { graph, store } = fx();
    store.write(`${V}/.sf/graph.json`, '{nope', { by: 'test' });
    expect(graph.nodeStates(fixtureVideoId).every((n) => n.status === 'missing')).toBe(true);
  });

  it('estimates seconds from history after a build', async () => {
    const { graph, dir } = fx();
    await graph.build(fixtureVideoId);
    editScript(dir, (s) => s.replace('Bệ hạ…', 'Bệ hạ!'));
    expect(graph.planNodes(fixtureVideoId).estimate.seconds).toEqual(expect.any(Number));
  });
});

describe('graph.status / graph.plan follow D4 3.1 (004 fix)', () => {
  it('NodeStatus and PlannedJob/PlanEstimate shapes', async () => {
    const { graph } = fx();
    const st = graph.status(fixtureVideoId);
    expect(st[0]).toEqual({ key: 'audio.line:ln_2r7c4kxm', type: 'audio.line', status: 'missing' });
    const plan = graph.plan(fixtureVideoId);
    expect(plan.jobs[0]).toEqual({
      kind: 'audio.line',
      targets: ['audio.line:ln_2r7c4kxm'],
      phase: 0,
      est_ms: 0,
      est_cost_usd: 0,
      from_cache: false,
    });
    expect(plan.estimate).toEqual({
      total_ms: 0,
      total_cost_usd: 0,
      jobs_count: 10,
      cached_count: 0,
    });
    await graph.build(fixtureVideoId);
    expect(graph.plan(fixtureVideoId).estimate.jobs_count).toBe(0);
  });
});
