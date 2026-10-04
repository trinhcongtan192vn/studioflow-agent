// 022 · SC-001 (AC-M2-05) — channel.validate: giọng, LUT, bộ miệng, config key, gói prompt, rubric;
// kết quả kèm artifact.write; CLI sf channel validate.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, validateChannel, type SessionContext } from '../../src/index.js';
import { runSf } from '../helpers.js';
import { copyChannel, tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((c) => c()),
);

/** Kênh mẫu "đầy đủ": giọng vo_c3z8p1mn + gói phong cách warm-archive có LUT (ở app-data). */
function completeChannel() {
  const c = copyChannel();
  const app = tempDir('app-');
  cleanups.push(c.cleanup, app.cleanup);
  const w = (rel: string, content: string, root = c.dir) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };
  w(
    'voices/vo_c3z8p1mn/profile.json',
    JSON.stringify({ voice_id: 'vo_c3z8p1mn', name: 'Người dẫn' }),
  );
  w('voices/vo_c3z8p1mn/voice.pt', 'voice');
  w(
    'extensions/styles/warm-archive/style.yaml',
    'id: warm-archive\nversion: 1.0.0\nlut: luts/warm.cube\n',
    app.dir,
  );
  w('extensions/styles/warm-archive/luts/warm.cube', 'TITLE "warm"\n', app.dir);
  return { dir: c.dir, app: app.dir, w };
}

const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code).sort();

describe('channel.validate (022)', () => {
  it('a complete channel is valid', () => {
    const { dir, app } = completeChannel();
    const r = validateChannel(dir, { appDataDir: app });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('AC-M2-05: missing voice file and missing LUT are caught', () => {
    const { dir, app } = completeChannel();
    rmSync(path.join(dir, 'voices', 'vo_c3z8p1mn', 'voice.pt'));
    rmSync(path.join(app, 'extensions', 'styles', 'warm-archive', 'luts', 'warm.cube'));
    const r = validateChannel(dir, { appDataDir: app });
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(expect.arrayContaining(['missing_voice', 'missing_lut']));
    // giọng thiếu được báo cho cả kênh lẫn cast dùng nó
    expect(r.errors.filter((e) => e.code === 'missing_voice').map((e) => e.path)).toEqual(
      expect.arrayContaining(['channel.json', 'characters/ca_a7f2k9wd/cast.json']),
    );
  });

  it('profile checks: config keys, prompt pack, rubric, blueprint, mouth set, style pack', () => {
    const { dir, app, w } = completeChannel();
    w('profile/skills/channel/SKILL.md', 'Look {{config:look.id}} · sai {{config:no.such.key}}');
    w(
      'profile/references/prompts/pack.yaml',
      'steps:\n  script: { template: script.md, include: [common/missing.md], token_cap: 100 }\n  outline: { token_cap: 100 }\n',
    );
    w('profile/references/prompts/script.md', 'Viết {{brief}}');
    w(
      'profile/references/rubrics/bad.yaml',
      'id: bad\nversion: 1\nscale: 10\ncriteria:\n  - { id: a, weight: 0.5, prompt: x }\n',
    );
    w('profile/references/blueprints/map-zoom/blueprint.yaml', 'id: map-zoom\n');
    const cast = JSON.parse(readJson(path.join(dir, 'characters', 'ca_a7f2k9wd', 'cast.json')));
    cast.mouth_set = 'chibi';
    writeFileSync(path.join(dir, 'characters', 'ca_a7f2k9wd', 'cast.json'), JSON.stringify(cast));
    const ch = JSON.parse(readJson(path.join(dir, 'channel.json')));
    ch.config['look.id'] = 'no-such-look';
    writeFileSync(path.join(dir, 'channel.json'), JSON.stringify(ch));
    const r = validateChannel(dir, { appDataDir: app });
    expect(codes(r)).toEqual(
      expect.arrayContaining([
        'config_key',
        'prompt_pack',
        'rubric',
        'blueprint_incomplete',
        'missing_mouth_set',
        'missing_style',
      ]),
    );
    expect(r.errors.find((e) => e.code === 'config_key')!.message).toContain('no.such.key');
  });

  it('warns about storyboard asset ids missing from the channel library', () => {
    const { dir, app } = completeChannel();
    rmSync(path.join(dir, 'assets', 'manifest.json'), { force: true });
    const r = validateChannel(dir, { appDataDir: app });
    expect(r.warnings.map((x) => x.code)).toContain('missing_asset');
  });

  it('artifact.write to channel.json returns the validation; sf channel validate exits 1 on errors', async () => {
    const { dir, app } = completeChannel();
    writeFileSync(
      path.join(app, 'settings.json'),
      JSON.stringify({
        schema_version: 1,
        config: {},
        installed: { profile: 'minimal', components: [] },
        provider_fallbacks: {},
        network: { allow: [] },
        pricing: [],
        trace: { capture_content: false, retention_days: 30, phoenix_enabled: false },
        recent_channels: [],
      }),
    );
    const core = createCore({ appDataDir: app });
    cleanups.push(() => core.close());
    const session: SessionContext = { session_id: 'ss_test0001', kind: 'main', channel_dir: dir };
    const ch = JSON.parse(readJson(path.join(dir, 'channel.json')));
    ch.config['voice.id'] = 'vo_zzzzzzzz';
    const r = (await core.gateway.call(session, 'artifact.write', {
      path: 'channel.json',
      content: JSON.stringify(ch, null, 2),
    })) as {
      ok: boolean;
      data: { channel_validation: { ok: boolean; errors: { code: string }[] } };
    };
    expect(r.ok).toBe(true);
    expect(r.data.channel_validation.ok).toBe(false);
    expect(r.data.channel_validation.errors.map((e) => e.code)).toContain('missing_voice');
    const cli = runSf(['channel', 'validate', dir], { env: { SF_APP_DATA: app } });
    expect(cli.code).toBe(1);
    expect(cli.stderr).toContain('E_CHANNEL_INVALID');
  });
});

const readJson = (f: string): string => readFileSync(f, 'utf8');
