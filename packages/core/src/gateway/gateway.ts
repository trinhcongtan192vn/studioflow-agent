import { Ajv, type ValidateFunction } from 'ajv';
import { errorRegistry } from '../contracts/errors.js';
import type { SessionContext, ToolResult } from '../contracts/types.js';
import { isSfError, SfError } from '../errors.js';
import { Logger, type LogSink } from '../log.js';
import { WriteStore } from '../store/writer.js';
import { PermissionBus } from './permission.js';
import { kindsForTool, type SessionKind } from './policy.js';
import type { CallOptions, ToolDefinition } from './types.js';

export interface GatewayOptions {
  /** `%APPDATA%\StudioFlow` (cho tầng cấu hình app). */
  appDataDir?: string;
  /** Thời gian chờ người dùng xác nhận; mặc định 10 phút (tech-defaults mục 3). */
  permissionTimeoutMs?: number;
}

const retryable = new Map<string, boolean>(errorRegistry.errors.map((e) => [e.code, e.retryable]));

/**
 * Capability Gateway (D4 mục 2): registry tool + lớp chính sách bắt buộc (D5 mục 5) + `ToolResult`.
 * Tool của tính năng sau đăng ký bằng `register()`.
 */
export class Gateway {
  readonly permissions: PermissionBus;
  readonly logger = new Logger();
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly validators = new Map<string, ValidateFunction>();
  private readonly stores = new Map<string, WriteStore>();
  private readonly ajv = new Ajv({ allErrors: true, strict: false });

  constructor(readonly opts: GatewayOptions = {}) {
    this.permissions = new PermissionBus({
      timeoutMs: opts.permissionTimeoutMs ?? 10 * 60_000,
      appDataDir: opts.appDataDir,
      storeFor: (dir) => this.storeFor(dir),
    });
  }

  register(def: ToolDefinition): void {
    if (this.tools.has(def.name)) throw new Error(`tool ${def.name} already registered`);
    this.tools.set(def.name, def);
    this.validators.set(def.name, this.ajv.compile(def.input));
  }

  /** Tool được phép cho loại phiên, sắp theo tên. */
  list(kind: SessionKind): ToolDefinition[] {
    return [...this.tools.values()]
      .filter((t) => kindsForTool(t.name).includes(kind))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  storeFor(channelDir: string): WriteStore {
    let s = this.stores.get(channelDir);
    if (!s) {
      s = new WriteStore(channelDir);
      this.stores.set(channelDir, s);
    }
    return s;
  }

  onLog(sink: LogSink): () => void {
    return this.logger.addSink(sink);
  }

  async call(
    session: SessionContext,
    name: string,
    input: unknown,
    opts: CallOptions = {},
  ): Promise<ToolResult<unknown>> {
    const t0 = Date.now();
    let result: ToolResult<unknown>;
    try {
      const def = this.tools.get(name);
      if (!def || !kindsForTool(name).includes(session.kind)) {
        throw new SfError(
          'E_TOOL_DENIED',
          `tool ${name} is not available in a ${session.kind} session`,
        );
      }
      const validate = this.validators.get(name)!;
      if (!validate(input ?? {})) {
        throw new SfError(
          'E_SCHEMA_INVALID',
          `invalid input for ${name}: ${validate.errors?.[0]?.instancePath || '/'} ${validate.errors?.[0]?.message}`,
          validate.errors,
        );
      }
      const data = await def.handler(input ?? {}, {
        session,
        store: this.storeFor(session.channel_dir),
        permissions: this.permissions,
        appDataDir: this.opts.appDataDir,
        opts,
      });
      const jobId = def.returnsJob ? (data as { job_id?: string } | undefined)?.job_id : undefined;
      result = jobId ? { ok: true, data, job_id: jobId } : { ok: true, data };
    } catch (e) {
      if (isSfError(e)) {
        result = {
          ok: false,
          error: {
            code: e.code,
            message: e.message,
            ...(e.details === undefined ? {} : { details: e.details }),
            retryable: retryable.get(e.code) ?? false,
          },
        };
      } else {
        const message = String((e as Error)?.message ?? e).split('\n')[0]!;
        result = { ok: false, error: { code: 'E_INTERNAL', message, retryable: false } };
      }
    }
    this.logger.write(result.ok ? 'info' : 'warn', 'tool.call', {
      tool: name,
      session_id: session.session_id,
      kind: session.kind,
      ok: result.ok,
      ...(result.ok ? {} : { code: result.error.code, message: result.error.message }),
      input: JSON.stringify(input ?? {}).slice(0, 500),
      ms: Date.now() - t0,
    });
    return result;
  }
}
