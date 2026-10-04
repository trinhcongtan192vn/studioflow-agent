import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { imageInfo } from '../assets/image-info.js';
import type { ProviderAdapter } from '../capability/types.js';
import { SfError } from '../errors.js';
import { hfInstall } from '../hf/cli.js';
import { loadProviderManifest } from '../providers/manifest.js';
import { killTree } from '../render/hf-render.js';
import type { RemoveBgAdapterInput } from './types.js';

/**
 * `bg.hf-remove-background` (D4 mục 4.3): `hyperframes remove-background` bản ghim → PNG trong suốt
 * (model cục bộ, CPU/CUDA tự chọn). `subject` chỉ để ghi lại; model tự tách chủ thể.
 */
export function createRemoveBgProvider(): ProviderAdapter<
  RemoveBgAdapterInput,
  { file: string; width: number; height: number; alpha: boolean }
> {
  return {
    manifest: loadProviderManifest('bg.hf-remove-background'),
    async health() {
      try {
        return { ok: existsSync(hfInstall().bin) };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },
    cacheKeyParts: (i) => ({ source: i.source.hash, subject: i.subject }),
    async run(input, ctx) {
      const out = path.join(ctx.workdir, 'out.png');
      const { bin } = hfInstall();
      await new Promise<void>((resolve, reject) => {
        const p = spawn(
          process.execPath,
          [bin, 'remove-background', ctx.resolveInput(input.source.path), '-o', out, '--json'],
          {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let err = '';
        p.stderr.on('data', (d: Buffer) => (err += d.toString()));
        p.stdout.on('data', (d: Buffer) => (err += d.toString()));
        const abort = () => p.pid && killTree(p.pid);
        ctx.signal.addEventListener('abort', abort, { once: true });
        p.on('close', (code) => {
          ctx.signal.removeEventListener('abort', abort);
          if (ctx.signal.aborted)
            return reject(new SfError('E_JOB_CANCELED', 'remove-background canceled'));
          if (code === 0 && existsSync(out)) return resolve();
          reject(
            new SfError(
              'E_PROVIDER_FAILED',
              `hyperframes remove-background failed (${code}): ${err.slice(-500)}`,
            ),
          );
        });
      });
      const info = imageInfo(readFileSync(out));
      if (!info) throw new SfError('E_PROVIDER_FAILED', 'remove-background produced no image');
      ctx.progress(1, 1);
      return { file: 'out.png', width: info.width, height: info.height, alpha: info.alpha };
    },
  };
}
