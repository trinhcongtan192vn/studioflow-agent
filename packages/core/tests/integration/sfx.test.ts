// Hiệu ứng âm thanh (2026-10-10): đạo diễn ghi kế hoạch SFX → bước media tìm âm trong kho SFX (kênh + app) →
// frame.sfx; index.html đặt âm ở đầu frame + at_ms với âm lượng theo giọng đọc.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { afterEach, expect, it } from 'vitest';
import { buildIndexHtml } from '../../src/hf/index-html.js';
import { resolveSfx } from '../../src/music/sfx-resolve.js';
import { sfxSeconds, stableAudioWorkflow } from '../../src/music/sfx-generate.js';
import { WriteStore } from '../../src/index.js';
import { planToStoryboard, type DirectPlan } from '../../src/workflow/direct.js';
import { copyChannel, fixtureVideoId, tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const line = (id: string) => ({
  id,
  beat_id: 'bt_aaaaaaaa',
  beat: 'B',
  text: 't',
  speaker: 'narrator',
  ms: 3000,
});

it('the director plans sound effects on a shot (not on the continuation of a long shot)', () => {
  const plan: DirectPlan = {
    scenes: [
      {
        title: 'S',
        shots: [
          {
            line_ids: ['ln_aaaaaaa1'],
            layout: 'big-text',
            text: { main: 'Gió' },
            sfx: [
              { sound: 'a dog barking twice in the distance', at: 0.5, volume: 'loud' },
              { sound: '', at: 1 },
            ],
          },
        ],
      },
    ],
  };
  const shot = plan.scenes[0]!.shots[0]!;
  const md = planToStoryboard(
    'vd_aaaaaaaa',
    plan,
    [
      { scene: 0, shot, lines: [line('ln_aaaaaaa1')], continuation: false },
      { scene: 0, shot, lines: [line('ln_aaaaaaa2')], continuation: true },
    ],
    {
      aspect: '16:9',
      libraryIds: new Set(),
      music: false,
      heroAllowed: false,
      castRefs: {},
      lipsync: {},
    },
  );
  const frames = [...md.matchAll(/```sf-frame\n([\s\S]*?)\n```/g)].map(
    (m) => parse(m[1]!) as { config?: { sfx_plan?: unknown[] } },
  );
  expect(frames[0]!.config?.sfx_plan).toEqual([
    { query: 'a dog barking twice in the distance', at_ms: 500, volume_db: -6 },
  ]);
  expect(frames[1]!.config).toBeUndefined();
});

it('planned sound effects are matched in the SFX library; unknown sounds are reported missing', async () => {
  const c = copyChannel();
  const app = tempDir('sfx-app-');
  cleanups.push(c.cleanup, app.cleanup);
  const store = new WriteStore(c.dir);
  // kho SFX của kênh: một tiếng chó sủa
  mkdirSync(path.join(c.dir, 'music', 'files'), { recursive: true });
  writeFileSync(path.join(c.dir, 'music', 'files', 'mt_dog00001.wav'), 'x');
  writeFileSync(
    path.join(c.dir, 'music', 'manifest.json'),
    JSON.stringify({
      schema_version: 1,
      tracks: [
        {
          id: 'mt_dog00001',
          kind: 'sfx',
          file: 'files/mt_dog00001.wav',
          original_name: 'dog_bark.wav',
          hash: '0'.repeat(64),
          tags: ['dog', 'bark', 'barking', 'animal'],
          description: 'dog barking twice',
          analysis: {
            duration_ms: 1800,
            sample_rate: 48000,
            channels: 1,
            energy: 0.5,
            energy_curve: [0.5, 0.4],
            loudness_lufs: -18,
            silence_head_ms: 0,
            silence_tail_ms: 0,
          },
          added_at: '2026-10-10T00:00:00Z',
          used_in: [],
        },
      ],
    }),
  );
  const sbFile = store.abs(`videos/${fixtureVideoId}/STORYBOARD.md`);
  // frame đầu của fixture đã có `config` → thêm kế hoạch SFX vào đó
  writeFileSync(
    sbFile,
    readFileSync(sbFile, 'utf8').replace(
      'config: { look.id: frame-look }',
      'config: { look.id: frame-look, sfx_plan: [{ query: "dog barking", at_ms: 500, volume_db: -12 }, { query: "thunder rumbling", at_ms: 0, volume_db: -12 }] }',
    ),
  );
  const r = await resolveSfx({ store, appDataDir: app.dir }, fixtureVideoId);
  expect(r).toMatchObject({ placed: 1, missing: ['thunder rumbling'] });
  expect(readFileSync(sbFile, 'utf8')).toMatch(
    /sfx:\s*\n\s*- track_id: mt_dog00001\s*\n\s*at_ms: 500/,
  );
});

it('index.html places each sound at its absolute time with a linear volume', () => {
  const html = buildIndexHtml({
    width: 1920,
    height: 1080,
    frames: [{ id: 'fr_aaaaaaaa', start_ms: 0, duration_ms: 4000 }],
    voices: [],
    captions: false,
    total_ms: 4000,
    sfx: [
      {
        track_id: 'mt_dog00001',
        file: 'public/sfx/mt_dog00001.wav',
        start_ms: 2500,
        duration_ms: 1500,
        volume: 0.355,
      },
    ],
  });
  expect(html).toContain(
    '<audio id="el-sfx-1" data-sf-sfx="mt_dog00001" src="public/sfx/mt_dog00001.wav" data-start="2.5" data-duration="1.5" data-track-index="12" data-volume="0.355"></audio>',
  );
});

it('a sound missing from the library is generated once and placed; the Stable Audio workflow is complete', async () => {
  const c = copyChannel();
  const app = tempDir('sfx-gen-');
  cleanups.push(c.cleanup, app.cleanup);
  const store = new WriteStore(c.dir);
  const sbFile = store.abs(`videos/${fixtureVideoId}/STORYBOARD.md`);
  writeFileSync(
    sbFile,
    readFileSync(sbFile, 'utf8').replace(
      'config: { look.id: frame-look }',
      'config: { look.id: frame-look, sfx_plan: [{ query: "wind howling", at_ms: 0, volume_db: -18 }, { query: "wind howling", at_ms: 2000, volume_db: -18 }] }',
    ),
  );
  const asked: string[] = [];
  const r = await resolveSfx(
    {
      store,
      appDataDir: app.dir,
      generate: async (q) => {
        asked.push(q);
        return 'mt_wind0001';
      },
    },
    fixtureVideoId,
  );
  expect(asked).toEqual(['wind howling']);
  expect(r).toMatchObject({ placed: 2, generated: 1, missing: [] });
  expect(sfxSeconds('wind howling')).toBe(8);
  expect(sfxSeconds('a door slamming')).toBe(4);
  const wf = stableAudioWorkflow('wind howling', 8, 1) as Record<string, { class_type: string }>;
  expect(Object.values(wf).map((n) => n.class_type)).toEqual([
    'CheckpointLoaderSimple',
    'CLIPLoader',
    'CLIPTextEncode',
    'CLIPTextEncode',
    'EmptyLatentAudio',
    'KSampler',
    'VAEDecodeAudio',
    'SaveAudio',
  ]);
});
