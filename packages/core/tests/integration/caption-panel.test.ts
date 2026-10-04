// 026 · AC-M3-03 (FR-ST-05) — bảng caption: đọc cụm + audio xem trước, lưu override có base_hash,
// bất biến khi lưu, tách/gộp; đổi timing trong bảng → index/captions.html (đầu vào render) phản ánh đúng.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BuildGraph,
  createCore,
  decodeWav,
  type CaptionOverrides,
  type Core,
  type SessionContext,
} from '../../src/index.js';
import { writeValidFrames } from '../graph-helpers.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));
const V = `videos/${fixtureVideoId}`;

async function setup() {
  const c = copyChannel();
  const t = tempDir('app-');
  copyFileSync(path.join(fixtureAppData, 'settings.json'), path.join(t.dir, 'settings.json'));
  const core: Core = createCore({ appDataDir: t.dir, permissionTimeoutMs: 1000 });
  cleanups.push(() => {
    core.close();
    c.cleanup();
    t.cleanup();
  });
  const session: SessionContext = {
    session_id: 'ss_test0001',
    kind: 'main',
    channel_dir: c.dir,
    video_id: fixtureVideoId,
  };
  const r = (await core.gateway.call(session, 'asr.align', { line_ids: 'all' })) as {
    job_id: string;
  };
  await core.gateway.call(session, 'job.wait', { job_id: r.job_id, timeout_ms: 20000 });
  const store = core.gateway.storeFor(c.dir);
  // override mẫu trỏ tới cụm cũ (trước khi căn lại) → bỏ, giữ style
  const ovRel = `${V}/caption-overrides.json`;
  const ov = JSON.parse(readFileSync(store.abs(ovRel), 'utf8'));
  store.write(ovRel, JSON.stringify({ ...ov, groups: {} }), { by: 'test' });
  const buildIndex = async () => {
    const b = await new BuildGraph({ store, appDataDir: t.dir, builders: core.graph }).build(
      fixtureVideoId,
      { targets: ['index'] },
    );
    expect(b.status).toBe('succeeded');
    return readFileSync(store.abs(`${V}/compositions/captions.html`), 'utf8');
  };
  return { core, store, dir: c.dir, app: t.dir, buildIndex };
}

const startOf = (html: string, id: string) =>
  Number(new RegExp(`id="cap-${id}"[^>]*data-start="([\\d.]+)"`).exec(html)?.[1]);

describe('caption panel (026 FR-ST-05)', () => {
  it('AC-M3-03: dragging a group edge in the panel is reflected in the render input', async () => {
    const { core, store, buildIndex } = await setup();
    writeValidFrames(store, fixtureVideoId);
    const before = await buildIndex();

    const d = core.captions.load(store, fixtureVideoId);
    expect(d.read_only).toBe(false);
    expect(d.base_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.orphans).toEqual([]);
    expect(d.groups.length).toBeGreaterThan(1);
    // audio xem trước: voice.wav ghép từ audio/lines + đỉnh mỗi 10 ms
    expect(existsSync(d.audio!)).toBe(true);
    const wav = decodeWav(readFileSync(d.audio!));
    expect(
      Math.abs((wav.samples.length / wav.sampleRate) * 1000 - d.waveform!.duration_ms),
    ).toBeLessThan(20);
    expect(d.waveform!.peaks.length).toBe(Math.ceil(d.waveform!.duration_ms / 10));

    const g = d.groups[0]!;
    const line = d.lines.find((l) => l.line_id === g.line_id)!;
    expect(g.start_ms).toBeGreaterThanOrEqual(line.start_ms);
    const ov: CaptionOverrides = {
      ...d.overrides,
      groups: { [g.id]: { start_ms: g.start_ms + 50, text: 'NĂM 1428' } },
    };
    const saved = await core.captions.save(store, fixtureVideoId, ov, d.base_hash);
    expect(saved.hash).toMatch(/^[0-9a-f]{64}$/);
    // index lỗi thời vì overrides đổi (D4 8.1)
    const st = new BuildGraph({ store, builders: core.graph }).status(fixtureVideoId);
    expect(st.find((n) => n.key === 'index')!.status).toBe('stale');

    const after = await buildIndex();
    expect(startOf(after, g.id)).toBeCloseTo(startOf(before, g.id) + 0.05, 3);
    expect(after).toContain('NĂM 1428');
  });

  it('rejects a stale base_hash, overlapping groups and out-of-line timing', async () => {
    const { core, store } = await setup();
    const d = core.captions.load(store, fixtureVideoId);
    await core.captions.save(store, fixtureVideoId, d.overrides, d.base_hash);
    // không gửi base_hash (coi như chưa có file) nhưng file đã có → xung đột
    await expect(
      core.captions.save(store, fixtureVideoId, d.overrides, null),
    ).rejects.toMatchObject({ code: 'E_BASE_HASH_MISMATCH' });
    const d2 = core.captions.load(store, fixtureVideoId);
    await expect(
      core.captions.save(store, fixtureVideoId, d2.overrides, 'f'.repeat(64)),
    ).rejects.toMatchObject({ code: 'E_BASE_HASH_MISMATCH' });

    const [a, b] = d2.groups.filter((x) => x.line_id === d2.groups[0]!.line_id);
    expect(b).toBeDefined();
    await expect(
      core.captions.save(
        store,
        fixtureVideoId,
        { ...d2.overrides, groups: { [a!.id]: { end_ms: b!.start_ms + 30 } } },
        d2.base_hash,
      ),
    ).rejects.toMatchObject({
      code: 'E_SCHEMA_INVALID',
      message: expect.stringMatching(/overlaps/),
    });
    const line = d2.lines.find((l) => l.line_id === a!.line_id)!;
    await expect(
      core.captions.save(
        store,
        fixtureVideoId,
        { ...d2.overrides, groups: { [a!.id]: { start_ms: line.start_ms - 10 } } },
        d2.base_hash,
      ),
    ).rejects.toMatchObject({
      code: 'E_SCHEMA_INVALID',
      message: expect.stringMatching(/outside/),
    });
  });

  it('split and merge are stored as overrides; owner=studio makes the panel read-only', async () => {
    const { core, store, dir } = await setup();
    const d = core.captions.load(store, fixtureVideoId);
    const g = d.groups.find((x) => x.word_range[1] > x.word_range[0])!;
    const at = g.word_range[0] + 1;
    await core.captions.save(
      store,
      fixtureVideoId,
      {
        ...d.overrides,
        splits: [{ group_id: g.id, at_word: at, new_id: 'cg_9k2m4p7q' }],
      } as CaptionOverrides,
      d.base_hash,
    );
    const d2 = core.captions.load(store, fixtureVideoId);
    const left = d2.groups.find((x) => x.id === g.id)!;
    const right = d2.groups.find((x) => x.id === 'cg_9k2m4p7q')!;
    expect(left.word_range).toEqual([g.word_range[0], at - 1]);
    expect(right.word_range).toEqual([at, g.word_range[1]]);
    expect(left.end_ms).toBeLessThanOrEqual(right.start_ms);
    expect(`${left.text} ${right.text}`).toBe(g.text);
    // gộp lại hai cụm vừa tách
    await core.captions.save(
      store,
      fixtureVideoId,
      {
        ...d2.overrides,
        merges: [{ group_ids: [g.id, 'cg_9k2m4p7q'], new_id: 'cg_3w8x5n2r' }],
      } as CaptionOverrides,
      d2.base_hash,
    );
    const d3 = core.captions.load(store, fixtureVideoId);
    expect(d3.groups.find((x) => x.id === 'cg_3w8x5n2r')).toMatchObject({
      text: g.text,
      word_range: g.word_range,
      start_ms: g.start_ms,
      end_ms: g.end_ms,
    });
    expect(d3.orphans).toEqual([]);

    // owner = studio → chỉ đọc; Gateway chặn ghi
    const sf = path.join(dir, V, 'state.json');
    const s = JSON.parse(readFileSync(sf, 'utf8'));
    writeFileSync(sf, JSON.stringify({ ...s, owner: 'studio' }));
    const d4 = core.captions.load(store, fixtureVideoId);
    expect(d4.read_only).toBe(true);
    await expect(
      core.captions.save(store, fixtureVideoId, d4.overrides, d4.base_hash),
    ).rejects.toMatchObject({ code: 'E_OWNER_CONFLICT' });
  });

  it('an override whose group disappeared is kept and reported as orphan', async () => {
    const { core, store } = await setup();
    store.write(
      `${V}/caption-overrides.json`,
      JSON.stringify({
        schema_version: 1,
        video_id: fixtureVideoId,
        groups: { cg_7z7z7z7z: { text: 'x' } },
        splits: [],
        merges: [],
      }),
      { by: 'test' },
    );
    const st = new BuildGraph({ store, builders: core.graph }).status(fixtureVideoId);
    expect(st.filter((n) => n.status === 'orphan')).toEqual([
      expect.objectContaining({ key: 'caption_override:cg_7z7z7z7z', type: 'caption_override' }),
    ]);
    expect(core.captions.load(store, fixtureVideoId).orphans).toEqual(['cg_7z7z7z7z']);
  });
});
