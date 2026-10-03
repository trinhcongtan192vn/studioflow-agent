// 003 · US6 · FR-001..003.
import { afterEach, describe, expect, it } from 'vitest';
import { SfError } from '../../src/index.js';
import { gatewayFixture, type GatewayFixture } from '../gateway-helpers.js';

let fx: GatewayFixture;
afterEach(() => fx?.cleanup());

describe('tool registry (003 US6)', () => {
  it('registered tools follow the policy table and appear per kind', () => {
    fx = gatewayFixture();
    fx.gw.register({
      name: 'demo.echo',
      description: 'echo',
      input: {
        type: 'object',
        properties: { x: { type: 'number' } },
        required: ['x'],
        additionalProperties: false,
      },
      handler: async (i) => i,
    });
    expect(fx.gw.list('main').map((t) => t.name)).toContain('demo.echo');
    expect(fx.gw.list('frame').map((t) => t.name)).not.toContain('demo.echo');
  });

  it('validates input before calling the handler', async () => {
    fx = gatewayFixture();
    let called = false;
    fx.gw.register({
      name: 'demo.n',
      description: '',
      input: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
      handler: async () => (called = true),
    });
    expect(await fx.gw.call(fx.session(), 'demo.n', { x: 'no' })).toMatchObject({
      ok: false,
      error: { code: 'E_SCHEMA_INVALID' },
    });
    expect(called).toBe(false);
  });

  it('maps SfError retryable from errors.json, hides internal errors', async () => {
    fx = gatewayFixture();
    fx.gw.register({
      name: 'demo.fail',
      description: '',
      input: { type: 'object' },
      handler: async () => {
        throw new SfError('E_PROVIDER_FAILED', 'boom');
      },
    });
    fx.gw.register({
      name: 'demo.crash',
      description: '',
      input: { type: 'object' },
      handler: async () => {
        throw new TypeError('x is undefined\n    at secret.ts:1');
      },
    });
    expect(await fx.gw.call(fx.session(), 'demo.fail', {})).toEqual({
      ok: false,
      error: { code: 'E_PROVIDER_FAILED', message: 'boom', retryable: true },
    });
    const crash = await fx.gw.call(fx.session(), 'demo.crash', {});
    expect(crash).toMatchObject({ ok: false, error: { code: 'E_INTERNAL', retryable: false } });
    expect(JSON.stringify(crash)).not.toContain('secret.ts');
  });

  it('rejects duplicate registration', () => {
    fx = gatewayFixture();
    expect(() =>
      fx.gw.register({
        name: 'artifact.read',
        description: '',
        input: { type: 'object' },
        handler: async () => 1,
      }),
    ).toThrow();
  });

  it('logs every call with masked secrets', async () => {
    fx = gatewayFixture();
    const lines: string[] = [];
    fx.gw.onLog((l) => lines.push(l));
    await fx.gw.call(fx.session(), 'artifact.read', {
      path: 'nope-sk-ant-api03-AAAAAAAAAAAAAAAAAAAA.md',
    });
    const entry = JSON.parse(lines.at(-1)!);
    expect(entry).toMatchObject({
      msg: 'tool.call',
      tool: 'artifact.read',
      session_id: 'ss_test0001',
      kind: 'main',
      ok: false,
    });
    expect(lines.join('\n')).not.toContain('AAAAAAAAAAAAAAAAAAAA');
  });
});
