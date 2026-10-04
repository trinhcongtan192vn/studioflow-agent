// 025 · SC-003 (FR-ST-04) — frame ghim lỗi thời: keep / reapply (áp lại delta lên frame dựng lại) / discard.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BuildGraph,
  PinnedDecider,
  WriteStore,
  type FrameRebuilder,
  type VideoState,
} from '../../src/index.js';
import { fixtureAppData, fixtureVideoId } from '../domain-helpers.js';
import { graphFixture, V, validFrameHtml } from '../graph-helpers.js';
import { frameHtmlBuilder } from '../../src/index.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

const F1 = 'fr_9x2b7cqe';
const LAYERS = ['el_t5w8n3ja', 'el_q2k7m4zp'];

function setup() {
  const fx = graphFixture();
  cleanups.push(fx.cleanup);
  const rebuilt: string[] = [];
  const rebuild: FrameRebuilder = async ({ store, videoId, frameId }) => {
    rebuilt.push(frameId);
    store.write(
      `videos/${videoId}/compositions/frames/${frameId}.html`,
      validFrameHtml(frameId, frameId === F1 ? LAYERS : ['el_a1b2c3d4'], 'rebuilt').replace(
        `data-sf-id="el_q2k7m4zp"`,
        `data-sf-id="el_q2k7m4zp" style="left: 10px; top: 5px"`,
      ),
      { by: 'test' },
    );
  };
  fx.graph.registerBuilder('frame_html', frameHtmlBuilder({ rebuild: () => rebuild }));
  for (const [fr, l] of [
    [F1, LAYERS],
    ['fr_3m8k1w7d', ['el_a1b2c3d4']],
  ] as const)
    fx.store.write(`${V}/compositions/frames/${fr}.html`, validFrameHtml(fr, [...l]), {
      by: 'test',
    });
  const builders = (fx.graph as unknown as { builders: never }).builders;
  const decider = new PinnedDecider({
    builders,
    appDataDir: fixtureAppData,
    rebuild: () => rebuild,
  });
  const pin = () => {
    const sf = fx.store.abs(`${V}/state.json`);
    const st = JSON.parse(readFileSync(sf, 'utf8'));
    st.pinned_frames = {
      [F1]: {
        pinned_at: '2026-10-04T10:00:00+07:00',
        base_hash: '0'.repeat(64),
        changes: [
          { element_id: 'el_q2k7m4zp', attr: 'style.left', before: '10px', after: '640px' },
          { element_id: 'el_t5w8n3ja', attr: 'script', before: '1', after: '2' },
        ],
      },
    };
    writeFileSync(sf, JSON.stringify(st));
  };
  const status = () =>
    new BuildGraph({ store: fx.store, appDataDir: fixtureAppData, builders })
      .status(fixtureVideoId)
      .find((n) => n.key === `frame_html:${F1}`)!.status;
  const state = () =>
    JSON.parse(readFileSync(fx.store.abs(`${V}/state.json`), 'utf8')) as VideoState;
  return { ...fx, rebuilt, decider, pin, status, state };
}

describe('pinned frame decisions (025 FR-ST-04)', () => {
  it('reapply rebuilds the frame and re-applies the manual delta; script changes are reported', async () => {
    const { graph, store, decider, pin, rebuilt, state } = setup();
    await graph.build(fixtureVideoId);
    pin();
    const r = await decider.decide(store as WriteStore, fixtureVideoId, F1, 'reapply');
    expect(rebuilt).toEqual([F1]);
    const html = readFileSync(store.abs(`${V}/compositions/frames/${F1}.html`), 'utf8');
    expect(html).toContain('rebuilt');
    expect(html).toContain('left: 640px');
    expect(r.unapplied?.map((c) => c.attr)).toEqual(['script']);
    expect(readFileSync(path.join(store.root, r.backup!), 'utf8')).not.toContain('rebuilt');
    const pins = state().pinned_frames as Record<string, { changes: { attr: string }[] }>;
    expect(pins[F1]!.changes.map((c) => c.attr)).toEqual(['style.left']);
  });

  it('keep accepts the manual version; discard drops the pin and rebuilds', async () => {
    const { graph, store, decider, pin, status, rebuilt, state } = setup();
    await graph.build(fixtureVideoId);
    pin();
    const f = store.abs(`${V}/SCRIPT.md`);
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace('Năm 1428', 'Vào năm 1428, sau nhiều năm kháng chiến'),
    );
    expect(status()).toBe('pinned_stale');
    await decider.decide(store as WriteStore, fixtureVideoId, F1, 'keep');
    expect(status()).toBe('pinned');
    expect(rebuilt).toEqual([]);
    await decider.decide(store as WriteStore, fixtureVideoId, F1, 'discard');
    expect(rebuilt).toEqual([F1]);
    expect((state().pinned_frames as Record<string, unknown>)[F1]).toBeUndefined();
  });
});
