// 085 · FR-WF-85-03 — bước `music` do engine chọn nhạc (không phiên agent).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WriteStore, type MusicTrack, type StepRunContext } from '../../src/index.js';
import { musicExecutor } from '../../src/workflow/music-step.js';
import { copyChannel, fixtureVideoId, tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const track = (id: string, tags: string[], ms: number): MusicTrack =>
  ({
    id,
    kind: 'music',
    file: `files/${id}.wav`,
    original_name: `${id}.wav`,
    hash: id.padEnd(64, '0'),
    tags,
    analysis: {
      duration_ms: ms,
      sample_rate: 48000,
      channels: 2,
      energy: 0.5,
      energy_curve: [],
      loudness_lufs: -16,
      silence_head_ms: 0,
      silence_tail_ms: 0,
    },
    added_at: '2026-10-04T00:00:00Z',
    used_in: [],
  }) as unknown as MusicTrack;

function setup(appTracks: MusicTrack[]) {
  const c = copyChannel();
  const a = tempDir('app-');
  cleanups.push(c.cleanup, a.cleanup);
  mkdirSync(path.join(a.dir, 'music'), { recursive: true });
  writeFileSync(
    path.join(a.dir, 'music', 'manifest.json'),
    JSON.stringify({ schema_version: 1, tracks: appTracks }),
  );
  const store = new WriteStore(c.dir);
  const ctx = {
    store,
    channelDir: c.dir,
    videoId: fixtureVideoId,
    step: { id: 'music', uses: 'music', title: 'Nhạc nền' },
    signal: new AbortController().signal,
    appDataDir: a.dir,
  } as unknown as StepRunContext;
  const sb = () => readFileSync(store.abs(`videos/${fixtureVideoId}/STORYBOARD.md`), 'utf8');
  return { ctx, sb, appDataDir: a.dir };
}

describe('music step (085)', () => {
  it('picks a library track for the scene query; keeps the query and volume', async () => {
    // bài ngắn hơn audio vẫn được chọn khi không bài nào đủ dài (thử lại không lọc thời lượng)
    const s = setup([
      track('mt_aaaaaaaa', ['trang nghiêm', 'đàn tranh'], 5000),
      track('mt_bbbbbbbb', ['vui'], 5000),
    ]);
    const out = await musicExecutor({ appDataDir: s.appDataDir })(s.ctx);
    expect(out.outputs).toEqual(['STORYBOARD.md']);
    expect(out.summary).toMatch(/Đã chọn nhạc/);
    expect(s.sb()).toMatch(
      /music: \{ query: "trang nghiêm, chậm, đàn tranh", volume_db: -18, track_id: mt_aaaaaaaa \}/,
    );
  });

  it('empty library → music: none, the step still completes', async () => {
    const s = setup([]);
    const out = await musicExecutor({ appDataDir: s.appDataDir })(s.ctx);
    expect(out.summary).toMatch(/không có nhạc nền/);
    expect(s.sb()).toMatch(/^music: none$/m);
  });
});
