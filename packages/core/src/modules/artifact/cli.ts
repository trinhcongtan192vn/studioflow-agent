import { readFileSync } from 'node:fs';
import path from 'node:path';
import { usageError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';
import { artifactKind } from '../../domain/artifacts.js';
import { migrateVideo } from '../../domain/migrate.js';
import { validateArtifact } from '../../domain/validate.js';
import { SfError } from '../../errors.js';
import { WriteStore } from '../../store/writer.js';

/** `sf artifact validate|migrate` (D4 mục 12). */
export const commands: CliCommand[] = [
  {
    module: 'artifact',
    name: 'validate',
    summary: 'Validate an artifact against its schema (D3)',
    positionals: ['path'],
    async run(input, ctx) {
      if (typeof input.path !== 'string') throw usageError('usage: sf artifact validate <path>');
      const abs = path.resolve(ctx.cwd, input.path);
      if (!artifactKind(abs)) throw usageError(`${input.path} is not a known artifact type`);
      const r = validateArtifact(abs, readFileSync(abs, 'utf8'));
      if (!r.valid) {
        const first = r.errors[0]!;
        throw new SfError(
          first.code,
          `${r.errors.length} error(s); first: ${first.message}`,
          r.errors,
        );
      }
      return r;
    },
  },
  {
    module: 'artifact',
    name: 'migrate',
    summary: 'Migrate a video to the current schema versions (backs up first)',
    positionals: ['video_dir'],
    options: { 'dry-run': { type: 'boolean' } },
    async run(input, ctx) {
      if (typeof input.video_dir !== 'string')
        throw usageError('usage: sf artifact migrate <video_dir> [--dry-run]');
      const videoDir = path.resolve(ctx.cwd, input.video_dir);
      const channelDir = path.dirname(path.dirname(videoDir));
      if (path.basename(path.dirname(videoDir)) !== 'videos')
        throw usageError(`${input.video_dir} is not <channel>/videos/<id>`);
      return migrateVideo(new WriteStore(channelDir), path.basename(videoDir), {
        dryRun: input['dry-run'] === true,
      });
    },
  },
];
