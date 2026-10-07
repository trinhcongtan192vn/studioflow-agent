import path from 'node:path';
import type { ToolPolicy } from '../contracts/types.js';
import type { Gateway } from '../gateway/gateway.js';
import { toMcpName } from '../gateway/mcp.js';
import type { SessionKind } from '../gateway/policy.js';

/** Tool có sẵn của runtime được phép theo loại phiên (D5 mục 4). */
export const RUNTIME_BUILTINS: Record<SessionKind, string[]> = {
  main: ['Read', 'Glob', 'Grep', 'Skill', 'TodoWrite'],
  frame: ['Read', 'Glob', 'Grep', 'Skill', 'TodoWrite'],
  producer: ['Read', 'Glob', 'Grep', 'Skill'],
  critic: [],
  // 055: phiên vận hành chỉ có tool `sf` (không đọc file, không ghi gì)
  ops: [],
};

/** Tool ghi file, chạy lệnh, mạng, sub-agent của runtime — luôn tắt (D5 mục 3.4). */
export const RUNTIME_DISALLOWED = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'BashOutput',
  'KillShell',
  'WebFetch',
  'WebSearch',
  'Task',
];

export const MCP_PREFIX = 'mcp__sf__';

/** `ToolPolicy` (D5 mục 1): built-in theo cột + tool Gateway được phép cho loại phiên. */
export function toolPolicy(kind: SessionKind, gateway: Gateway, readRoots: string[]): ToolPolicy {
  return {
    allowed: [
      ...RUNTIME_BUILTINS[kind],
      ...gateway.list(kind).map((t) => `${MCP_PREFIX}${toMcpName(t.name)}`),
    ],
    readRoots,
  };
}

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

export type CanUseToolFn = (
  name: string,
  input: Record<string, unknown>,
  opts: { signal: AbortSignal },
) => Promise<PermissionDecision>;

const isAbs = (p: string) => /^[a-zA-Z]:|^[\\/]/.test(p);
const hasDotDot = (p: string) => p.split(/[\\/]/).includes('..');

function inside(p: string, roots: string[]): boolean {
  const norm = path.resolve(p).toLowerCase();
  return roots.some((r) => {
    const root = path.resolve(r).toLowerCase();
    return norm === root || norm.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  });
}

/** Phần không chứa ký tự glob ở đầu một mẫu (để kiểm thư mục gốc). */
const globBase = (pattern: string) => pattern.split(/[*?[{]/)[0]!;

function pathProblem(p: unknown, roots: string[]): string | undefined {
  if (typeof p !== 'string' || p === '') return undefined;
  if (hasDotDot(p)) return `".." is not allowed (${p})`;
  if (isAbs(p) && !inside(p, roots)) return `${p} is outside the channel and plugin folders`;
  return undefined;
}

/**
 * `canUseTool` — lớp chính sách đầu (D5 mục 5): tool ngoài policy bị từ chối; Read/Glob/Grep
 * chỉ trong `readRoots`. Gateway vẫn kiểm lại mọi tool `sf` (lớp bắt buộc).
 */
export function makeCanUseTool(policy: ToolPolicy): CanUseToolFn {
  const allowed = new Set(policy.allowed);
  return async (name, input) => {
    if (!allowed.has(name)) {
      return {
        behavior: 'deny',
        message: `E_TOOL_DENIED: tool ${name} is not available in this session; use the sf tools`,
      };
    }
    const candidates =
      name === 'Read'
        ? [input.file_path]
        : name === 'Grep'
          ? [input.path]
          : name === 'Glob'
            ? [
                input.path,
                typeof input.pattern === 'string'
                  ? isAbs(input.pattern)
                    ? globBase(input.pattern)
                    : input.pattern
                  : undefined,
              ]
            : [];
    for (const c of candidates) {
      const problem = pathProblem(c, policy.readRoots);
      if (problem) return { behavior: 'deny', message: `E_PATH_OUTSIDE: ${problem}` };
    }
    return { behavior: 'allow', updatedInput: input };
  };
}
