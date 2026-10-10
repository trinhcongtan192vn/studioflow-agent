import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { imageInfo } from '../assets/image-info.js';
import { fallbackSettings } from '../agent/fallback-settings.js';
import type { ProviderAdapter } from '../capability/types.js';
import { defaultAppDataDir } from '../config/resolve.js';
import { SfError } from '../errors.js';
import { killTree } from '../render/hf-render.js';
import { loadProviderManifest } from '../providers/manifest.js';
import { writeOutsideProject } from '../store/scratch.js';
import { imageCacheParts, type ImageAdapterInput, type ImageAdapterOutput } from './types.js';

const TIMEOUT_MS = 10 * 60_000;
const LIMIT = /usage limit|rate limit|too many requests|quota|try again (?:in|later)/i;

/** Lời nhờ Codex: đúng một ảnh bằng công cụ tạo ảnh của nó; ảnh nguồn/tham chiếu đính kèm theo thứ tự. */
export function codexImagePrompt(input: ImageAdapterInput, attached: number): string {
  const shape =
    input.width && input.height
      ? input.height > input.width * 1.15
        ? 'portrait (2:3)'
        : input.width > input.height * 1.15
          ? 'landscape (3:2)'
          : 'square (1:1)'
      : 'portrait (2:3)';
  return [
    'Use your image generation tool to create exactly ONE image, then reply with the word DONE only. Do not write files or run commands.',
    attached
      ? input.kind === 'edit'
        ? 'The first attached image is the source: edit it as asked, keep everything not mentioned.'
        : 'The attached image(s) are references: keep the same character identity and the same drawing style.'
      : '',
    `Image: ${input.prompt}`,
    input.negative_prompt ? `Avoid: ${input.negative_prompt}.` : '',
    input.transparent || input.kind === 'edit'
      ? 'Background: fully transparent (PNG with alpha) — only the subject, nothing behind it, no floor, no cast shadow.'
      : '',
    `Format: ${shape}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Ảnh mới nhất Codex lưu cho phiên (`<CODEX_HOME>/generated_images/<session>/…`). */
function newestImage(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir)
    .filter((f) => /\.(png|webp|jpe?g)$/i.test(f))
    .map((f) => path.join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/**
 * `image.codex-plan` (2026-10-10, Tan chọn: chỉ ảnh nhân vật): tạo ảnh bằng công cụ tạo ảnh của Codex CLI đã
 * đăng nhập gói ChatGPT — không gọi API trả phí. `codex exec` không tương tác, đính kèm ảnh tham chiếu; ảnh lấy
 * từ thư mục Codex tự lưu. Hết hạn mức gói → `E_RUNTIME_RATE_LIMIT` (app quay về Qwen).
 */
export function createCodexImageProvider(
  opts: { appDataDir?: string } = {},
): ProviderAdapter<ImageAdapterInput, ImageAdapterOutput> {
  const appDataDir = opts.appDataDir ?? defaultAppDataDir();
  const home = path.join(appDataDir, 'codex');
  return {
    manifest: loadProviderManifest('image.codex-plan'),
    async health() {
      const cmd = fallbackSettings(appDataDir).command;
      if (!path.isAbsolute(cmd) || !existsSync(cmd))
        return { ok: false, detail: 'Codex CLI not found (install the ChatGPT/Codex extension)' };
      if (!existsSync(path.join(home, 'auth.json')))
        return { ok: false, detail: 'Codex is not signed in with ChatGPT' };
      return { ok: true };
    },
    cacheKeyParts: (i) => ({ ...imageCacheParts(i), provider: 'codex-plan' }),
    async run(input, ctx) {
      const files = [...(input.source ? [input.source] : []), ...(input.refs ?? [])].map((f) =>
        ctx.resolveInput(f.path),
      );
      const cmd = fallbackSettings(appDataDir).command;
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter(([k]) =>
          /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP|LANG|HTTPS?_PROXY|NO_PROXY|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS)$/i.test(
            k,
          ),
        ),
      );
      const out = await new Promise<string>((resolve, reject) => {
        const p = spawn(
          cmd,
          [
            'exec',
            '--skip-git-repo-check',
            '--sandbox',
            'read-only',
            '-c',
            'forced_login_method="chatgpt"',
            ...files.flatMap((f) => ['-i', f]),
          ],
          {
            cwd: ctx.workdir,
            windowsHide: true,
            env: { ...inherited, CODEX_HOME: home },
          },
        );
        let log = '';
        p.stdout.on('data', (d: Buffer) => (log += d.toString('utf8')));
        p.stderr.on('data', (d: Buffer) => (log += d.toString('utf8')));
        const kill = () => p.pid && killTree(p.pid);
        const timer = setTimeout(kill, TIMEOUT_MS);
        ctx.signal.addEventListener('abort', kill, { once: true });
        p.on('error', (e) => reject(new SfError('E_PROVIDER_UNAVAILABLE', `codex: ${e.message}`)));
        p.on('close', (code) => {
          clearTimeout(timer);
          ctx.signal.removeEventListener('abort', kill);
          if (ctx.signal.aborted) return reject(new SfError('E_JOB_CANCELED', 'canceled'));
          if (LIMIT.test(log))
            return reject(new SfError('E_RUNTIME_RATE_LIMIT', `codex image: ${log.slice(-300)}`));
          if (code !== 0)
            return reject(
              new SfError('E_PROVIDER_FAILED', `codex exited ${code}: ${log.slice(-400)}`),
            );
          resolve(log);
        });
        p.stdin.end(codexImagePrompt(input, files.length));
      });
      const session = /session id:\s*([0-9a-f-]{20,})/i.exec(out)?.[1];
      const img = session ? newestImage(path.join(home, 'generated_images', session)) : undefined;
      if (!img) throw new SfError('E_PROVIDER_FAILED', `codex made no image: ${out.slice(-300)}`);
      const buf = readFileSync(img);
      writeOutsideProject(path.join(ctx.workdir, 'out.png'), buf);
      const info = imageInfo(buf);
      if (!info) throw new SfError('E_PROVIDER_FAILED', 'codex image is not a readable picture');
      return {
        file: 'out.png',
        width: info.width,
        height: info.height,
        alpha: info.alpha,
        seed: input.seed,
      };
    },
  };
}
