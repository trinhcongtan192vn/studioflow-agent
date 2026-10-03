import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXTENSIONS_DIR } from '../agent/options.js';
import { resolveConfig } from '../config/resolve.js';
import { sha256 } from '../domain/hash.js';
import type { StepRunContext } from '../workflow/engine.js';

export const DEFAULT_FRAME_TPL = path.join(EXTENSIONS_DIR, 'studioflow-core', 'hf', 'frame.md.tpl');

/**
 * Executor bước `design-system` (D6 mục 2, D3 5.3): `frame.md` từ `profile/frame.md.tpl` (thay
 * `{{config:<khóa>}}`, `{{channel_name}}`), không có → mẫu của app; front matter `generated_from`.
 */
export function designSystemExecutor() {
  return async (ctx: StepRunContext): Promise<{ outputs: string[] }> => {
    const own = path.join(ctx.channelDir, 'profile', 'frame.md.tpl');
    const tpl = readFileSync(existsSync(own) ? own : DEFAULT_FRAME_TPL, 'utf8');
    const channelJson = readFileSync(path.join(ctx.channelDir, 'channel.json'), 'utf8');
    const name = (JSON.parse(channelJson) as { name: string }).name;
    const body = tpl
      .replace(/\{\{\s*channel_name\s*\}\}/g, name)
      .replace(/\{\{\s*config:([a-z0-9_.<>-]+)\s*\}\}/gi, (_m, key: string) =>
        String(
          resolveConfig(
            key,
            { channelDir: ctx.channelDir, videoId: ctx.videoId },
            { appDataDir: ctx.appDataDir },
          ).value ?? '',
        ),
      );
    const generated = sha256(`${tpl}\n${channelJson}`);
    ctx.store.write(
      `videos/${ctx.videoId}/frame.md`,
      `---\nschema_version: 1\ngenerated_from: ${generated}\n---\n${body}`,
      { by: 'step.design-system' },
    );
    return { outputs: ['frame.md'] };
  };
}
