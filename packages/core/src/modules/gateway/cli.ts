import path from 'node:path';
import { usageError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';
import { newId } from '../../domain/ids.js';
import {
  createGateway,
  SESSION_KINDS,
  startHttpGateway,
  type SessionKind,
} from '../../gateway/index.js';

function kindOf(v: unknown): SessionKind {
  const k = (v ?? 'main') as SessionKind;
  if (!SESSION_KINDS.includes(k))
    throw usageError(`--kind must be one of ${SESSION_KINDS.join(', ')}`);
  return k;
}

/** `sf gateway tools|serve` (003 FR-020). */
export const commands: CliCommand[] = [
  {
    module: 'gateway',
    name: 'tools',
    summary: 'List Gateway tools available to a session kind',
    options: { kind: { type: 'string' } },
    async run(input) {
      const kind = kindOf(input.kind);
      return {
        kind,
        tools: createGateway()
          .list(kind)
          .map((t) => t.name),
      };
    },
  },
  {
    module: 'gateway',
    name: 'serve',
    summary: 'Serve the Gateway as MCP Streamable HTTP on 127.0.0.1 (prints url + token)',
    options: {
      channel: { type: 'string', required: true },
      video: { type: 'string' },
      kind: { type: 'string' },
    },
    async run(input, ctx) {
      const kind = kindOf(input.kind);
      const srv = await startHttpGateway(createGateway(), {
        session_id: newId('ss') as `ss_${string}`,
        kind,
        channel_dir: path.resolve(ctx.cwd, input.channel as string),
        ...(input.video ? { video_id: input.video as `vd_${string}` } : {}),
      });
      process.stdout.write(`${JSON.stringify({ url: srv.url, token: srv.token, kind })}\n`);
      await new Promise<void>((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
      await srv.close();
      return { stopped: true };
    },
  },
];
