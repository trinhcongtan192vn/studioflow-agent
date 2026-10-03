// 003 · SC-001 · D12 mục 5 — 20 lời gọi đối nghịch, 0 lần lọt.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SessionContext } from '../../src/index.js';
import { gatewayFixture } from '../gateway-helpers.js';

const fx = gatewayFixture();
const outside = mkdtempSync(path.join(os.tmpdir(), 'ngoài-'));
execFileSync('cmd', [
  '/c',
  'mklink',
  '/J',
  path.join(fx.dir, 'videos', 'vd_8m2pq7rt', 'escape'),
  outside,
]);
afterAll(() => {
  fx.cleanup();
  rmSync(outside, { recursive: true, force: true });
});

const out = (name: string) => path.join(outside, name).replaceAll('\\', '/');
type Call = [string, Partial<SessionContext>, string, Record<string, unknown>];
const frame = {
  kind: 'frame' as const,
  frame_id: 'fr_9x2b7cqe' as const,
  allowed_paths: ['compositions/frames/fr_9x2b7cqe.html'],
};

const ATTACKS: Call[] = [
  ['absolute path', {}, 'artifact.write', { path: out('a.txt'), content: 'x' }],
  ['parent escape', {}, 'artifact.write', { path: '../../../a.txt', content: 'x' }],
  ['nested escape', {}, 'artifact.write', { path: 'public/../../../../a.txt', content: 'x' }],
  ['junction', {}, 'artifact.write', { path: 'escape/a.txt', content: 'x' }],
  ['UNC', {}, 'artifact.write', { path: '//127.0.0.1/c$/a.txt', content: 'x' }],
  ['drive-relative', {}, 'artifact.write', { path: 'C:a.txt', content: 'x' }],
  ['other video prefix', {}, 'artifact.write', { path: 'video:vd_00000000/a.txt', content: 'x' }],
  ['frame writes script', frame, 'artifact.write', { path: 'SCRIPT.md', content: 'x' }],
  [
    'producer writes anything',
    { kind: 'producer' },
    'artifact.write',
    { path: 'notes.md', content: 'x' },
  ],
  ['critic writes', { kind: 'critic' }, 'artifact.write', { path: 'notes.md', content: 'x' }],
  [
    'powershell',
    {},
    'script.run',
    { command: 'powershell', args: ['-c', `Set-Content ${out('p.txt')} x`] },
  ],
  ['cmd', {}, 'script.run', { command: 'cmd', args: ['/c', `echo x > ${out('c.txt')}`] }],
  [
    'node -e',
    {},
    'script.run',
    { command: 'node', args: ['-e', `require('fs').writeFileSync('${out('n.txt')}','x')`] },
  ],
  ['sf non-agent', {}, 'script.run', { command: 'sf', args: ['artifact', 'migrate', '.'] }],
  [
    'shell pipe',
    {},
    'script.run',
    { command: 'sf', args: ['artifact', 'validate', 'SCRIPT.md|calc'] },
  ],
  [
    'dotdot arg',
    {},
    'script.run',
    { command: 'sf', args: ['artifact', 'validate', '..\\..\\channel.json'] },
  ],
  [
    'absolute arg',
    {},
    'script.run',
    { command: 'sf', args: ['artifact', 'validate', out('x.md')] },
  ],
  ['frame hyperframes add', frame, 'script.run', { command: 'hyperframes', args: ['add', 'x'] }],
  ['glob escape', {}, 'artifact.list', { glob: '../../**' }],
  ['unknown tool', {}, 'fs.write', { path: out('t.txt'), content: 'x' }],
];

describe(`adversarial calls (003 SC-001, ${ATTACKS.length})`, () => {
  it('has 20 cases', () => expect(ATTACKS).toHaveLength(20));
  for (const [name, over, tool, input] of ATTACKS) {
    it(name, async () => {
      const r = await fx.gw.call(fx.session(over), tool, input);
      expect(r.ok).toBe(false);
      expect(readdirSync(outside)).toEqual([]);
    });
  }
});
