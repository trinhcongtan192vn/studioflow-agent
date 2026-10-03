// 011 · FR-001, FR-007, FR-010 — HyperFrames ghim, lint JSON, CLI hf/asset.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hfInstall, pinnedHfVersion } from '../../src/index.js';
import { runSf } from '../helpers.js';
import { copyChannel, fixtureVideoId, tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

describe('HyperFrames adapter (011 FR-001)', () => {
  it('uses the pinned installed version', () => {
    expect(pinnedHfVersion()).toBe('0.8.115');
    expect(hfInstall()).toMatchObject({
      version: '0.8.115',
      bin: expect.stringMatching(/hyperframes\.mjs$/),
    });
  });

  it('sf hf lint reports JSON for a minimal project', () => {
    const t = tempDir('hf-');
    cleanups.push(t.cleanup);
    const v = path.join(t.dir, 'videos', 'vd_aaaaaaaa');
    mkdirSync(v, { recursive: true });
    writeFileSync(
      path.join(v, 'index.html'),
      `<!doctype html><html><head><meta charset="UTF-8"></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="2" data-width="1920" data-height="1080"></div>
<script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`,
    );
    const r = runSf(['hf', 'lint', '--channel', t.dir, '--video', 'vd_aaaaaaaa']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      errorCount: expect.any(Number),
      findings: expect.any(Array),
    });
  });
});

describe('sf asset (011 FR-010)', () => {
  it('import then search', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    mkdirSync(path.join(c.dir, 'uploads'), { recursive: true });
    writeFileSync(
      path.join(c.dir, 'uploads', 'logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"></svg>',
    );
    const r = runSf([
      'asset',
      'import',
      '--channel',
      c.dir,
      '--path',
      'uploads/logo.svg',
      '--video',
      fixtureVideoId,
      '--tags',
      'logo,kênh',
    ]);
    expect(r.code).toBe(0);
    const { asset_id } = JSON.parse(r.stdout);
    const s = runSf(['asset', 'search', '--channel', c.dir, 'logo']);
    expect(JSON.parse(s.stdout).assets[0]).toMatchObject({
      id: asset_id,
      kind: 'svg',
      width: 200,
      height: 80,
    });
  });
});
