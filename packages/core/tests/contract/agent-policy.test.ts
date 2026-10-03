// 005 · US2 · FR-003, FR-004 · SC-001 — D5 mục 4 cho runtime + canUseTool (D5 mục 5 lớp đầu).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGateway, makeCanUseTool, RUNTIME_DISALLOWED, toolPolicy } from '../../src/index.js';
import { fixtureChannel } from '../domain-helpers.js';

const gw = createGateway();
const roots = [fixtureChannel, path.join(fixtureChannel, '..', 'plugin-root')];

describe('runtime tool policy (005 SC-001)', () => {
  it.each([
    ['main', ['Read', 'Glob', 'Grep', 'Skill', 'TodoWrite']],
    ['frame', ['Read', 'Glob', 'Grep', 'Skill', 'TodoWrite']],
    ['producer', ['Read', 'Glob', 'Grep', 'Skill']],
    ['critic', []],
  ] as const)('%s built-ins', (kind, builtins) => {
    const p = toolPolicy(kind, gw, roots);
    expect(p.allowed.filter((t) => !t.startsWith('mcp__'))).toEqual(builtins);
    expect(p.readRoots).toEqual(roots);
  });

  it('Gateway tools appear as mcp__sf__<name> per kind', () => {
    expect(toolPolicy('critic', gw, roots).allowed).toEqual(['mcp__sf__artifact_read']);
    const main = toolPolicy('main', gw, roots).allowed;
    expect(main).toEqual(
      expect.arrayContaining([
        'mcp__sf__artifact_write',
        'mcp__sf__script_run',
        'mcp__sf__config_set',
      ]),
    );
    expect(toolPolicy('producer', gw, roots).allowed).not.toContain('mcp__sf__script_run');
  });

  it('runtime tools that write, run commands, use the network or spawn agents are disallowed', () => {
    expect(RUNTIME_DISALLOWED).toEqual([
      'Write',
      'Edit',
      'MultiEdit',
      'NotebookEdit',
      'Bash',
      'BashOutput',
      'KillShell',
      'WebFetch',
      'WebSearch',
      'Task',
    ]);
    for (const kind of ['main', 'frame', 'producer', 'critic'] as const) {
      for (const t of RUNTIME_DISALLOWED)
        expect(toolPolicy(kind, gw, roots).allowed).not.toContain(t);
    }
  });
});

describe('canUseTool (005 FR-004)', () => {
  const can = makeCanUseTool(toolPolicy('main', gw, roots));
  const signal = new AbortController().signal;

  it('denies tools outside the policy with a reason', async () => {
    for (const name of ['Bash', 'Write', 'WebFetch', 'mcp__other__x', 'mcp__sf__not_a_tool']) {
      const r = await can(name, {}, { signal });
      expect(r, name).toMatchObject({
        behavior: 'deny',
        message: expect.stringContaining('E_TOOL_DENIED'),
      });
    }
  });

  it('allows policy tools', async () => {
    expect(await can('mcp__sf__artifact_read', { path: 'SCRIPT.md' }, { signal })).toMatchObject({
      behavior: 'allow',
    });
  });

  it('Read/Glob/Grep only inside the channel and plugin dirs', async () => {
    const inside = path.join(fixtureChannel, 'videos', 'vd_8m2pq7rt', 'SCRIPT.md');
    expect(await can('Read', { file_path: inside }, { signal })).toMatchObject({
      behavior: 'allow',
    });
    expect(await can('Grep', { pattern: 'x', path: fixtureChannel }, { signal })).toMatchObject({
      behavior: 'allow',
    });
    expect(await can('Glob', { pattern: '**/*.md' }, { signal })).toMatchObject({
      behavior: 'allow',
    });
    for (const [name, input] of [
      ['Read', { file_path: 'C:\\Windows\\win.ini' }],
      ['Read', { file_path: path.join(fixtureChannel, '..', '..', 'secret.txt') }],
      ['Grep', { pattern: 'x', path: 'C:\\Users' }],
      ['Glob', { pattern: 'C:/Users/**/*.txt' }],
      ['Glob', { pattern: '*.md', path: '..\\..' }],
    ] as const) {
      expect(await can(name, input, { signal }), JSON.stringify(input)).toMatchObject({
        behavior: 'deny',
        message: expect.stringContaining('E_PATH_OUTSIDE'),
      });
    }
  });
});
