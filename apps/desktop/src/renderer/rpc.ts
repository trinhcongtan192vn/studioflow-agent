import type { IpcEvents, IpcMethod, IpcMethods } from '@studioflow/core';

type Handler = (data: unknown) => void;

/** Client JSON-RPC 2.0 renderer → core qua MessagePort (D10 mục 4). Port mới khi core khởi động lại. */
class CoreClient {
  private port?: MessagePort;
  private seq = 0;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error & { code?: string }) => void }
  >();
  private readonly handlers = new Map<string, Set<Handler>>();
  private readyWaiters: (() => void)[] = [];

  constructor() {
    window.addEventListener('message', (ev) => {
      if (ev.data !== 'core-port' || !ev.ports[0]) return;
      this.attach(ev.ports[0]);
    });
  }

  private attach(port: MessagePort): void {
    this.port = port;
    port.onmessage = (m) => {
      const msg = m.data as {
        id?: number;
        result?: unknown;
        error?: { code: string; message: string };
        method?: string;
        params?: unknown;
      };
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error)
          p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) ?? []) h(msg.params);
      }
    };
    port.start();
    for (const w of this.readyWaiters.splice(0)) w();
    for (const h of this.handlers.get('core.ready') ?? []) h(undefined);
  }

  ready(): Promise<void> {
    return this.port ? Promise.resolve() : new Promise((r) => this.readyWaiters.push(r));
  }

  async call<M extends IpcMethod>(
    method: M,
    params: IpcMethods[M]['params'],
  ): Promise<IpcMethods[M]['result']> {
    await this.ready();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.port!.postMessage({ jsonrpc: '2.0', id, method, params });
    });
  }

  on<K extends keyof IpcEvents | 'core.ready'>(
    event: K,
    fn: (data: K extends keyof IpcEvents ? IpcEvents[K] : undefined) => void,
  ): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(fn as Handler);
    this.handlers.set(event, set);
    return () => set.delete(fn as Handler);
  }
}

export const core = new CoreClient();
