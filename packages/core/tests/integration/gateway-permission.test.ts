// 003 · US3 · FR-009..011 (FR-CH-05).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PermissionRequest } from '../../src/index.js';
import { fixtureVideoId } from '../domain-helpers.js';
import { gatewayFixture, type GatewayFixture } from '../gateway-helpers.js';

let fx: GatewayFixture;
afterEach(() => fx?.cleanup());
const vpath = (f: string) => path.join(fx.dir, 'videos', fixtureVideoId, f);

function editedScript() {
  return readFileSync(vpath('SCRIPT.md'), 'utf8').replace('Bệ hạ…', 'Tâu bệ hạ…');
}

describe('permission bus (003 US3)', () => {
  it('overwriting an approved artifact waits for the user; allow → written with backup', async () => {
    fx = gatewayFixture();
    const seen: PermissionRequest[] = [];
    fx.gw.permissions.on('permission.requested', (req: PermissionRequest) => {
      seen.push(req);
      setTimeout(() => fx.gw.permissions.decide({ request_id: req.request_id, allow: true }), 20);
    });
    const r = await fx.gw.call(fx.session(), 'artifact.write', {
      path: 'SCRIPT.md',
      content: editedScript(),
    });
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: 'overwrite_approved',
      tool: 'artifact.write',
      session_id: 'ss_test0001',
    });
    expect(readFileSync(vpath('SCRIPT.md'), 'utf8')).toContain('Tâu bệ hạ…');
    expect(existsSync(vpath('.sf/backups'))).toBe(true);
  });

  it('deny → E_PERMISSION_DECLINED and the file is unchanged', async () => {
    fx = gatewayFixture();
    const before = readFileSync(vpath('SCRIPT.md'), 'utf8');
    fx.gw.permissions.on('permission.requested', (req: PermissionRequest) =>
      fx.gw.permissions.decide({ request_id: req.request_id, allow: false }),
    );
    const r = await fx.gw.call(fx.session(), 'artifact.write', {
      path: 'SCRIPT.md',
      content: editedScript(),
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'E_PERMISSION_DECLINED' } });
    expect(readFileSync(vpath('SCRIPT.md'), 'utf8')).toBe(before);
  });

  it('timeout → E_PERMISSION_DECLINED', async () => {
    fx = gatewayFixture({ permissionTimeoutMs: 50 });
    const r = await fx.gw.call(fx.session(), 'artifact.write', {
      path: 'SCRIPT.md',
      content: editedScript(),
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'E_PERMISSION_DECLINED' } });
  });

  it('pinned frame overwrite always asks, even with "always"', async () => {
    fx = gatewayFixture();
    const state = JSON.parse(readFileSync(vpath('state.json'), 'utf8'));
    state.pinned_frames = {
      fr_9x2b7cqe: {
        pinned_at: '2026-10-03T12:00:00+07:00',
        base_hash: 'a'.repeat(64),
        changes: [],
      },
    };
    writeFileSync(vpath('state.json'), JSON.stringify(state));
    let asked = 0;
    fx.gw.permissions.on('permission.requested', (req: PermissionRequest) => {
      asked++;
      fx.gw.permissions.decide({ request_id: req.request_id, allow: true, always: true });
    });
    const p = 'compositions/frames/fr_9x2b7cqe.html';
    expect(
      (await fx.gw.call(fx.session(), 'artifact.write', { path: p, content: '<div>1</div>' })).ok,
    ).toBe(true);
    expect(asked).toBe(0); // chưa có file → không phải ghi đè
    expect(
      (await fx.gw.call(fx.session(), 'artifact.write', { path: p, content: '<div>2</div>' })).ok,
    ).toBe(true);
    expect(
      (await fx.gw.call(fx.session(), 'artifact.write', { path: p, content: '<div>3</div>' })).ok,
    ).toBe(true);
    expect(asked).toBe(2);
  });

  it('"always allow in this video" for batch_gen is persisted and skips later prompts', async () => {
    fx = gatewayFixture();
    let asked = 0;
    fx.gw.permissions.on('permission.requested', (req: PermissionRequest) => {
      asked++;
      fx.gw.permissions.decide({ request_id: req.request_id, allow: true, always: true });
    });
    const s = fx.session();
    expect(
      await fx.gw.permissions.ask(s, {
        tool: 'tts.synthesize',
        kind: 'batch_gen',
        summary: '40 line',
      }),
    ).toBe(true);
    expect(
      await fx.gw.permissions.ask(s, {
        tool: 'tts.synthesize',
        kind: 'batch_gen',
        summary: '40 line',
      }),
    ).toBe(true);
    expect(asked).toBe(1);
    expect(
      JSON.parse(readFileSync(vpath('state.json'), 'utf8')).config_overrides[
        'policy.auto_approve.batch_gen'
      ],
    ).toBe(true);
  });

  it('concurrent requests are decided independently', async () => {
    fx = gatewayFixture();
    const reqs: PermissionRequest[] = [];
    fx.gw.permissions.on('permission.requested', (req: PermissionRequest) => reqs.push(req));
    const s = fx.session();
    const a = fx.gw.permissions.ask(s, { tool: 'render.video', kind: 'render', summary: 'a' });
    const b = fx.gw.permissions.ask(s, { tool: 'render.video', kind: 'render', summary: 'b' });
    await new Promise((r) => setTimeout(r, 10));
    expect(new Set(reqs.map((r) => r.request_id)).size).toBe(2);
    fx.gw.permissions.decide({ request_id: reqs[1]!.request_id, allow: true });
    fx.gw.permissions.decide({ request_id: reqs[0]!.request_id, allow: false });
    expect(await a).toBe(false);
    expect(await b).toBe(true);
  });
});
