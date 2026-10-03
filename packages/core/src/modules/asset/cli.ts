import path from 'node:path';
import { importAsset, searchAssets } from '../../assets/library.js';
import type { CliCommand } from '../../cli/types.js';
import { WriteStore } from '../../store/writer.js';

const list = (v: unknown) =>
  typeof v === 'string' && v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

/** `sf asset import|search` (011 FR-010). */
export const commands: CliCommand[] = [
  {
    module: 'asset',
    name: 'import',
    summary: 'Import a file under uploads/ into the channel asset library (and a video public/)',
    options: {
      channel: { type: 'string', required: true },
      path: { type: 'string', required: true },
      video: { type: 'string' },
      tags: { type: 'string' },
      description: { type: 'string' },
    },
    async run(input, ctx) {
      const store = new WriteStore(path.resolve(ctx.cwd, input.channel as string));
      const tags = list(input.tags);
      return importAsset(store, {
        path: input.path as string,
        ...(tags ? { tags } : {}),
        ...(input.description ? { description: input.description as string } : {}),
        ...(input.video ? { videoId: input.video as string } : {}),
      });
    },
  },
  {
    module: 'asset',
    name: 'search',
    summary: 'Search the channel asset library',
    options: { channel: { type: 'string', required: true }, tags: { type: 'string' } },
    positionals: ['query...'],
    async run(input, ctx) {
      const store = new WriteStore(path.resolve(ctx.cwd, input.channel as string));
      const tags = list(input.tags);
      return searchAssets(store, {
        query: ((input.query as string[] | undefined) ?? []).join(' '),
        ...(tags ? { tags } : {}),
      });
    },
  },
];
