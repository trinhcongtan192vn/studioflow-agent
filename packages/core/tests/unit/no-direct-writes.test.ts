// 002 · FR-019 (constitution Điều VI) — chỉ src/store được gọi API ghi của fs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { coreDir } from '../helpers.js';

const WRITE_API =
  /\b(writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|rmSync|rm|unlinkSync|unlink|mkdirSync|mkdir|copyFileSync|copyFile|cpSync|cp|createWriteStream|rmdirSync|openSync|symlinkSync)\s*\(/;

/** Tệp được phép ghi ngoài kênh/video (không phải dữ liệu dự án). */
const ALLOWED = new Set([
  'testing/llm-replay.ts', // fixture test (D12), không phải kênh/video
  'testing/gpu.ts', // khóa GPU giữa các tiến trình test (019), file trong thư mục tạm
  'providers/fake.ts', // chỉ ghi vào RunContext.workdir tạm ngoài project (D4 mục 4.2)
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('single write path (002 FR-019)', () => {
  it('no fs write API outside src/store', () => {
    const src = path.join(coreDir, 'src');
    const offenders = files(src)
      .map((f) => path.relative(src, f).replaceAll('\\', '/'))
      .filter((rel) => !rel.startsWith('store/') && !ALLOWED.has(rel))
      .filter((rel) => WRITE_API.test(readFileSync(path.join(src, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
