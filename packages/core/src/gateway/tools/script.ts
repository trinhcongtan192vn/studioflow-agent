import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionContext } from '../../contracts/types.js';
import { SfError } from '../../errors.js';
import type { ToolDefinition } from '../types.js';

export interface ScriptExecutable {
  cmd: string;
  /** Đối số đặt trước đối số của agent (ví dụ đường dẫn script). */
  prefix: string[];
}

export interface ScriptResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timed_out: boolean;
}

export const SCRIPT_TIMEOUT_MS = 10 * 60_000; // tech-defaults mục 3
export const SCRIPT_MAX_OUTPUT = 1024 * 1024;
/** Proxy chặn mạng của script.run `[chờ S8]`: cổng discard trên loopback → từ chối kết nối. */
export const BLOCKING_PROXY = 'http://127.0.0.1:9';

const sfBin = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'bin',
  'sf.mjs',
);
const executables = new Map<string, ScriptExecutable | undefined>([
  ['sf', { cmd: process.execPath, prefix: [sfBin] }],
]);

/** Đặt đường dẫn chương trình được phép (HyperFrames ghim do 011 cung cấp; test dùng giả). */
export function setScriptExecutable(
  name: 'hyperframes' | 'sf',
  exec: ScriptExecutable | undefined,
): void {
  if (exec === undefined && name === 'sf')
    executables.set('sf', { cmd: process.execPath, prefix: [sfBin] });
  else executables.set(name, exec);
}

/** Lệnh `sf` có ✓ ở cột agent của D4 mục 12. */
const SF_AGENT = new Set([
  'artifact validate',
  'config resolve',
  'graph status',
  'graph plan',
  'channel validate',
]);

const deny = (msg: string) => new SfError('E_SCRIPT_DENIED', msg);

function checkArg(a: string): void {
  if (/[|&;<>$`\r\n]/.test(a))
    throw deny(`argument contains a shell character: ${JSON.stringify(a)}`);
  if (/^[a-zA-Z]:|^[\\/]/.test(a)) throw deny(`absolute paths are not allowed: ${a}`);
  if (a.split(/[\\/]/).includes('..')) throw deny(`".." is not allowed: ${a}`);
}

const pathArgs = (args: string[]) =>
  args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');

/** Luật đối số HyperFrames theo D5 mục 5.2; phiên `frame` chỉ lint/check/snapshot frame của mình. */
function checkHyperframes(args: string[], session: SessionContext): void {
  const [sub, ...rest] = args;
  const outIdx = rest.indexOf('--out');
  const out = outIdx >= 0 ? rest[outIdx + 1] : undefined;
  switch (sub) {
    case 'lint':
    case 'check':
      break;
    case 'snapshot':
      if (out !== undefined && !out.replaceAll('\\', '/').startsWith('.sf/snapshots/')) {
        throw deny('snapshot --out must be under .sf/snapshots/');
      }
      break;
    case 'catalog':
      if (rest[0] !== 'list' && rest[0] !== 'show')
        throw deny('hyperframes catalog allows only list | show <id>');
      break;
    case 'add':
      if (rest.length === 0) throw deny('hyperframes add needs a catalog id');
      break;
    case 'media-treatment':
      if (!rest.includes('--dry-run') && !rest.includes('--apply'))
        throw deny('media-treatment needs --dry-run or --apply');
      break;
    case 'grade-compare':
      break;
    default:
      throw deny(`hyperframes ${sub ?? ''} is not allowed`);
  }
  if (session.kind === 'frame') {
    if (!['lint', 'check', 'snapshot'].includes(sub!))
      throw deny(`frame sessions may only run lint/check/snapshot`);
    const allowed = session.allowed_paths ?? [];
    for (const p of pathArgs(rest)) {
      if (!allowed.includes(p.replaceAll('\\', '/')))
        throw deny(`frame sessions may only target their own frame (${p})`);
    }
  }
}

function minimalEnv(): Record<string, string> {
  const e = process.env;
  const sys = e.SystemRoot ?? 'C:\\Windows';
  const env: Record<string, string> = {
    SystemRoot: sys,
    windir: e.windir ?? sys,
    PATH: [path.dirname(process.execPath), path.join(sys, 'System32')].join(path.delimiter),
    HTTP_PROXY: BLOCKING_PROXY,
    HTTPS_PROXY: BLOCKING_PROXY,
    NO_PROXY: '',
    // 037: `sf`/HyperFrames chạy bằng execPath (electron.exe trong app) → như Node
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  };
  for (const k of ['TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'SF_GPU', 'SF_LLM'] as const)
    if (e[k]) env[k] = e[k]!;
  return env;
}

function run(
  exec: ScriptExecutable,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(exec.cmd, [...exec.prefix, ...args], {
      cwd,
      env: minimalEnv(),
      shell: false,
      windowsHide: true,
    });
    const out = { stdout: '', stderr: '', truncated: false };
    const collect = (key: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const room = SCRIPT_MAX_OUTPUT - out[key].length;
      if (room <= 0) {
        out.truncated = true;
        return;
      }
      const s = chunk.toString('utf8');
      if (s.length > room) out.truncated = true;
      out[key] += s.slice(0, room);
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? new SfError('E_SCRIPT_NOT_FOUND', `${exec.cmd} not found`) : e);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ exit_code: code, ...out, timed_out: timedOut });
    });
  });
}

export const scriptTools: ToolDefinition[] = [
  {
    name: 'script.run',
    description:
      'Chạy một lệnh trong danh sách cho phép (hyperframes lint/check/snapshot/catalog/add/media-treatment/grade-compare; sf artifact validate, config resolve, graph status/plan, channel validate). Không shell, cwd = thư mục video, không mạng.',
    input: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
      },
      required: ['command', 'args'],
      additionalProperties: false,
    },
    async handler(input: { command: string; args: string[] }, ctx) {
      const { command, args } = input;
      if (command !== 'sf' && command !== 'hyperframes')
        throw deny(`command "${command}" is not in the allow-list (D5 5.2)`);
      args.forEach(checkArg);
      if (command === 'sf') {
        if (ctx.session.kind !== 'main')
          throw deny('sf commands are only available to the main session');
        if (!SF_AGENT.has(args.slice(0, 2).join(' ')))
          throw deny(`sf ${args.slice(0, 2).join(' ')} is not available to agents`);
      } else {
        checkHyperframes(args, ctx.session);
      }
      const exec = executables.get(command);
      if (!exec) throw new SfError('E_SCRIPT_NOT_FOUND', `${command} is not installed`);
      const cwd = ctx.session.video_id
        ? ctx.store.abs(`videos/${ctx.session.video_id}`)
        : ctx.store.root;
      return run(exec, args, cwd, ctx.opts.scriptTimeoutMs ?? SCRIPT_TIMEOUT_MS);
    },
  },
];
