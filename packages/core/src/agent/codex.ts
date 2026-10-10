import path from 'node:path';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import type {
  AgentEvent,
  AgentRuntime,
  AgentSession,
  SessionOptions,
  TextGenerateInput,
  TextGenerateOutput,
} from '../contracts/types.js';
import type { Gateway } from '../gateway/gateway.js';
import { toMcpName } from '../gateway/mcp.js';
import { SfError } from '../errors.js';
import { newId } from '../domain/ids.js';
import { agentErrorFrom } from './events.js';
import { renderUserMessage } from './claude.js';
import { CodexRpc, type RpcMessage } from './codex-rpc.js';
import { context, trace, type Span } from '@opentelemetry/api';
import { tracer } from '../trace/trace.js';

/** Read-only equivalent of Claude Read, including symlink confinement. */
export function codexRead(o: SessionOptions, input: unknown): string {
  if (!o.tools.allowed.includes('Read')) throw new SfError('E_TOOL_DENIED', 'Read unavailable');
  const arg = input as { file_path?: string; offset?: number; limit?: number };
  if (!arg || typeof arg.file_path !== 'string')
    throw new SfError('E_SCHEMA_INVALID', 'file_path required');
  const cwd = o.context.video_id
    ? path.join(o.context.channel_dir, 'videos', o.context.video_id)
    : o.context.channel_dir;
  const file = realpathSync.native(path.resolve(cwd, arg.file_path));
  const inside = o.tools.readRoots.some((root) => {
    if (!existsSync(root)) return false;
    const rel = path.relative(realpathSync.native(root), file);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  if (!inside) throw new SfError('E_PATH_OUTSIDE', 'Read outside the channel and app plugins');
  if (statSync(file).size > 2_000_000)
    throw new SfError('E_SCHEMA_INVALID', 'Read text file too large');
  return readFileSync(file, 'utf8')
    .split('\n')
    .slice(
      Math.max(0, (arg.offset ?? 1) - 1),
      Math.max(0, (arg.offset ?? 1) - 1) + Math.min(arg.limit ?? 2000, 4000),
    )
    .join('\n');
}

export interface CodexPlanDeps {
  gateway: Gateway;
  home: string;
  command: () => string;
  model?: () => string;
  /** Test-only local protocol server. */
  args?: string[];
  env?: Record<string, string>;
}

function pluginInstructions(o: SessionOptions): string {
  const parts: string[] = [];
  for (const plugin of o.plugins) {
    const root = path.join(plugin, 'skills');
    const candidates = [
      path.join(plugin, 'SKILL.md'),
      ...(existsSync(root) ? readdirSync(root).map((n) => path.join(root, n, 'SKILL.md')) : []),
    ];
    for (const file of candidates)
      if (existsSync(file))
        parts.push(`\n# App skill: ${file}\n${codexRead(o, { file_path: file, limit: 4000 })}`);
  }
  return parts.join('\n').slice(0, 96_000);
}

/** Codex owns ChatGPT OAuth and refresh; no API-key route exists in this adapter. */
export class CodexPlanRuntime implements AgentRuntime {
  readonly id = 'codex-chatgpt-plan';
  private login?: CodexRpc;
  constructor(readonly deps: CodexPlanDeps) {}
  private async connect() {
    const rpc = new CodexRpc(this.deps.command(), this.deps.home, this.deps.args, this.deps.env);
    try {
      await rpc.initialize();
      return rpc;
    } catch (e) {
      rpc.close();
      throw e;
    }
  }
  private async requirePlan(rpc: CodexRpc) {
    const r = await rpc.request<{ account: { type: string; planType?: string } | null }>(
      'account/read',
      { refreshToken: false },
    );
    if (r.account?.type !== 'chatgpt')
      throw new SfError(
        'E_AUTH_REQUIRED',
        'Đăng nhập ChatGPT ở Cài đặt → Model AI. Fallback không sử dụng API key.',
      );
    return r.account;
  }
  async authStatus(): ReturnType<AgentRuntime['authStatus']> {
    let rpc: CodexRpc | undefined;
    try {
      rpc = await this.connect();
      const account = await this.requirePlan(rpc);
      return { ok: true, method: 'chatgpt-plan', detail: account.planType ?? 'ChatGPT' };
    } catch (e) {
      return { ok: false, method: 'none', detail: (e as Error).message };
    } finally {
      rpc?.close();
    }
  }
  async loginStart(): Promise<{ auth_url: string }> {
    this.login?.close();
    this.login = await this.connect();
    try {
      const r = await this.login.request<{ authUrl: string }>('account/login/start', {
        type: 'chatgpt',
      });
      return { auth_url: r.authUrl };
    } catch (e) {
      this.login.close();
      this.login = undefined;
      throw e;
    }
  }
  async close() {
    this.login?.close();
    this.login = undefined;
  }
  async openSession(o: SessionOptions): Promise<AgentSession & { readonly modelName?: string }> {
    const deps = this.deps;
    const connect = () => this.connect();
    const requirePlan = (client: CodexRpc) => this.requirePlan(client);
    let rpc: CodexRpc | undefined;
    let thread: string | undefined;
    let turn: string | undefined;
    let cancelled = false;
    let closed = false;
    let toolCount = 0;
    let usage = { input_tokens: 0, output_tokens: 0 };
    let modelName: string | undefined;
    let sessionSpan: Span | undefined;
    let queue: (AgentEvent | null)[] = [];
    let wake: (() => void) | undefined;
    const push = (e: AgentEvent | null) => {
      queue.push(e);
      wake?.();
      wake = undefined;
    };
    const tools = deps.gateway
      .list(o.kind)
      .filter((t) => o.tools.allowed.includes(`mcp__sf__${toMcpName(t.name)}`));
    const byName = new Map(tools.map((t) => [toMcpName(t.name), t]));
    const handle = async (m: RpcMessage) => {
      const p = m.params ?? {};
      if (m.id !== undefined && m.method) {
        if (m.method !== 'item/tool/call') {
          rpc?.write({
            id: m.id,
            error: { message: 'E_TOOL_DENIED: only StudioFlow Gateway tools are allowed' },
          });
          return;
        }
        const name = String(p.tool);
        const def = byName.get(name);
        const id = String(p.callId);
        push({ type: 'tool_call', id, name: def?.name ?? name, input: p.arguments });
        if (++toolCount > (o.maxTurns ?? 30)) {
          push({
            type: 'error',
            code: 'E_PROVIDER_FAILED',
            message: 'Codex exceeded the session tool-turn budget',
          });
          push(null);
          rpc?.close();
          rpc = undefined;
          return;
        }
        const allowed = !cancelled;
        let r;
        if (allowed && name === 'Read') {
          try {
            r = { ok: true, data: { text: codexRead(o, p.arguments) } };
          } catch (e) {
            r = {
              ok: false,
              error: {
                code: e instanceof SfError ? e.code : 'E_PROVIDER_FAILED',
                message: (e as Error).message,
              },
            };
          }
        } else
          r =
            allowed && def
              ? await context.with(
                  sessionSpan ? trace.setSpan(context.active(), sessionSpan) : context.active(),
                  () => deps.gateway.call(o.context, def.name, p.arguments ?? {}),
                )
              : {
                  ok: false as const,
                  error: {
                    code: 'E_TOOL_DENIED',
                    message: 'Tool unavailable or turn budget exhausted',
                  },
                };
        if (cancelled || closed) return;
        const text = JSON.stringify(r);
        push({ type: 'tool_result', id, ok: r.ok, summary: text.slice(0, 1000) });
        rpc?.write({
          id: m.id,
          result: { contentItems: [{ type: 'inputText', text }], success: r.ok },
        });
        return;
      }
      if (p.threadId !== thread) return;
      if (m.method === 'item/agentMessage/delta')
        push({ type: 'text_delta', text: String(p.delta ?? '') });
      if (m.method === 'thread/tokenUsage/updated') {
        const u = (p.tokenUsage as { last?: { inputTokens?: number; outputTokens?: number } })
          ?.last;
        usage = { input_tokens: u?.inputTokens ?? 0, output_tokens: u?.outputTokens ?? 0 };
      }
      if (m.method === 'turn/completed') {
        const t = p.turn as {
          status: string;
          error?: { message: string; codexErrorInfo?: unknown };
        };
        push({ type: 'usage', ...usage, cost_usd: 0 });
        if (t.status === 'failed') {
          const message = `Codex: ${t.error?.message ?? 'turn failed'}`;
          const limit =
            /usageLimitExceeded|rate.?limit|usage limit|limit reached|exceeded.*quota/i.test(
              `${message} ${JSON.stringify(t.error?.codexErrorInfo)}`,
            );
          push(
            limit
              ? { type: 'error', code: 'E_RUNTIME_RATE_LIMIT', message }
              : agentErrorFrom(new Error(message)),
          );
        } else
          push({
            type: 'done',
            stop_reason: t.status === 'completed' ? 'end_turn' : 'interrupted',
          });
        push(null);
      }
    };
    return {
      id: o.context.session_id,
      get sdkSessionId() {
        return thread;
      },
      get modelName() {
        return modelName;
      },
      async *send(message) {
        if (closed) return;
        cancelled = false;
        toolCount = 0;
        usage = { input_tokens: 0, output_tokens: 0 };
        queue = [];
        sessionSpan = tracer().startSpan('sf.agent.session', {
          attributes: {
            'gen_ai.system': 'codex',
            'sf.session_kind': o.kind,
            'sf.session_id': o.context.session_id,
          },
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          if (!rpc) {
            rpc = await connect();
            await requirePlan(rpc);
            let selectedModel = deps.model?.() ?? '';
            if (o.kind === 'critic') {
              const catalog = await rpc.request<{
                data: { model: string; isDefault: boolean; hidden: boolean }[];
              }>('model/list', { includeHidden: false, limit: 100 });
              const primaryModel = selectedModel || catalog.data.find((m) => m.isDefault)?.model;
              selectedModel =
                catalog.data.find((m) => !m.hidden && m.model !== primaryModel)?.model ?? '';
              if (!selectedModel)
                throw new SfError(
                  'E_REFINE_SAME_MODEL',
                  'Codex không có model chấm khác model viết.',
                );
            }
            rpc.on('failure', (e: Error) => {
              push(agentErrorFrom(e));
              push(null);
            });
            rpc.on('message', (m: RpcMessage) => {
              void handle(m).catch((e) => {
                push(agentErrorFrom(e));
                push(null);
              });
            });
            const instructions = `${o.systemAppend}\nUse only the supplied StudioFlow tools. All project paths are relative to the channel/video, not cwd. Read project state with artifact.read/list. No shell, file edits, web or subagents.\nChannel: ${o.context.channel_dir}\nVideo: ${o.context.video_id ?? ''}\n${pluginInstructions(o)}`;
            const params = {
              cwd: deps.home,
              approvalPolicy: 'never',
              sandbox: 'read-only',
              baseInstructions: instructions,
              developerInstructions: '',
              environments: [],
              ephemeral: o.kind !== 'main' && o.kind !== 'ops',
              ...(selectedModel ? { model: selectedModel } : {}),
              dynamicTools: [
                ...tools.map((t) => ({
                  type: 'function',
                  name: toMcpName(t.name),
                  description: t.description,
                  inputSchema: t.input,
                })),
                ...(o.tools.allowed.includes('Read')
                  ? [
                      {
                        type: 'function',
                        name: 'Read',
                        description:
                          'Read a text file in the channel or app plugin. Absolute file_path for plugin references.',
                        inputSchema: {
                          type: 'object',
                          properties: {
                            file_path: { type: 'string' },
                            offset: { type: 'integer', minimum: 1 },
                            limit: { type: 'integer', minimum: 1 },
                          },
                          required: ['file_path'],
                          additionalProperties: false,
                        },
                      },
                    ]
                  : []),
              ],
              config: {
                'features.shell_tool': false,
                'features.multi_agent': false,
                web_search: 'disabled',
                project_doc_max_bytes: 0,
              },
            };
            const resume = thread ?? o.resume;
            const r = resume
              ? await rpc.request<{ thread: { id: string }; model?: string }>('thread/resume', {
                  ...params,
                  threadId: resume,
                })
              : await rpc.request<{ thread: { id: string }; model?: string }>(
                  'thread/start',
                  params,
                );
            thread = r.thread.id;
            modelName = r.model ?? selectedModel;
          }
          if (cancelled || closed) return;
          timer = setTimeout(() => {
            push({
              type: 'error',
              code: 'E_PROVIDER_FAILED',
              message: 'Codex turn timed out (10 minutes)',
            });
            push(null);
            rpc?.close();
          }, 600_000);
          const r = await rpc.request<{ turn: { id: string } }>('turn/start', {
            threadId: thread,
            input: [{ type: 'text', text: renderUserMessage(message), text_elements: [] }],
          });
          turn = r.turn.id;
          while (!cancelled) {
            if (!queue.length)
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
            const e = queue.shift();
            if (e === null) break;
            if (e) yield e;
          }
        } catch (e) {
          if (!cancelled && !closed) yield agentErrorFrom(e);
          rpc?.close();
          rpc = undefined;
        } finally {
          if (timer) clearTimeout(timer);
          turn = undefined;
          sessionSpan?.setAttributes({
            'gen_ai.request.model': modelName ?? '',
            'gen_ai.usage.input_tokens': usage.input_tokens,
            'gen_ai.usage.output_tokens': usage.output_tokens,
            'sf.cost_usd': 0,
          });
          sessionSpan?.end();
          sessionSpan = undefined;
        }
      },
      async interrupt() {
        cancelled = true;
        push(null);
        if (rpc && thread && turn)
          await rpc.request('turn/interrupt', { threadId: thread, turnId: turn }).catch(() => {});
        rpc?.close();
        rpc = undefined;
        thread = undefined;
      },
      async close() {
        closed = true;
        cancelled = true;
        push(null);
        rpc?.close();
        rpc = undefined;
      },
    };
  }

  /** 095: same subscription adapter, with no tools, for text.generate/review. */
  async text(input: TextGenerateInput, critic = false): Promise<TextGenerateOutput> {
    const o: SessionOptions = {
      kind: critic ? 'critic' : 'producer',
      context: {
        session_id: newId('ss') as SessionOptions['context']['session_id'],
        kind: critic ? 'critic' : 'producer',
        channel_dir: this.deps.home,
      },
      model: '',
      systemAppend: input.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n'),
      plugins: [],
      tools: { allowed: [], readRoots: [] },
      maxTurns: 1,
      telemetry: { traceparent: '' },
    };
    const s = await this.openSession(o);
    let text = '';
    let usage = { input: 0, output: 0 };
    try {
      for await (const e of s.send({
        text: input.messages
          .filter((m) => m.role !== 'system')
          .map((m) => `[${m.role}] ${m.content}`)
          .join('\n\n'),
      })) {
        if (e.type === 'text_delta') text += e.text;
        if (e.type === 'usage') usage = { input: e.input_tokens, output: e.output_tokens };
        if (e.type === 'error') throw new SfError(e.code, e.message);
      }
      if (!text.trim()) throw new SfError('E_PROVIDER_FAILED', 'Codex returned no text');
      return {
        text,
        usage,
        cost_usd: 0,
        model: `codex/${s.modelName || this.deps.model?.() || 'default'}`,
      };
    } finally {
      await s.close();
    }
  }
}
