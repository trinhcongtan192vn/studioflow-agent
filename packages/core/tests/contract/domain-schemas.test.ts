// 002 · US3 AC1–2 · FR-001, FR-005, FR-008 · SC-001 — mỗi artifact: mẫu hợp lệ + mẫu không hợp lệ.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { artifactKind, validateArtifact } from '../../src/index.js';
import { fixtureAppData, fixtureChannel, fixturesDir, fixtureVideo } from '../domain-helpers.js';

const samples: {
  rel: string;
  abs: string;
  kind: string;
  breakJson?: (o: any) => void;
  breakText?: (s: string) => string;
}[] = [
  {
    rel: 'channel.json',
    abs: path.join(fixtureChannel, 'channel.json'),
    kind: 'channel',
    breakJson: (o) => delete o.name,
  },
  {
    rel: 'settings.json',
    abs: path.join(fixtureAppData, 'settings.json'),
    kind: 'settings',
    breakJson: (o) => (o.trace.retention_days = '30'),
  },
  {
    rel: 'extensions/outputs/yt-1080p30/output.json',
    abs: path.join(fixturesDir, 'outputs/yt-1080p30/output.json'),
    kind: 'output_profile',
    breakJson: (o) => (o.video.codec = 'vp9'),
  },
  {
    rel: 'characters/ca_a7f2k9wd/cast.json',
    abs: path.join(fixtureChannel, 'characters/ca_a7f2k9wd/cast.json'),
    kind: 'cast_member',
    breakJson: (o) => (o.voice_id = 'voice-1'),
  },
  {
    rel: 'assets/manifest.json',
    abs: path.join(fixtureChannel, 'assets/manifest.json'),
    kind: 'asset_manifest',
    breakJson: (o) => (o.assets[0].kind = 'gif'),
  },
  {
    rel: 'videos/vd_8m2pq7rt/state.json',
    abs: path.join(fixtureVideo, 'state.json'),
    kind: 'state',
    breakJson: (o) => (o.phase = 'done'),
  },
  {
    rel: 'videos/vd_8m2pq7rt/audio_meta.json',
    abs: path.join(fixtureVideo, 'audio_meta.json'),
    kind: 'audio_meta',
    breakJson: (o) => delete o.lines[0].duration_ms,
  },
  {
    rel: 'videos/vd_8m2pq7rt/caption_groups.json',
    abs: path.join(fixtureVideo, 'caption_groups.json'),
    kind: 'caption_groups',
    breakJson: (o) => (o.groups[0].line_id = 'x'),
  },
  {
    rel: 'videos/vd_8m2pq7rt/caption-overrides.json',
    abs: path.join(fixtureVideo, 'caption-overrides.json'),
    kind: 'caption_overrides',
    breakJson: (o) => delete o.splits,
  },
  {
    rel: 'videos/vd_8m2pq7rt/lipsync/ln_9w3b6tqa.json',
    abs: path.join(fixtureVideo, 'lipsync/ln_9w3b6tqa.json'),
    kind: 'lipsync',
    breakJson: (o) => (o.cues[0].mouth = 'wide'),
  },
  {
    rel: 'videos/vd_8m2pq7rt/reviews/script/round-1.json',
    abs: path.join(fixtureVideo, 'reviews/script/round-1.json'),
    kind: 'review_round',
    breakJson: (o) => (o.issues[0].severity = 'huge'),
  },
  {
    rel: 'videos/vd_8m2pq7rt/provenance/cc0000000000.json',
    abs: path.join(fixtureVideo, 'provenance/cc0000000000.json'),
    kind: 'provenance',
    breakJson: (o) => delete o.cache_key,
  },
  {
    rel: 'videos/vd_8m2pq7rt/renders/rd_4k2m9q1z/render.json',
    abs: path.join(fixtureVideo, 'renders/rd_4k2m9q1z/render.json'),
    kind: 'render_record',
    breakJson: (o) => (o.status = 'ok'),
  },
  {
    rel: 'videos/vd_8m2pq7rt/BRIEF.md',
    abs: path.join(fixtureVideo, 'BRIEF.md'),
    kind: 'brief',
    breakText: (s) => s.replace('language: vi', 'language: fr'),
  },
  {
    rel: 'videos/vd_8m2pq7rt/frame.md',
    abs: path.join(fixtureVideo, 'frame.md'),
    kind: 'frame_md',
    breakText: (s) => s.replace(/generated_from: .*\n/, ''),
  },
  {
    rel: 'videos/vd_8m2pq7rt/STORY.md',
    abs: path.join(fixtureVideo, 'STORY.md'),
    kind: 'story',
    breakText: (s) => s.replace('setting: Điện Kính Thiên\n', ''),
  },
  {
    rel: 'videos/vd_8m2pq7rt/SCRIPT.md',
    abs: path.join(fixtureVideo, 'SCRIPT.md'),
    kind: 'script',
    breakText: (s) => s.replace('speaker=narrator emotion', 'speaker=bob emotion'),
  },
  {
    rel: 'videos/vd_8m2pq7rt/STORYBOARD.md',
    abs: path.join(fixtureVideo, 'STORYBOARD.md'),
    kind: 'storyboard',
    breakText: (s) => s.replace('kind: text', 'kind: video'),
  },
  {
    rel: 'videos/vd_8m2pq7rt/CAST.md',
    abs: path.join(fixtureVideo, 'CAST.md'),
    kind: 'cast',
    breakText: (s) => s.replace('ca_a7f2k9wd', 'ca_bad'),
  },
  {
    rel: 'videos/vd_8m2pq7rt/publish.md',
    abs: path.join(fixtureVideo, 'publish.md'),
    kind: 'publish',
    breakText: (s) => s.replace('status: draft', 'status: live'),
  },
  {
    // 049: quét nghiên cứu Autopilot ở gốc kênh (D3 5.17)
    rel: 'research/2026-10-07.json',
    abs: path.join(fixturesDir, '..', 'research', 'research-doc.json'),
    kind: 'research',
    breakJson: (o) => (o.candidates[0].score = 120),
  },
  {
    // 051: kế hoạch ngày Autopilot ở gốc kênh (D3 5.18)
    rel: 'autopilot/plans/2026-10-07.json',
    abs: path.join(fixturesDir, '..', 'plan', 'daily-plan.json'),
    kind: 'plan',
    breakJson: (o) => (o.items[0].status = 'running'),
  },
];

describe('artifact schemas (002 SC-001)', () => {
  it('covers every artifact kind', () => {
    expect(new Set(samples.map((s) => s.kind)).size).toBe(samples.length);
  });

  for (const s of samples) {
    describe(s.kind, () => {
      const text = readFileSync(s.abs, 'utf8');

      it('maps path to kind', () => {
        expect(artifactKind(s.rel)).toBe(s.kind);
      });

      it('valid sample passes', () => {
        const r = validateArtifact(s.rel, text);
        expect(r.errors).toEqual([]);
        expect(r.valid).toBe(true);
      });

      it('invalid sample fails with a field path', () => {
        let bad: string;
        if (s.breakJson) {
          const o = JSON.parse(text);
          s.breakJson(o);
          bad = JSON.stringify(o);
        } else {
          bad = s.breakText!(text);
          expect(bad).not.toBe(text);
        }
        const r = validateArtifact(s.rel, bad);
        expect(r.valid).toBe(false);
        expect(r.errors[0]).toMatchObject({ code: 'E_SCHEMA_INVALID', path: expect.any(String) });
      });
    });
  }

  it('unknown paths have no kind', () => {
    expect(artifactKind('videos/vd_8m2pq7rt/notes.txt')).toBeUndefined();
  });

  it('missing schema_version is invalid', () => {
    const r = validateArtifact(
      'channel.json',
      JSON.stringify({
        id: 'ch_k3v9q2xa',
        name: 'x',
        language: 'vi',
        created_at: 'x',
        profile_dir: 'profile',
        config: {},
      }),
    );
    expect(r.valid).toBe(false);
  });

  it('broken JSON → E_SCHEMA_INVALID', () => {
    const r = validateArtifact('channel.json', '{nope');
    expect(r.errors[0]!.code).toBe('E_SCHEMA_INVALID');
  });
});
