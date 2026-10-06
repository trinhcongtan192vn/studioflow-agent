// 010 · US1, US2, US4 · FR-003..008 — asr.align qua build graph (SF_GPU=0), sinh lại, chấp nhận, caption.
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createCore,
  loadProviderManifest,
  readAsrState,
  validateArtifact,
  type AsrAdapter,
  type Core,
  type SessionContext,
} from '../../src/index.js';
import { runSf } from '../helpers.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function setup(): { core: Core; dir: string; session: SessionContext; v: string; app: string } {
  const c = copyChannel();
  const t = tempDir('app-');
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 1000, backoffMs: [10, 20] });
  cleanups.push(() => {
    core.close();
    c.cleanup();
    t.cleanup();
  });
  return {
    core,
    dir: c.dir,
    app: t.dir,
    v: path.join(c.dir, 'videos', fixtureVideoId),
    session: {
      session_id: 'ss_test0001',
      kind: 'main',
      channel_dir: c.dir,
      video_id: fixtureVideoId,
    },
  };
}

async function run(core: Core, session: SessionContext, tool: string, input: unknown) {
  const r = (await core.gateway.call(session, tool, input)) as { ok: boolean; job_id?: string };
  expect(r).toMatchObject({ ok: true, job_id: expect.any(String) });
  const done = (await core.gateway.call(session, 'job.wait', {
    job_id: r.job_id,
    timeout_ms: 20000,
  })) as {
    data: {
      status: string;
      result: {
        mismatched: unknown[];
        regenerated: Record<string, number>;
        nodes: Record<string, { status: string }>;
      };
    };
  };
  return done.data;
}

/** ASR giả luôn nghe sai một line (WER 0,5) để thử sinh lại. */
function flakyAsr(badLine: string): AsrAdapter {
  return {
    manifest: { ...loadProviderManifest('asr.fake'), id: 'asr.flaky' },
    health: async () => ({ ok: true }),
    cacheKeyParts: (i) => ({ audio_hash: i.audio_hash, expected_text: i.expected_text }),
    async run(input) {
      const bad = input.audio.includes(badLine);
      const words = input.expected_text
        .split(/\s+/)
        .map((text, i) => ({ i, text, start_ms: i * 100, end_ms: (i + 1) * 100 }));
      return {
        words,
        transcript: bad ? 'một câu hoàn toàn khác hẳn' : input.expected_text,
        wer: bad ? 0.5 : 0,
      };
    },
  };
}

const meta = (v: string) => JSON.parse(readFileSync(path.join(v, 'audio_meta.json'), 'utf8'));

describe('asr.align (010 US1, US2)', () => {
  it('aligns every line with asr.fake, writes words/WER and caption_groups.json', async () => {
    const { core, session, v } = setup();
    const job = await run(core, session, 'asr.align', { line_ids: 'all' });
    expect(job.status).toBe('succeeded');
    expect(job.result.mismatched).toEqual([]);
    const m = meta(v);
    expect(
      validateArtifact(`videos/${fixtureVideoId}/audio_meta.json`, JSON.stringify(m)).errors,
    ).toEqual([]);
    const l0 = m.lines[0];
    expect(l0).toMatchObject({ line_id: 'ln_2r7c4kxm', asr_wer: 0, asr_flag: 'ok' });
    // chữ hiển thị (text), không phải tts_text
    expect(l0.words.map((w: { text: string }) => w.text)).toEqual([
      'Năm',
      '1428,',
      'Lê',
      'Lợi',
      'lên',
      'ngôi.',
    ]);
    const cg = readFileSync(path.join(v, 'caption_groups.json'), 'utf8');
    expect(validateArtifact(`videos/${fixtureVideoId}/caption_groups.json`, cg).errors).toEqual([]);
    const groups = JSON.parse(cg).groups;
    expect(groups[0]).toMatchObject({ line_id: 'ln_2r7c4kxm', text: 'Năm 1428,', emphasis: [1] });
    // channel.json đặt caption.max_words = 6; cụm không vắt qua line
    for (const g of groups) expect(g.word_range[1] - g.word_range[0] + 1).toBeLessThanOrEqual(6);
    expect(groups.at(-1)).toMatchObject({ line_id: 'ln_5h8q2m3x' });
  });

  it('a misread line is regenerated up to asr.max_regen, then reported; accept marks it', async () => {
    const { core, session, v, dir } = setup();
    core.providers.register(flakyAsr('ln_9w3b6tqa'));
    const ch = JSON.parse(readFileSync(path.join(dir, 'channel.json'), 'utf8'));
    ch.config['provider.asr.align'] = 'asr.flaky';
    writeFileSync(path.join(dir, 'channel.json'), JSON.stringify(ch));
    const job = await run(core, session, 'asr.align', { line_ids: 'all' });
    expect(job.result.regenerated).toEqual({ ln_9w3b6tqa: 1 }); // asr.max_regen mặc định 1
    // 038: tỷ lệ lỗi chấm lại từ transcript ("Bệ hạ…" ↔ câu khác hẳn → 1)
    expect(job.result.mismatched).toEqual([{ line_id: 'ln_9w3b6tqa', asr_wer: 1, regen: 1 }]);
    expect(readAsrState(v).regen).toEqual({ ln_9w3b6tqa: 1 });
    // audio line được sinh lại với seed khác → provenance thêm bản ghi của line đó
    const provs = readdirSync(path.join(v, 'provenance')).map((f) =>
      JSON.parse(readFileSync(path.join(v, 'provenance', f), 'utf8')),
    );
    expect(
      provs.filter((p) => p.output === 'audio/lines/ln_9w3b6tqa.wav' && p.seed === 1),
    ).toHaveLength(1);
    expect(meta(v).lines[1]).toMatchObject({ asr_flag: 'mismatch', asr_wer: 1 });

    expect(
      await core.gateway.call(session, 'asr.accept', { line_ids: ['ln_9w3b6tqa'] }),
    ).toMatchObject({ ok: true });
    expect(meta(v).lines[1].asr_flag).toBe('accepted');
    expect(
      await core.gateway.call(session, 'asr.accept', { line_ids: ['ln_zzzzzzzz'] }),
    ).toMatchObject({ ok: false, error: { code: 'E_ID_UNKNOWN' } });
  });

  it('editing one line re-aligns only that line', async () => {
    const { core, session, v } = setup();
    await run(core, session, 'asr.align', { line_ids: 'all' });
    const p = path.join(v, 'SCRIPT.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace('Bệ hạ…', 'Tâu bệ hạ…'));
    const job = await run(core, session, 'asr.align', { line_ids: 'all' });
    const built = Object.entries(job.result.nodes)
      .filter(([, n]) => n.status === 'built')
      .map(([id]) => id)
      .sort();
    expect(built).toEqual([
      'asr.line:ln_9w3b6tqa',
      'audio.line:ln_9w3b6tqa',
      'audio_meta',
      'captions',
    ]);
    expect(meta(v).lines[1].words.map((w: { text: string }) => w.text)).toEqual([
      'Tâu',
      'bệ',
      'hạ…',
    ]);
  });
});

describe('sf asr (010 FR-008)', () => {
  it('align and accept from the CLI', () => {
    const c = copyChannel();
    const t = tempDir('app-');
    cleanups.push(c.cleanup, t.cleanup);
    const env = { SF_GPU: '0', SF_APP_DATA: t.dir };
    const r = runSf(['asr', 'align', '--channel', c.dir, '--video', fixtureVideoId], { env });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ status: 'succeeded', mismatched: [] });
    const a = runSf(
      ['asr', 'accept', '--channel', c.dir, '--video', fixtureVideoId, '--lines', 'ln_9w3b6tqa'],
      { env },
    );
    expect(a.code).toBe(0);
    expect(readAsrState(path.join(c.dir, 'videos', fixtureVideoId)).accepted.ln_9w3b6tqa).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
