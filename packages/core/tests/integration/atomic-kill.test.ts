// 002 · US5 AC5 · SC-003 — giết tiến trình giữa lúc ghi không làm hỏng file đích.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { coreDir } from '../helpers.js';
import { tempDir } from '../domain-helpers.js';

const ITER = Number(process.env.SF_KILL_ITER ?? 50);
const t = tempDir('kill ');
afterAll(() => t.cleanup());

describe(`atomic writes survive ${ITER} kills (002 SC-003)`, () => {
  it('target is always a complete version', async () => {
    const channel = path.join(t.dir, 'ch');
    mkdirSync(path.join(channel, 'videos', 'vd_aaaaaaaa'), { recursive: true });
    const target = path.join(channel, 'videos', 'vd_aaaaaaaa', 'data.json');
    writeFileSync(target, JSON.stringify({ n: -1, pad: 'x'.repeat(65536) }));
    const writerUrl = pathToFileURL(path.join(coreDir, 'dist', 'store', 'writer.js')).href;
    const script = path.join(t.dir, 'loop.mjs');
    writeFileSync(
      script,
      `import { WriteStore } from ${JSON.stringify(writerUrl)};
const s = new WriteStore(${JSON.stringify(channel)});
for (let n = 0; ; n++) s.write('videos/vd_aaaaaaaa/data.json', JSON.stringify({ n, pad: 'x'.repeat(65536) }), { by: 'kill-test' });
`,
    );
    let maxN = -1;
    for (let i = 0; i < ITER; i++) {
      const child = spawn(process.execPath, [script], { stdio: 'ignore' });
      const exited = new Promise((r) => child.once('exit', r));
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
      child.kill('SIGKILL');
      await exited;
      const data = JSON.parse(readFileSync(target, 'utf8')) as { n: number; pad: string };
      expect(data.pad).toHaveLength(65536);
      maxN = Math.max(maxN, data.n);
    }
    expect(maxN).toBeGreaterThanOrEqual(0); // tiến trình con thực sự đã ghi
  }, 600_000);
});
