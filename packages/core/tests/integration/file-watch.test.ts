// 025 · SC-004 (FR-WS-06) — sửa file trong project ngoài app → cảnh báo + external_change; ghi của app
// không bị báo; app ghi lại → bỏ đánh dấu.
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { readExternal, watchVideo } from '../../src/index.js';
import { fixtureVideoId } from '../domain-helpers.js';
import { graphFixture, V } from '../graph-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await sleep(50);
}

describe('file watcher (025 FR-WS-06)', () => {
  it('flags edits made outside the app, ignores the app’s own writes, clears on app write', async () => {
    const fx = graphFixture();
    cleanups.push(fx.cleanup);
    await fx.graph.build(fixtureVideoId);
    const seen: string[] = [];
    const w = watchVideo(fx.store, fixtureVideoId, (rel) => seen.push(rel));
    cleanups.push(() => w.close());
    // ghi của app (module ghi) → không báo
    fx.store.write(
      `${V}/STORYBOARD.md`,
      readFileSync(fx.store.abs(`${V}/STORYBOARD.md`), 'utf8').replace('Ghi chú', 'Ghi chú.'),
      { by: 'test' },
    );
    await sleep(600);
    expect(seen).toEqual([]);
    // sửa tay index.html (đầu ra của nút index) ngoài app
    writeFileSync(fx.store.abs(`${V}/index.html`), '<html><body>sửa tay</body></html>');
    await until(() => seen.length > 0);
    expect(seen).toEqual(['index.html']);
    expect(Object.keys(readExternal(fx.store, fixtureVideoId).files)).toEqual(['index.html']);
    const st = fx.graph.status(fixtureVideoId).find((n) => n.key === 'index')!;
    expect(st).toMatchObject({ status: 'external_change', decision_required: true });
    expect(fx.graph.plan(fixtureVideoId).jobs.map((j) => j.kind)).not.toContain('index');
    // app ghi lại → hết đánh dấu
    fx.store.write(`${V}/index.html`, '<html><body>app</body></html>', { by: 'test' });
    expect(readExternal(fx.store, fixtureVideoId).files).toEqual({});
  });
});
