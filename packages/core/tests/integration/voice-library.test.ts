// 035 · SC-001/SC-003 (FR-VO-07) — agent thấy giọng/nhân vật có sẵn của kênh để dùng lại.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { speakersWithoutVoice } from '../../src/workflow/cast.js';
import { workflowFixture, type WorkflowFixture } from '../workflow-helpers.js';

let fx: WorkflowFixture;
afterEach(() => fx?.cleanup());

const data = <T>(r: unknown) => (r as { ok: boolean; data: T }).data;

it('voice.list and cast.list expose the channel library with usage (SC-001)', async () => {
  fx = workflowFixture();
  // giọng gợi ý chưa ai dùng
  const vo = path.join(fx.dir, 'voices', 'vo_n0pzxyom');
  mkdirSync(vo, { recursive: true });
  writeFileSync(path.join(vo, 'voice.pt'), 'x');
  writeFileSync(
    path.join(vo, 'profile.json'),
    JSON.stringify({
      voice_id: 'vo_n0pzxyom',
      name: 'Bác nam trung niên, to khỏe',
      language: 'vi',
      created_at: '2026-10-05T18:56:54.042Z',
      design: { instruct: 'male, middle-aged, low pitch', seed: 505 },
      suggested_for: 'ca_19qgui0a',
    }),
  );
  // giọng của kênh mẫu (người dẫn + ca_a7f2k9wd)
  const base = path.join(fx.dir, 'voices', 'vo_c3z8p1mn');
  mkdirSync(base, { recursive: true });
  writeFileSync(path.join(base, 'voice.pt'), 'x');
  writeFileSync(
    path.join(base, 'profile.json'),
    JSON.stringify({
      voice_id: 'vo_c3z8p1mn',
      name: 'Giọng kênh',
      language: 'vi',
      created_at: '2026-10-03T00:00:00Z',
    }),
  );
  const v = data<{
    narrator_voice_id: string;
    voices: {
      voice_id: string;
      kind: string;
      ready: boolean;
      used_by: string[];
      suggested_for?: string;
    }[];
  }>(await fx.core.gateway.call(fx.session, 'voice.list', {}));
  expect(v.narrator_voice_id).toBe('vo_c3z8p1mn');
  const byId = Object.fromEntries(v.voices.map((x) => [x.voice_id, x]));
  expect(byId.vo_c3z8p1mn).toMatchObject({
    kind: 'cloned',
    ready: true,
    used_by: ['narrator', 'ca_a7f2k9wd'],
  });
  expect(byId.vo_n0pzxyom).toMatchObject({
    kind: 'designed',
    ready: true,
    used_by: [],
    suggested_for: 'ca_19qgui0a',
  });
  const c = data<{
    characters: { id: string; name: string; voice_id?: string; voice_name?: string }[];
  }>(await fx.core.gateway.call(fx.session, 'cast.list', {}));
  expect(c.characters).toContainEqual(
    expect.objectContaining({
      id: 'ca_a7f2k9wd',
      name: 'Quan hầu cận',
      voice_id: 'vo_c3z8p1mn',
      voice_name: 'Giọng kênh',
    }),
  );
});

it('reusing a channel character id in CAST.md without voice_id still voices its lines (SC-003)', () => {
  fx = workflowFixture();
  const castMd = path.join(fx.dir, fx.v('CAST.md'));
  writeFileSync(
    castMd,
    `---\nschema_version: 1\nvideo_id: ${fx.videoId}\n---\n# Nhân vật\n\n\`\`\`sf-cast\n- { id: ca_a7f2k9wd, name: Quan hầu cận, role: character, reference_images: [] }\n\`\`\`\n`,
  );
  writeFileSync(path.join(fx.dir, fx.v('SCRIPT.md')), fx.sample('SCRIPT.md'));
  expect(readFileSync(castMd, 'utf8')).not.toContain('voice_id');
  expect(speakersWithoutVoice(fx.dir, fx.videoId)).toEqual([]);
});
