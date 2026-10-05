import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { checkConfigTier } from '../../config/keys.js';
import { artifactSpec } from '../../domain/artifacts.js';
import { crossCheckVideo } from '../../domain/crossref.js';
import { sha256 } from '../../domain/hash.js';
import { parseBlocksDoc } from '../../domain/markdown/blocks.js';
import { assignScriptIds } from '../../domain/markdown/script.js';
import { assignStoryboardIds } from '../../domain/markdown/storyboard.js';
import { assignCastIds } from '../../domain/markdown/cast.js';
import { validateArtifact } from '../../domain/validate.js';
import { validateChannel } from '../../domain/channel-validate.js';
import { SfError } from '../../errors.js';
import { globToRegExp } from '../glob.js';
import { checkOwner, checkWriteScope, sessionPath } from '../session.js';
import type { ToolContext, ToolDefinition } from '../types.js';

export const MAX_READ_BYTES = 1024 * 1024;

function readExisting(ctx: ToolContext, rel: string): Buffer {
  const abs = ctx.store.abs(rel);
  if (!existsSync(abs) || statSync(abs).isDirectory())
    throw new SfError('E_FILE_NOT_FOUND', `${rel} does not exist`);
  if (statSync(abs).size > MAX_READ_BYTES) {
    throw new SfError(
      'E_FILE_TOO_LARGE',
      `${rel} is larger than 1 MB; read a smaller artifact or use a summary`,
    );
  }
  return readFileSync(abs);
}

function isText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  return Buffer.from(buf.toString('utf8'), 'utf8').equals(buf);
}

function schemaVersion(rel: string, text: string): number | undefined {
  const spec = artifactSpec(rel);
  if (!spec) return undefined;
  try {
    const v =
      spec.format === 'json'
        ? JSON.parse(text).schema_version
        : parseBlocksDoc(text).front.schema_version;
    return typeof v === 'number' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** ID đang dùng trong video (để ID mới không trùng, D3 mục 2). */
function takenIds(ctx: ToolContext, videoId: string | undefined): Set<string> {
  const ids = new Set<string>();
  if (!videoId) return ids;
  for (const f of ['SCRIPT.md', 'STORYBOARD.md', 'CAST.md']) {
    const abs = path.join(ctx.store.root, 'videos', videoId, f);
    if (existsSync(abs))
      for (const m of readFileSync(abs, 'utf8').matchAll(/\b[a-z]{2}_[0-9a-z]{8}\b/g))
        ids.add(m[0]);
  }
  return ids;
}

function walk(root: string, rel = ''): string[] {
  const dir = path.join(root, rel);
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return e.name === '.sf' || e.name === 'node_modules' ? [] : walk(root, r);
    return [r];
  });
}

export const artifactTools: ToolDefinition[] = [
  {
    name: 'artifact.read',
    description:
      'Đọc một file trong video hiện tại (hoặc video:<vd>/… nếu được phép). Trả nội dung, hash, schema_version.',
    input: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    async handler(input: { path: string }, ctx) {
      const sp = sessionPath(ctx.session, input.path, 'read');
      const buf = readExisting(ctx, sp.rel);
      if (!isText(buf))
        return { content: buf.toString('base64'), encoding: 'base64', hash: sha256(buf) };
      const text = buf.toString('utf8');
      const v = schemaVersion(sp.rel, text);
      return {
        content: text,
        hash: sha256(text),
        ...(v === undefined ? {} : { schema_version: v }),
      };
    },
  },
  {
    name: 'artifact.write',
    description:
      'Ghi một file trong video hiện tại qua Gateway: kiểm schema, phạm vi, owner, base_hash; gán ID cho line/beat/scene/frame/layer mới.',
    input: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        base_hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    async handler(input: { path: string; content: string; base_hash?: string }, ctx) {
      const sp = sessionPath(ctx.session, input.path, 'write');
      checkWriteScope(ctx.session, sp.inner);
      checkOwner(ctx.store.root, sp);
      const abs = ctx.store.abs(sp.rel);
      const exists = existsSync(abs);
      if (exists && statSync(abs).isDirectory())
        throw new SfError('E_SCHEMA_INVALID', `${sp.inner} is a directory`);
      if (input.base_hash !== undefined) {
        const current = exists ? sha256(readFileSync(abs, 'utf8')) : undefined;
        if (current !== input.base_hash) {
          throw new SfError(
            'E_BASE_HASH_MISMATCH',
            `${sp.inner} changed since it was read (base_hash mismatch); read it again`,
          );
        }
      }
      let content = input.content;
      let assigned: string[] = [];
      const kind = artifactSpec(sp.rel)?.kind;
      if (kind === 'script' || kind === 'storyboard' || kind === 'cast') {
        const fn =
          kind === 'script'
            ? assignScriptIds
            : kind === 'cast'
              ? assignCastIds
              : assignStoryboardIds;
        ({ text: content, assigned } = fn(content, takenIds(ctx, sp.videoId)));
      }
      if (kind === 'channel' || kind === 'state') {
        let obj: Record<string, unknown> | undefined;
        try {
          obj = JSON.parse(content);
        } catch {
          /* schema sẽ báo */
        }
        const cfg = kind === 'channel' ? obj?.config : obj?.config_overrides;
        if (cfg && typeof cfg === 'object')
          checkConfigTier(cfg as Record<string, unknown>, kind === 'channel' ? 'channel' : 'video');
      }
      if (exists && artifactSpec(sp.rel)) {
        const r = validateArtifact(sp.rel, content);
        if (!r.valid)
          throw new SfError(r.errors[0]!.code, `${sp.inner}: ${r.errors[0]!.message}`, r.errors);
      }
      const reason = exists ? ctx.store.protectedReason(sp.rel) : undefined;
      if (reason) {
        const ok = await ctx.permissions.ask(ctx.session, {
          tool: 'artifact.write',
          kind: reason,
          summary:
            reason === 'pinned_frame'
              ? `Ghi đè frame đã ghim ${sp.inner}`
              : `Ghi đè ${sp.inner} đã được duyệt (bản cũ sẽ được sao lưu)`,
        });
        if (!ok)
          throw new SfError('E_PERMISSION_DECLINED', `user declined overwriting ${sp.inner}`);
      }
      const r = ctx.store.write(sp.rel, content, { by: 'artifact.write' });
      // D6 mục 6.3: ghi hồ sơ kênh → kiểm lại (không chặn ghi; agent thấy lỗi để sửa)
      const profileWrite = sp.rel === 'channel.json' || sp.rel.startsWith('profile/');
      return {
        hash: r.hash,
        ...(assigned.length ? { assigned_ids: assigned } : {}),
        ...(profileWrite
          ? { channel_validation: validateChannel(ctx.store.root, { appDataDir: ctx.appDataDir }) }
          : {}),
      };
    },
  },
  {
    name: 'artifact.validate',
    description:
      'Kiểm schema (và kiểm chéo ID với SCRIPT/STORYBOARD) cho file hoặc nội dung đề xuất.',
    input: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    async handler(input: { path: string; content?: string }, ctx) {
      const sp = sessionPath(ctx.session, input.path, 'read');
      const content = input.content ?? readExisting(ctx, sp.rel).toString('utf8');
      const r = validateArtifact(sp.rel, content);
      if (r.valid && sp.videoId && (r.kind === 'script' || r.kind === 'storyboard')) {
        const extra = crossCheckVideo(ctx.store.root, sp.videoId, { [sp.inner]: content });
        return { valid: extra.length === 0, kind: r.kind, errors: extra };
      }
      return r;
    },
  },
  {
    name: 'artifact.list',
    description: 'Liệt kê file trong video hiện tại theo glob (`*`, `**`, `?`); bỏ qua .sf/.',
    input: {
      type: 'object',
      properties: { glob: { type: 'string' } },
      required: ['glob'],
      additionalProperties: false,
    },
    async handler(input: { glob: string }, ctx) {
      const g = input.glob.replaceAll('\\', '/');
      if (g.split('/').includes('..') || /^([a-zA-Z]:|\/)/.test(g)) {
        throw new SfError('E_PATH_OUTSIDE', `glob "${input.glob}" leaves the video`);
      }
      const base = ctx.session.video_id ? `videos/${ctx.session.video_id}` : '.';
      const root = base === '.' ? ctx.store.root : ctx.store.abs(base);
      const re = globToRegExp(g);
      return {
        paths: walk(root)
          .filter((p) => re.test(p))
          .sort(),
      };
    },
  },
];
