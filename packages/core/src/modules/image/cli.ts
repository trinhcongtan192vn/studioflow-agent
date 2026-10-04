import path from 'node:path';
import type { CliCommand } from '../../cli/types.js';
import { usageError } from '../../cli/errors.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { createCore } from '../../core.js';
import {
  editImage,
  generateImage,
  removeBackground,
  type ImageRunOpts,
} from '../../image/service.js';

const list = (v: unknown) =>
  typeof v === 'string' && v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

const common = {
  channel: { type: 'string' as const, required: true },
  video: { type: 'string' as const },
  seed: { type: 'string' as const },
  tags: { type: 'string' as const },
};

async function withCore<T>(
  input: Record<string, unknown>,
  cwd: string,
  fn: (
    c: ReturnType<typeof createCore>,
    store: ReturnType<ReturnType<typeof createCore>['gateway']['storeFor']>,
    o: ImageRunOpts,
  ) => Promise<T>,
): Promise<T> {
  const appDataDir = defaultAppDataDir();
  const core = createCore({ appDataDir, dbFile: ':memory:', start: false });
  try {
    const store = core.gateway.storeFor(path.resolve(cwd, input.channel as string));
    let last = -1;
    return await fn(core, store, {
      appDataDir,
      ...(input.video ? { videoId: input.video as string } : {}),
      progress: (d, t) => {
        const pct = t ? Math.floor((d / t) * 100) : 0;
        if (pct !== last) process.stderr.write(`\r${pct}%   `);
        last = pct;
      },
    });
  } finally {
    process.stderr.write('\n');
    core.close();
  }
}

/** `sf image generate|edit|remove-bg` (018 FR-008): chạy trực tiếp (không qua hàng đợi). */
export const commands: CliCommand[] = [
  {
    module: 'image',
    name: 'generate',
    summary: 'Generate an image into the channel asset library (--video also copies it to public/)',
    options: {
      ...common,
      width: { type: 'string', required: true },
      height: { type: 'string', required: true },
      transparent: { type: 'boolean' },
      negative: { type: 'string' },
      look: { type: 'string' },
      steps: { type: 'string' },
      ref: { type: 'string' },
    },
    positionals: ['prompt...'],
    async run(input, ctx) {
      const prompt = ((input.prompt as string[] | undefined) ?? []).join(' ').trim();
      if (!prompt) throw usageError('give a prompt');
      return withCore(input, ctx.cwd, (c, store, o) =>
        generateImage(
          { providers: c.providers, db: c.db },
          store,
          {
            prompt,
            width: Number(input.width),
            height: Number(input.height),
            ...(input.transparent ? { transparent: true } : {}),
            ...(input.negative ? { negative_prompt: input.negative as string } : {}),
            ...(input.look ? { look: input.look as string } : {}),
            ...(input.steps ? { steps: Number(input.steps) } : {}),
            ...(input.seed ? { seed: Number(input.seed) } : {}),
            ...(list(input.ref) ? { reference_asset_ids: list(input.ref) } : {}),
            ...(list(input.tags) ? { tags: list(input.tags) } : {}),
          },
          o,
        ),
      );
    },
  },
  {
    module: 'image',
    name: 'edit',
    summary: 'Edit an image asset by instruction (optional --mask, --ref) into a new asset',
    options: {
      ...common,
      source: { type: 'string', required: true },
      mask: { type: 'string' },
      ref: { type: 'string' },
    },
    positionals: ['instruction...'],
    async run(input, ctx) {
      const instruction = ((input.instruction as string[] | undefined) ?? []).join(' ').trim();
      if (!instruction) throw usageError('give an instruction');
      return withCore(input, ctx.cwd, (c, store, o) =>
        editImage(
          { providers: c.providers, db: c.db },
          store,
          {
            source_asset_id: input.source as string,
            instruction,
            ...(input.mask ? { mask_asset_id: input.mask as string } : {}),
            ...(list(input.ref) ? { reference_asset_ids: list(input.ref) } : {}),
            ...(input.seed ? { seed: Number(input.seed) } : {}),
          },
          o,
        ),
      );
    },
  },
  {
    module: 'image',
    name: 'remove-bg',
    summary: 'Remove the background of an image asset into a new transparent asset',
    options: { ...common, source: { type: 'string', required: true }, subject: { type: 'string' } },
    async run(input, ctx) {
      return withCore(input, ctx.cwd, (c, store, o) =>
        removeBackground(
          { providers: c.providers, db: c.db },
          store,
          {
            source_asset_id: input.source as string,
            subject: input.subject === 'person' ? 'person' : 'object',
          },
          o,
        ),
      );
    },
  },
];
