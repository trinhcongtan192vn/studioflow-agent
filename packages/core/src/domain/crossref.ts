import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isSfError } from '../errors.js';
import { parseBlocksDoc } from './markdown/blocks.js';
import { parseScript, toScriptDoc } from './markdown/script.js';
import { parseStoryboard, toStoryboardDoc } from './markdown/storyboard.js';
import type { ValidationError } from './validate.js';

/**
 * Kiểm chéo trong một video (FR-009, D6 gate storyboard): ID duy nhất, tham chiếu tồn tại, mỗi line
 * thuộc đúng một frame, speaker có cast.
 */
export function crossCheckVideo(
  channelDir: string,
  videoId: string,
  /** Nội dung thay cho file trên đĩa (kiểm trước khi ghi), khóa = tên file trong video. */
  overrides: Record<string, string> = {},
): ValidationError[] {
  const dir = path.join(channelDir, 'videos', videoId);
  const read = (f: string) =>
    overrides[f] ??
    (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8') : undefined);
  const errors: ValidationError[] = [];
  const err = (code: ValidationError['code'], message: string, p = '/') =>
    errors.push({ code, path: p, message });
  try {
    const scriptText = read('SCRIPT.md');
    const sbText = read('STORYBOARD.md');
    const script = scriptText ? toScriptDoc(parseScript(scriptText), { loose: true }) : undefined;
    const sb = sbText ? toStoryboardDoc(parseStoryboard(sbText), { loose: true }) : undefined;

    const seen = new Map<string, string>();
    const claim = (id: unknown, where: string) => {
      if (typeof id !== 'string') return;
      const prev = seen.get(id);
      if (prev) err('E_ID_DUPLICATE', `id ${id} is used by ${prev} and ${where}`);
      else seen.set(id, where);
    };
    script?.beats.forEach((b) => claim(b.id, 'SCRIPT.md beat'));
    script?.lines.forEach((l) => claim(l.id, 'SCRIPT.md line'));
    sb?.scenes.forEach((s) => claim(s.id, 'STORYBOARD.md scene'));
    sb?.frames.forEach((f) => {
      claim(f.id, 'STORYBOARD.md frame');
      f.layers?.forEach((l) => claim(l.id, `STORYBOARD.md layer of ${f.id}`));
    });

    if (script) {
      const castIds = new Set<string>();
      const castText = read('CAST.md');
      if (castText) {
        const block = parseBlocksDoc(castText).blocks.find((b) => b.tag === 'sf-cast');
        for (const c of (block?.data as { id?: string }[] | undefined) ?? [])
          if (c?.id) castIds.add(c.id);
      }
      const chars = path.join(channelDir, 'characters');
      if (existsSync(chars)) for (const d of readdirSync(chars)) castIds.add(d);
      script.lines.forEach((l, i) => {
        if (l.speaker !== 'narrator' && !castIds.has(l.speaker)) {
          err(
            'E_ID_UNKNOWN',
            `line ${l.id ?? i} speaker ${l.speaker} has no cast entry`,
            `/lines/${i}/speaker`,
          );
        }
      });
    }

    if (script && sb) {
      const lineIds = new Set(script.lines.map((l) => l.id));
      const beatIds = new Set(script.beats.map((b) => b.id));
      const frameOf = new Map<string, string[]>();
      sb.frames.forEach((f, fi) => {
        (f.line_ids ?? []).forEach((id) => {
          if (!lineIds.has(id))
            err(
              'E_ID_UNKNOWN',
              `frame ${f.id} references unknown line ${id}`,
              `/frames/${fi}/line_ids`,
            );
          frameOf.set(id, [...(frameOf.get(id) ?? []), f.id]);
        });
        (f.beat_ids ?? []).forEach((id) => {
          if (!beatIds.has(id))
            err(
              'E_ID_UNKNOWN',
              `frame ${f.id} references unknown beat ${id}`,
              `/frames/${fi}/beat_ids`,
            );
        });
      });
      for (const l of script.lines) {
        const frames = frameOf.get(l.id) ?? [];
        if (frames.length > 1)
          err('E_ID_DUPLICATE', `line ${l.id} is in more than one frame: ${frames.join(', ')}`);
        if (frames.length === 0)
          err(
            'E_SCHEMA_INVALID',
            `line ${l.id} is not in any frame (each line must belong to exactly one frame)`,
          );
      }
    }
  } catch (e) {
    if (isSfError(e)) err(e.code as ValidationError['code'], e.message);
    else throw e;
  }
  return errors;
}
