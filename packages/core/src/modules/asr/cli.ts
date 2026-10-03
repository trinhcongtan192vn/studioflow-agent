import path from 'node:path';
import { acceptLines, alignVideo } from '../../asr/regen.js';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { createCore } from '../../core.js';

const lines = (v: unknown) =>
  typeof v === 'string' && v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

/** `sf asr align|accept` (010 FR-008). */
export const commands: CliCommand[] = [
  {
    module: 'asr',
    name: 'align',
    summary: 'Check TTS lines with ASR, regenerate misread lines, rebuild caption groups',
    options: {
      channel: { type: 'string', required: true },
      video: { type: 'string', required: true },
      lines: { type: 'string' },
    },
    async run(input, ctx) {
      const appDataDir = defaultAppDataDir();
      const core = createCore({ appDataDir, dbFile: ':memory:', start: false });
      try {
        const store = core.gateway.storeFor(path.resolve(ctx.cwd, input.channel as string));
        const ids = lines(input.lines);
        return await alignVideo(
          { store, builders: core.graph, appDataDir },
          input.video as string,
          ids ? { lineIds: ids } : {},
        );
      } finally {
        core.close();
      }
    },
  },
  {
    module: 'asr',
    name: 'accept',
    summary: 'Accept the current audio of lines flagged as ASR mismatch',
    options: {
      channel: { type: 'string', required: true },
      video: { type: 'string', required: true },
      lines: { type: 'string', required: true },
    },
    async run(input, ctx) {
      const appDataDir = defaultAppDataDir();
      const core = createCore({ appDataDir, dbFile: ':memory:', start: false });
      try {
        const store = core.gateway.storeFor(path.resolve(ctx.cwd, input.channel as string));
        return await acceptLines(
          { store, builders: core.graph, appDataDir },
          input.video as string,
          lines(input.lines) ?? [],
        );
      } finally {
        core.close();
      }
    },
  },
];
