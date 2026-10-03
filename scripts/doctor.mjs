#!/usr/bin/env node
// 001 FR-006 — kiểm công cụ nền tảng; báo tên + phiên bản tối thiểu khi thiếu/sai.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REQUIREMENTS = [
  { tool: 'node', args: ['--version'], min: '22.0.0', hint: 'https://nodejs.org (LTS 22)' },
  { tool: 'npm', args: ['--version'], min: '10.0.0', hint: 'đi kèm Node' },
  { tool: 'python', args: ['--version'], min: '3.11.0', hint: 'https://www.python.org' },
  { tool: 'uv', args: ['--version'], min: '0.4.0', hint: 'https://docs.astral.sh/uv/' },
  { tool: 'git', args: ['--version'], min: '2.30.0', hint: 'https://git-scm.com' },
];

export function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : undefined;
}

export function atLeast(found, min) {
  const want = parseVersion(min);
  for (let i = 0; i < 3; i++) {
    if (found[i] !== want[i]) return found[i] > want[i];
  }
  return true;
}

/** Trả về danh sách `{tool, ok, found, min, hint}`; `probe` thay được khi test. */
export function check(requirements = REQUIREMENTS, probe = defaultProbe) {
  return requirements.map((r) => {
    const out = probe(r.tool, r.args);
    const found = parseVersion(out);
    return {
      tool: r.tool,
      ok: Boolean(found && atLeast(found, r.min)),
      found: found ? found.join('.') : null,
      min: r.min,
      hint: r.hint,
    };
  });
}

function defaultProbe(tool, args) {
  const r = spawnSync(tool, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return r.status === 0 ? `${r.stdout}${r.stderr}` : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = check();
  for (const r of results) {
    const status = r.ok ? 'ok ' : 'MISSING';
    const detail = r.found ? `found ${r.found}` : 'not found';
    console.log(
      `${status} ${r.tool.padEnd(7)} ${detail}, need >= ${r.min}${r.ok ? '' : ` — ${r.hint}`}`,
    );
  }
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
