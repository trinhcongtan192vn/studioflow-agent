import path from 'node:path';
import { createRuntime } from '../../agent/index.js';
import { sessionOptionsFor } from '../../agent/options.js';
import { usageError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import type { AgentEvent, SessionContext } from '../../contracts/types.js';
import { createCore } from '../../core.js';
import { newId } from '../../domain/ids.js';
import { SfError } from '../../errors.js';
import { SESSION_KINDS, type SessionKind } from '../../gateway/policy.js';

/** `sf agent auth|ask` (005 FR-010). */
export const commands: CliCommand[] = [
  {
    module: 'agent',
    name: 'auth',
    summary: 'Show how the agent runtime is authenticated (no prompt is sent)',
    async run() {
      const core = createCore({
        appDataDir: defaultAppDataDir(),
        dbFile: ':memory:',
        start: false,
      });
      try {
        return await createRuntime({ gateway: core.gateway }).authStatus();
      } finally {
        core.close();
      }
    },
  },
  {
    module: 'agent',
    name: 'ask',
    summary: 'Send one message to an agent session and print its events',
    options: {
      channel: { type: 'string', required: true },
      video: { type: 'string' },
      kind: { type: 'string' },
    },
    positionals: ['text...'],
    async run(input, ctx) {
      const words = input.text as string[] | undefined;
      if (!words?.length)
        throw usageError('usage: sf agent ask --channel <dir> [--video <vd>] <message>');
      const kind = (input.kind ?? 'main') as SessionKind;
      if (!SESSION_KINDS.includes(kind))
        throw usageError(`--kind must be one of ${SESSION_KINDS.join(', ')}`);
      const core = createCore({
        appDataDir: defaultAppDataDir(),
        dbFile: ':memory:',
        start: false,
      });
      try {
        const context: SessionContext = {
          session_id: newId('ss') as SessionContext['session_id'],
          kind,
          channel_dir: path.resolve(ctx.cwd, input.channel as string),
          ...(input.video ? { video_id: input.video as SessionContext['video_id'] & string } : {}),
        };
        const rt = createRuntime({ gateway: core.gateway });
        const session = await rt.openSession(sessionOptionsFor(kind, context, core.gateway));
        const events: AgentEvent[] = [];
        for await (const e of session.send({ text: words.join(' ') })) events.push(e);
        await session.close();
        const err = events.find((e) => e.type === 'error') as
          { code: string; message: string } | undefined;
        if (err && !events.some((e) => e.type === 'done'))
          throw new SfError(err.code, err.message, events);
        return { events };
      } finally {
        core.close();
      }
    },
  },
];
