// 003 · FR-020 — sf gateway tools|serve.
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { runSf, sfBin } from '../helpers.js';
import { fixtureChannel, fixtureVideoId } from '../domain-helpers.js';

describe('sf gateway (003 FR-020)', () => {
  it('tools lists names per kind', () => {
    const r = runSf(['gateway', 'tools', '--kind', 'critic']);
    expect(JSON.parse(r.stdout)).toEqual({ kind: 'critic', tools: ['artifact.read'] });
    const main = JSON.parse(runSf(['gateway', 'tools']).stdout) as { tools: string[] };
    expect(main.tools).toContain('script.run');
  });

  it('serve prints url+token and answers with 401 without token', async () => {
    const child = spawn(
      process.execPath,
      [sfBin, 'gateway', 'serve', '--channel', fixtureChannel, '--video', fixtureVideoId],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    try {
      const line = await new Promise<string>((resolve, reject) => {
        let buf = '';
        child.stdout.on('data', (c: Buffer) => {
          buf += c.toString();
          if (buf.includes('\n')) resolve(buf.split('\n')[0]!);
        });
        child.once('exit', (code) => reject(new Error(`exited ${code}`)));
      });
      const info = JSON.parse(line) as { url: string; token: string; kind: string };
      expect(info).toMatchObject({
        url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
        token: expect.any(String),
        kind: 'main',
      });
      const res = await fetch(info.url, { method: 'POST', body: '{}' });
      expect(res.status).toBe(401);
    } finally {
      child.kill();
    }
  });
});
