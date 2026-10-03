import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type LlmMode = 'record' | 'replay';

export class LlmFixtureError extends Error {
  constructor(
    readonly code: 'E_LLM_FIXTURE_MISSING' | 'E_LLM_MODE',
    message: string,
  ) {
    super(message);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Khóa bản ghi = sha256 của yêu cầu đã chuẩn hóa thứ tự khóa. */
export function requestKey(request: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(request)))
    .digest('hex');
}

function resolveMode(mode?: string): LlmMode {
  const m = mode ?? process.env.SF_LLM ?? 'replay';
  if (m !== 'record' && m !== 'replay') {
    throw new LlmFixtureError('E_LLM_MODE', `SF_LLM must be "record" or "replay", got "${m}"`);
  }
  return m;
}

/**
 * Gọi LLM theo chế độ D12 mục 2: `replay` (mặc định) chỉ đọc `fixtureDir/<hash>.json`, thiếu → lỗi;
 * `record` gọi thật rồi ghi bản ghi.
 */
export async function llmCall<Req, Res>(
  request: Req,
  real: (req: Req) => Promise<Res>,
  opts: { fixtureDir: string; mode?: LlmMode },
): Promise<Res> {
  const mode = resolveMode(opts.mode);
  const file = path.join(opts.fixtureDir, `${requestKey(request)}.json`);
  if (mode === 'replay') {
    if (!existsSync(file)) {
      throw new LlmFixtureError(
        'E_LLM_FIXTURE_MISSING',
        `no LLM fixture for request (${path.basename(file)}); run with SF_LLM=record`,
      );
    }
    return (JSON.parse(readFileSync(file, 'utf8')) as { response: Res }).response;
  }
  const response = await real(request);
  mkdirSync(opts.fixtureDir, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ request: canonical(request), response }, null, 2)}\n`);
  renameSync(tmp, file);
  return response;
}
