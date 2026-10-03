#!/usr/bin/env node
// 001 FR-SC-019 — commit/PR phải ghi số tính năng NNN (constitution Điều XI).
// Dùng: check-commit-msg.mjs <file>  |  check-commit-msg.mjs --range <a..b>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RULE =
  'commit message must reference the feature number NNN (e.g. "feat(core): x (001 FR-SC-008)")';

/** Trả về null nếu hợp lệ, hoặc chuỗi lỗi. */
export function checkMessage(message) {
  const lines = message.split(/\r?\n/).filter((l) => !l.startsWith('#'));
  const subject = lines.find((l) => l.trim() !== '') ?? '';
  if (/^(Merge|Revert) /.test(subject)) return null;
  return /\b\d{3}\b/.test(lines.join('\n')) ? null : RULE;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let failures = [];
  if (args[0] === '--range') {
    const shas = execFileSync('git', ['rev-list', '--no-merges', args[1]], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    for (const sha of shas) {
      const msg = execFileSync('git', ['log', '-1', '--format=%B', sha], { encoding: 'utf8' });
      const err = checkMessage(msg);
      if (err) failures.push(`${sha.slice(0, 8)}: ${err}`);
    }
  } else {
    const err = checkMessage(readFileSync(args[0], 'utf8'));
    if (err) failures = [err];
  }
  for (const f of failures) console.error(`check-commit-msg: ${f}`);
  process.exitCode = failures.length ? 1 : 0;
}
