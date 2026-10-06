import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { EXTENSIONS_DIR } from '../agent/options.js';
import { SfError } from '../errors.js';
import { Logger } from '../log.js';
import { sfIdsOf } from './frame-file.js';
import {
  createScratchDir,
  linkOutsideProject,
  unlinkOutsideProject,
  writeOutsideProject,
} from '../store/scratch.js';

const req = createRequire(import.meta.url);

/** Phiên bản HyperFrames ghim (D4 mục 9.1). */
export function pinnedHfVersion(): string {
  const f = path.join(EXTENSIONS_DIR, 'providers', 'hf.cli', 'version.json');
  return (JSON.parse(readFileSync(f, 'utf8')) as { version: string }).version;
}

/** Thư mục gói `hyperframes` đã cài; lệch phiên bản ghim → `E_PROVIDER_UNAVAILABLE`. */
export function hfInstall(): { dir: string; bin: string; version: string } {
  let pkgFile: string;
  try {
    pkgFile = req.resolve('hyperframes/package.json');
  } catch {
    throw new SfError('E_PROVIDER_UNAVAILABLE', 'HyperFrames is not installed (npm install)');
  }
  const version = (JSON.parse(readFileSync(pkgFile, 'utf8')) as { version: string }).version;
  const pinned = pinnedHfVersion();
  if (version !== pinned) {
    throw new SfError(
      'E_PROVIDER_UNAVAILABLE',
      `HyperFrames ${version} is installed but ${pinned} is pinned`,
    );
  }
  const dir = path.dirname(pkgFile);
  return { dir, bin: path.join(dir, 'bin', 'hyperframes.mjs'), version };
}

export interface HfRun {
  code: number | null;
  stdout: string;
  stderr: string;
  /** JSON cuối của stdout khi lệnh có `--json`. */
  json?: Record<string, unknown>;
  /** Bị dừng vì quá `timeoutMs` (037). */
  timedOut?: boolean;
}

function lastJson(stdout: string): Record<string, unknown> | undefined {
  const start = stdout.indexOf('{');
  if (start < 0) return undefined;
  for (let i = start; i >= 0 && i < stdout.length; i = stdout.indexOf('{', i + 1)) {
    try {
      return JSON.parse(stdout.slice(i)) as Record<string, unknown>;
    } catch {
      /* thử vị trí `{` tiếp theo */
    }
  }
  return undefined;
}

/**
 * Chạy `node <bin> <args>` của bản ghim (không `npx`, không mạng), tắt telemetry/cập nhật skill;
 * kiểm `data-sf-id` của các file HTML trong `watch` trước/sau (D4 mục 9.1 → `E_HF_ID_LOST`).
 */
export async function runHf(
  args: string[],
  opts: {
    cwd: string;
    signal?: AbortSignal;
    watch?: string[];
    logger?: Logger;
    timeoutMs?: number;
  },
): Promise<HfRun> {
  const { bin } = hfInstall();
  const before = new Map((opts.watch ?? []).map((f) => [f, sfIdsOf(readSafe(f))]));
  const logger = opts.logger ?? new Logger();
  const t0 = Date.now();
  const r = await new Promise<HfRun>((resolve, reject) => {
    const p = spawn(process.execPath, [bin, ...args], {
      cwd: opts.cwd,
      env: {
        ...process.env,
        HYPERFRAMES_NO_TELEMETRY: '1',
        HYPERFRAMES_SKIP_SKILLS: '1',
        DO_NOT_TRACK: '1',
      },
      windowsHide: true,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          p.kill();
        }, opts.timeoutMs)
      : undefined;
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    p.on('error', (e) =>
      reject(opts.signal?.aborted ? new SfError('E_JOB_CANCELED', 'canceled') : e),
    );
    p.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const json = args.includes('--json') ? lastJson(stdout) : undefined;
      resolve({
        code,
        stdout,
        stderr,
        ...(json ? { json } : {}),
        ...(timedOut ? { timedOut } : {}),
      });
    });
  });
  logger.write(r.code === 0 ? 'info' : 'warn', 'sf.hf.cli', {
    command: args[0],
    code: r.code,
    ms: Date.now() - t0,
  });
  for (const [f, ids] of before) {
    const after = sfIdsOf(readSafe(f));
    const lost = [...ids].filter((id) => !after.has(id));
    if (lost.length)
      throw new SfError(
        'E_HF_ID_LOST',
        `hyperframes ${args[0]} removed data-sf-id ${lost.join(', ')} from ${path.basename(f)}`,
      );
  }
  return r;
}

function readSafe(f: string): string {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return '';
  }
}

export interface HfFinding {
  severity?: string;
  code?: string;
  rule?: string;
  message?: string;
  file?: string;
  selector?: string;
}

/** `hyperframes lint --json` (chỉ đọc). */
export async function hfLint(
  videoDir: string,
  opts: { signal?: AbortSignal; watch?: string[] } = {},
) {
  const r = await runHf(['lint', '--json'], { cwd: videoDir, ...opts, timeoutMs: 120_000 });
  if (!r.json)
    throw new SfError(
      'E_PROVIDER_FAILED',
      `hyperframes lint printed no JSON: ${(r.stderr || r.stdout).slice(-300)}`,
    );
  const j = r.json as {
    ok: boolean;
    errorCount: number;
    warningCount: number;
    findings: HfFinding[];
  };
  return {
    ok: j.ok && j.errorCount === 0,
    errorCount: j.errorCount,
    warningCount: j.warningCount,
    findings: j.findings ?? [],
  };
}

/**
 * Hiệu ứng media (`data-color-grading`, 027) làm Chrome check quá giờ điều hướng (10 s cố định) mà không
 * liên quan lỗi runtime/bố cục/tương phản → check trên bản tạm: HTML đã gỡ thuộc tính, thư mục khác là
 * junction chỉ đọc. Không có hiệu ứng → undefined (check thẳng thư mục video).
 */
function gradedCopy(videoDir: string): { dir: string; dispose(): void } | undefined {
  const html: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(videoDir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.name.endsWith('.html')) html.push(r);
    }
  };
  if (existsSync(path.join(videoDir, 'compositions'))) walk('compositions');
  if (existsSync(path.join(videoDir, 'index.html'))) html.push('index.html');
  const strip = (s: string) => s.replace(/\s+data-color-grading\s*=\s*("[^"]*"|'[^']*')/gi, '');
  if (!html.some((f) => /data-color-grading/i.test(readSafe(path.join(videoDir, f)))))
    return undefined;
  const s = createScratchDir('sf-check-');
  const links: string[] = [];
  for (const e of readdirSync(videoDir, { withFileTypes: true })) {
    if (e.name === 'compositions' || e.name === '.sf') continue;
    const src = path.join(videoDir, e.name);
    if (e.isDirectory()) {
      linkOutsideProject(src, path.join(s.dir, e.name));
      links.push(path.join(s.dir, e.name));
    } else writeOutsideProject(path.join(s.dir, e.name), readFileSync(src));
  }
  for (const f of html)
    writeOutsideProject(path.join(s.dir, f), strip(readFileSync(path.join(videoDir, f), 'utf8')));
  return {
    dir: s.dir,
    dispose() {
      for (const l of links) unlinkOutsideProject(l);
      s.cleanup();
    },
  };
}

/** Thời gian chờ `hyperframes check` theo số frame (037): ≥ 10 phút, 30 s mỗi frame. */
export const checkTimeoutMs = (frames: number) => Math.max(600_000, frames * 30_000);

/** Kết quả `hyperframes check --json` → đạt/lỗi (037: quá thời gian báo rõ; `ok` của JSON quyết định khi có). */
export function checkVerdict(r: HfRun, timeoutMs: number) {
  if (r.timedOut)
    throw new SfError(
      'E_PROVIDER_FAILED',
      `hyperframes check timed out after ${Math.round(timeoutMs / 60_000)} min (video too long or machine busy); run the step again`,
    );
  if (!r.json)
    throw new SfError(
      'E_PROVIDER_FAILED',
      `hyperframes check printed no JSON: ${(r.stderr || r.stdout).slice(-300)}`,
    );
  const j = r.json as Record<string, { errorCount?: number; findings?: HfFinding[] } | unknown>;
  const parts = Object.entries(j).filter(
    ([, v]) => v && typeof v === 'object' && 'errorCount' in (v as object),
  ) as [string, { errorCount: number; findings?: HfFinding[] }][];
  const errors = parts.flatMap(([k, v]) =>
    (v.findings ?? []).filter((f) => f.severity === 'error').map((f) => ({ ...f, pass: k })),
  );
  const errorCount = parts.reduce((s, [, v]) => s + (v.errorCount ?? 0), 0);
  const jsonOk = typeof j.ok === 'boolean' ? j.ok : undefined;
  return { ok: errorCount === 0 && (jsonOk ?? r.code === 0), errorCount, errors, raw: j };
}

/** `hyperframes check --json` (lint + runtime + layout + contrast trong Chrome headless). */
export async function hfCheck(
  videoDir: string,
  opts: { signal?: AbortSignal; watch?: string[]; samples?: number; timeoutMs?: number } = {},
) {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const graded = gradedCopy(videoDir);
  let r: HfRun;
  try {
    r = await runHf(['check', '--json', '--samples', String(opts.samples ?? 5)], {
      cwd: graded?.dir ?? videoDir,
      ...opts,
      ...(graded ? { watch: [] } : {}),
      timeoutMs,
    });
  } finally {
    graded?.dispose();
  }
  return checkVerdict(r, timeoutMs);
}
