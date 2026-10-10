import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { ensureOutsideDirs } from '../store/scratch.js';
import { SfError } from '../errors.js';

export interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message: string };
}

/** 095: newline JSON-RPC, without a shell or user configuration. */
export class CodexRpc extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private stopped = false;
  private readonly pending = new Map<
    number,
    {
      resolve: (r: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(command: string, home: string, args?: string[], extraEnv?: Record<string, string>) {
    super();
    ensureOutsideDirs(home);
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter(([name]) =>
        /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP|LANG|HTTPS?_PROXY|NO_PROXY|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS)$/i.test(
          name,
        ),
      ),
    );
    const env: Record<string, string | undefined> = { ...inherited, ...extraEnv, CODEX_HOME: home };
    for (const name of [
      'OPENAI_API_KEY',
      'CODEX_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_ORG_ID',
      'OPENAI_PROJECT_ID',
    ])
      delete env[name];
    this.child = spawn(
      command,
      args ?? [
        'app-server',
        '--listen',
        'stdio://',
        '-c',
        'forced_login_method="chatgpt"',
        '-c',
        'features.shell_tool=false',
        '-c',
        'features.multi_agent=false',
        '-c',
        'features.apply_patch_freeform=false',
        '-c',
        'features.code_mode=false',
        '-c',
        'web_search="disabled"',
        '-c',
        'project_doc_max_bytes=0',
        '-c',
        'apps._default.enabled=false',
        '-c',
        'analytics.enabled=false',
      ],
      { cwd: home, env, windowsHide: true, stdio: 'pipe', shell: false },
    );
    this.child.stderr.resume(); // never expose auth/config data from stderr
    this.child.stdin.on('error', (e) => this.fail(e));
    this.child.on('error', () =>
      this.fail(
        new SfError(
          'E_PROVIDER_UNAVAILABLE',
          'Không khởi động được Codex CLI. Cài Codex CLI hoặc đặt đường dẫn codex.exe trong Cài đặt.',
        ),
      ),
    );
    this.child.on('exit', () =>
      this.fail(new SfError('E_PROVIDER_FAILED', 'Codex app-server đã đóng.')),
    );
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch {
        return;
      }
      if (msg.method) {
        this.emit('message', msg);
        return;
      }
      const pending = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id as number);
      if (msg.error) pending.reject(new SfError('E_PROVIDER_FAILED', msg.error.message));
      else pending.resolve(msg.result);
    });
  }
  private fail(error: Error) {
    if (this.stopped) return;
    this.stopped = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.emit('failure', error);
  }
  write(message: RpcMessage) {
    if (this.stopped) throw new SfError('E_PROVIDER_FAILED', 'Codex app-server is closed');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    if (this.stopped)
      return Promise.reject(new SfError('E_PROVIDER_FAILED', 'Codex app-server is closed'));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SfError('E_PROVIDER_FAILED', `Codex ${method} timed out`));
      }, 30_000);
      this.pending.set(id, { resolve: (r) => resolve(r as T), reject, timer });
      this.write({ id, method, params });
    });
  }
  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'studioflow_agent', title: 'StudioFlow Agent', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.write({ method: 'initialized' });
  }
  close() {
    this.fail(new SfError('E_PROVIDER_FAILED', 'Codex session closed'));
    this.child.stdin.end();
    this.child.kill();
  }
}
