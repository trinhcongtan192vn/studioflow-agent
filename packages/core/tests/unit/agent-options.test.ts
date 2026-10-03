// 005 · US2 AC5, US5 · FR-002, FR-005, FR-009 — tùy chọn SDK (tech-defaults mục 2).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSdkOptions,
  createGateway,
  sessionOptionsFor,
  STUDIOFLOW_CORE_PLUGIN,
} from '../../src/index.js';
import { fixtureChannel, fixtureVideoId } from '../domain-helpers.js';

const gw = createGateway();
const ctx = (kind: 'main' | 'frame' | 'producer' | 'critic', extra = {}) => ({
  session_id: 'ss_test0001' as const,
  kind,
  channel_dir: fixtureChannel,
  video_id: fixtureVideoId,
  ...extra,
});

describe('sessionOptionsFor (005)', () => {
  it('main: app plugin + channel profile, FN-005 rules, policy', () => {
    const o = sessionOptionsFor('main', ctx('main'), gw);
    expect(o.plugins).toEqual([STUDIOFLOW_CORE_PLUGIN, path.join(fixtureChannel, 'profile')]);
    expect(o.systemAppend).toContain('mcp__sf__artifact_write');
    expect(o.maxTurns).toBe(60);
    expect(o.model).toBe('claude-sonnet-5-5');
    expect(o.tools.readRoots).toEqual([
      fixtureChannel,
      STUDIOFLOW_CORE_PLUGIN,
      path.join(fixtureChannel, 'profile'),
    ]);
  });

  it('frame: output path rule; critic: no plugins, read only', () => {
    const f = sessionOptionsFor(
      'frame',
      ctx('frame', {
        frame_id: 'fr_9x2b7cqe',
        allowed_paths: ['compositions/frames/fr_9x2b7cqe.html'],
      }),
      gw,
    );
    expect(f.systemAppend).toContain('compositions/frames/fr_9x2b7cqe.html');
    expect(f.maxTurns).toBe(30);
    const c = sessionOptionsFor('critic', ctx('critic'), gw);
    expect(c.plugins).toEqual([]);
    expect(c.tools.allowed).toEqual(['mcp__sf__artifact_read']);
    expect(c.maxTurns).toBe(10);
  });
});

describe('buildSdkOptions (005 FR-002)', () => {
  const env = {
    PATH: 'x',
    CLAUDECODE: '1',
    CLAUDE_CODE_SESSION_ID: 'y',
    CLAUDE_AGENT_SDK_VERSION: 'z',
    AI_AGENT: 'a',
    SystemRoot: 'C:\\Windows',
  };

  it('isolates the SDK from user configuration and wires only the sf server', () => {
    const o = sessionOptionsFor('main', ctx('main'), gw);
    const sdk = buildSdkOptions(o, { gateway: gw, env });
    expect(sdk.settingSources).toEqual([]);
    expect(Object.keys(sdk.mcpServers!)).toEqual(['sf']);
    expect(sdk.mcpServers!.sf).toMatchObject({ type: 'sdk', name: 'sf' });
    expect(sdk.cwd).toBe(path.join(fixtureChannel, 'videos', fixtureVideoId));
    expect(sdk.allowedTools).toEqual(o.tools.allowed);
    expect(sdk.disallowedTools).toContain('Bash');
    expect(sdk.permissionMode).toBe('default');
    expect(typeof sdk.canUseTool).toBe('function');
    expect(sdk.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: o.systemAppend,
    });
    expect(sdk.plugins).toEqual(o.plugins.map((p) => ({ type: 'local', path: p })));
    expect(sdk.maxTurns).toBe(60);
    expect(sdk.includePartialMessages).toBe(true);
    expect(sdk.env).toEqual({ PATH: 'x', SystemRoot: 'C:\\Windows' });
  });

  it('channel-level session runs in the channel dir; api key goes only to env', () => {
    const o = sessionOptionsFor('main', { ...ctx('main'), video_id: undefined }, gw);
    const sdk = buildSdkOptions(o, {
      gateway: gw,
      env: {},
      apiKey: 'sk-ant-test',
      resume: 'sess-1',
    });
    expect(sdk.cwd).toBe(fixtureChannel);
    expect(sdk.env).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(sdk.resume).toBe('sess-1');
  });
});
