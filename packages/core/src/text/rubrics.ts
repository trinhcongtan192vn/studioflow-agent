import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { EXTENSIONS_DIR } from '../agent/options.js';
import type { Rubric } from '../contracts/types.js';
import { SfError } from '../errors.js';

/** Rubric theo thứ tự ưu tiên: kênh (`profile/references/rubrics/`) → gói workflow (`rubrics/`) → app (D6 4.3). */
export function loadRubric(id: string, where: { channelDir: string; packDir?: string }): Rubric {
  const candidates = [
    path.join(where.channelDir, 'profile', 'references', 'rubrics', `${id}.yaml`),
    ...(where.packDir ? [path.join(where.packDir, 'rubrics', `${id}.yaml`)] : []),
    path.join(EXTENSIONS_DIR, 'studioflow-core', 'rubrics', `${id}.yaml`),
  ];
  const file = candidates.find((f) => existsSync(f));
  if (!file) throw new SfError('E_ID_UNKNOWN', `rubric ${id} not found`);
  const r = parse(readFileSync(file, 'utf8')) as Rubric;
  const sum = (r.criteria ?? []).reduce((s, c) => s + c.weight, 0);
  if (!r.criteria?.length || Math.abs(sum - 1) > 0.01) {
    throw new SfError('E_SCHEMA_INVALID', `${file}: criteria weights must sum to 1 (got ${sum})`);
  }
  return r;
}

/** Bản rút gọn cho producer: tên tiêu chí + một câu (D6 6.2). */
export const rubricShort = (r: Rubric): string =>
  r.criteria.map((c) => `${c.id}: ${c.prompt}`).join('; ');
