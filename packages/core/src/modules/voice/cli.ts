import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { usageError } from '../../cli/errors.js';
import type { CliCommand } from '../../cli/types.js';
import { defaultAppDataDir } from '../../config/resolve.js';
import { createCore } from '../../core.js';
import { createVoiceProfile } from '../../tts/tools.js';

/** `sf voice create --channel <dir> --name <n> --ref <file> --language <vi|de|en>` (006 FR-009). */
export const commands: CliCommand[] = [
  {
    module: 'voice',
    name: 'create',
    summary: 'Clone a channel voice from a 3-10 s reference recording',
    options: {
      channel: { type: 'string', required: true },
      name: { type: 'string', required: true },
      ref: { type: 'string', required: true },
      language: { type: 'string', required: true },
      'ref-text': { type: 'string' },
    },
    async run(input, ctx) {
      if (!['vi', 'de', 'en'].includes(input.language as string))
        throw usageError('--language must be vi, de or en');
      const appDataDir = defaultAppDataDir();
      const core = createCore({ appDataDir, start: false });
      try {
        const store = core.gateway.storeFor(path.resolve(ctx.cwd, input.channel as string));
        // Đưa file mẫu vào uploads/ của kênh qua module ghi (như upload.ingest).
        const ref = path.resolve(ctx.cwd, input.ref as string);
        const upload = `uploads/${randomUUID()}${path.extname(ref) || '.wav'}`;
        store.write(upload, readFileSync(ref), { by: 'upload.ingest', validate: false });
        return await createVoiceProfile({ providers: core.providers, db: core.db }, store, {
          name: input.name as string,
          ref_audio: upload,
          language: input.language as string,
          ...(input['ref-text'] ? { ref_text: input['ref-text'] as string } : {}),
          appDataDir,
        });
      } finally {
        core.close();
      }
    },
  },
];
