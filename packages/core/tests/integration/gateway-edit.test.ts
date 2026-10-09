// 093 · FR-AG-93-01 — artifact.edit: sửa đúng đoạn sai (thay chuỗi duy nhất), không viết lại cả file; cùng kiểm tra
// như artifact.write (phạm vi, schema, base_hash).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '../../src/index.js';
import { fixtureVideoId } from '../domain-helpers.js';
import { gatewayFixture, type GatewayFixture } from '../gateway-helpers.js';

let fx: GatewayFixture;
afterEach(() => fx?.cleanup());
const vpath = (f: string) => path.join(fx.dir, 'videos', fixtureVideoId, f);

describe('artifact.edit (093)', () => {
  it('replaces one unique snippet and keeps the rest of the file', async () => {
    fx = gatewayFixture();
    const before = readFileSync(vpath('STORYBOARD.md'), 'utf8');
    const r = await fx.gw.call(fx.session(), 'artifact.edit', {
      path: 'STORYBOARD.md',
      edits: [{ old: 'Cung điện lúc hoàng hôn', new: 'Cung điện lúc bình minh' }],
      base_hash: sha256(before),
    });
    expect(r.ok).toBe(true);
    const after = readFileSync(vpath('STORYBOARD.md'), 'utf8');
    expect(after).toBe(before.replace('Cung điện lúc hoàng hôn', 'Cung điện lúc bình minh'));
    expect((r as { data: { hash: string } }).data.hash).toBe(sha256(after));
  });

  it('a snippet that is missing or not unique is refused with a hint', async () => {
    fx = gatewayFixture();
    const missing = await fx.gw.call(fx.session(), 'artifact.edit', {
      path: 'STORYBOARD.md',
      edits: [{ old: 'không có đoạn này', new: 'x' }],
    });
    expect(missing).toMatchObject({ ok: false, error: { code: 'E_SCHEMA_INVALID' } });
    expect(JSON.stringify(missing)).toMatch(/not found/);
    const many = await fx.gw.call(fx.session(), 'artifact.edit', {
      path: 'STORYBOARD.md',
      edits: [{ old: 'sf-frame', new: 'x' }],
    });
    expect(JSON.stringify(many)).toMatch(/matches \d+ times/);
  });

  it('the result still goes through schema validation and base_hash', async () => {
    fx = gatewayFixture();
    const bad = await fx.gw.call(fx.session(), 'artifact.edit', {
      path: 'audio_meta.json',
      edits: [{ old: '"schema_version": 1', new: '"schema_version": "x"' }],
    });
    expect(bad.ok).toBe(false);
    const stale = await fx.gw.call(fx.session(), 'artifact.edit', {
      path: 'STORYBOARD.md',
      edits: [{ old: 'Cung điện lúc hoàng hôn', new: 'Cung điện lúc bình minh' }],
      base_hash: '0'.repeat(64),
    });
    expect(stale).toMatchObject({ ok: false, error: { code: 'E_BASE_HASH_MISMATCH' } });
  });
});
