import path from 'node:path';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { createCore } from '../../core.js';
import { findMusicSemantic } from '../../music/find.js';
import { addTracks, embedMissing } from '../../music/library.js';

const list = (v: unknown) =>
  typeof v === 'string' && v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
const num = (v: unknown) => (v === undefined ? undefined : Number(v));

/** `sf music add|find` (012 FR-006). */
export const commands: CliCommand[] = [
  {
    module: 'music',
    name: 'add',
    summary: 'Add music/SFX files (under uploads/) to the channel or app library and analyze them',
    options: {
      channel: { type: 'string', required: true },
      scope: { type: 'string' },
      kind: { type: 'string' },
      tags: { type: 'string' },
      source: { type: 'string' },
      url: { type: 'string' },
      attribution: { type: 'string' },
    },
    positionals: ['files...'],
    async run(input, ctx) {
      const appDataDir = defaultAppDataDir();
      const core = createCore({ appDataDir, dbFile: ':memory:', start: false });
      try {
        const channel = core.gateway.storeFor(path.resolve(ctx.cwd, input.channel as string));
        const tags = list(input.tags);
        return await addTracks(
          { channel, appDataDir, providers: core.providers },
          {
            files: (input.files as string[] | undefined) ?? [],
            scope: input.scope === 'app' ? 'app' : 'channel',
            ...(input.kind === 'music' || input.kind === 'sfx' ? { kind: input.kind } : {}),
            ...(tags ? { tags } : {}),
            ...(input.source ? { source: input.source as string } : {}),
            ...(input.url ? { url: input.url as string } : {}),
            ...(input.attribution ? { attribution: input.attribution as string } : {}),
          },
        );
      } finally {
        core.close();
      }
    },
  },
  {
    module: 'music',
    name: 'find',
    summary: 'Find music (or --sfx) by tags, BPM, energy, duration and keywords',
    options: {
      channel: { type: 'string', required: true },
      tags: { type: 'string' },
      'bpm-min': { type: 'string' },
      'bpm-max': { type: 'string' },
      'min-duration-ms': { type: 'string' },
      sfx: { type: 'boolean' },
      limit: { type: 'string' },
    },
    positionals: ['query...'],
    async run(input, ctx) {
      const appDataDir = defaultAppDataDir();
      const core = createCore({ appDataDir, dbFile: ':memory:', start: false });
      try {
        const channel = core.gateway.storeFor(path.resolve(ctx.cwd, input.channel as string));
        const tags = list(input.tags);
        const bpmMin = num(input['bpm-min']);
        const bpmMax = num(input['bpm-max']);
        return await findMusicSemantic(
          { channel, appDataDir, ...(core.embedder ? { embedder: core.embedder } : {}) },
          {
            query: ((input.query as string[] | undefined) ?? []).join(' '),
            ...(tags ? { tags } : {}),
            ...(bpmMin !== undefined || bpmMax !== undefined
              ? {
                  bpm: {
                    ...(bpmMin !== undefined ? { min: bpmMin } : {}),
                    ...(bpmMax !== undefined ? { max: bpmMax } : {}),
                  },
                }
              : {}),
            ...(input['min-duration-ms']
              ? { min_duration_ms: Number(input['min-duration-ms']) }
              : {}),
            ...(input.limit ? { limit: Number(input.limit) } : {}),
          },
          input.sfx ? 'sfx' : 'music',
        );
      } finally {
        core.close();
      }
    },
  },
  {
    module: 'music',
    name: 'reindex',
    summary: 'Compute CLAP embeddings for tracks that have none (channel or --scope app)',
    options: { channel: { type: 'string', required: true }, scope: { type: 'string' } },
    async run(input, ctx) {
      const appDataDir = defaultAppDataDir();
      const core = createCore({ appDataDir, dbFile: ':memory:', start: false });
      try {
        const channel = core.gateway.storeFor(path.resolve(ctx.cwd, input.channel as string));
        return await embedMissing(
          { channel, appDataDir, providers: core.providers },
          input.scope === 'app' ? 'app' : 'channel',
        );
      } finally {
        core.close();
      }
    },
  },
];
