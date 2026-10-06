import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { CastMember } from '../contracts/types.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { SfError } from '../errors.js';
import type { StepExecutor } from './engine.js';
import { loadVideoModel, voiceOf } from '../graph/model.js';
import { registerObjective } from './gates.js';

/**
 * Mỗi người nói trong `SCRIPT.md` có giọng (D6 mục 2 `script` screenplay, FN-031 mục 5): nhân vật có
 * `voice_id` (CAST.md hoặc `characters/<id>/cast.json`), người dẫn có `voice.id`; giọng đã clone
 * (`voices/<vo>/voice.pt`).
 */
export function speakerVoiceProblems(
  channelDir: string,
  videoId: string,
  appDataDir?: string,
): string[] {
  const model = loadVideoModel(channelDir, videoId, appDataDir);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of model.lines) {
    if (seen.has(l.speaker)) continue;
    seen.add(l.speaker);
    const vo = voiceOf(model, l);
    if (!vo)
      out.push(
        `${l.speaker} has no voice (${l.speaker === 'narrator' ? 'voice.id' : 'cast voice_id'})`,
      );
    else if (!existsSync(`${channelDir}/voices/${vo}/voice.pt`))
      out.push(`${l.speaker}: voice ${vo} is not cloned yet (voice.profile_create)`);
  }
  return out;
}

/** Người nói trong `SCRIPT.md` chưa được gán giọng (người dẫn thiếu `voice.id`, nhân vật thiếu `voice_id`). */
export function speakersWithoutVoice(
  channelDir: string,
  videoId: string,
  appDataDir?: string,
): string[] {
  const model = loadVideoModel(channelDir, videoId, appDataDir);
  return [...new Set(model.lines.filter((l) => !voiceOf(model, l)).map((l) => l.speaker))];
}

/** Người nói hợp lệ của kịch bản thoại (036): nhân vật trong CAST.md + nhân vật cấp kênh (id → tên). */
export function castSpeakers(channelDir: string, videoId: string): Record<string, string> {
  const out: Record<string, string> = {};
  const chars = path.join(channelDir, 'characters');
  if (existsSync(chars))
    for (const id of readdirSync(chars)) {
      const f = path.join(chars, id, 'cast.json');
      if (!existsSync(f)) continue;
      const c = JSON.parse(readFileSync(f, 'utf8')) as Partial<CastMember>;
      if (c.id && c.role !== 'narrator') out[c.id] = c.name ?? c.id;
    }
  const castF = path.join(channelDir, 'videos', videoId, 'CAST.md');
  if (existsSync(castF)) {
    const blk = parseBlocksDoc(readFileSync(castF, 'utf8')).blocks.find((b) => b.tag === 'sf-cast');
    for (const c of (blk?.data as Partial<CastMember>[] | undefined) ?? [])
      if (c?.id && c.role !== 'narrator') out[c.id] = c.name ?? c.id;
  }
  return out;
}

registerObjective('speakers_voiced', (g) => {
  const p = speakerVoiceProblems(g.store.root, g.videoId, g.appDataDir);
  return p.length ? { pass: false, detail: p.join('; ') } : { pass: true };
});

/**
 * Executor bước `cast` (D6 mục 2, FN-031 mục 3): giao phiên `main` theo skill, rồi lưu nhân vật cấp kênh
 * `characters/<ca_…>/cast.json` (dùng lại giữa các video; giá trị trong CAST.md ghi đè bản cũ).
 */
export function castExecutor(): StepExecutor {
  return async (ctx) => {
    if (!ctx.agent) throw new SfError('E_STEP_INCOMPLETE', 'cast needs an agent session');
    const out = await ctx.agent();
    const castF = ctx.store.abs(`videos/${ctx.videoId}/CAST.md`);
    if (!existsSync(castF)) throw new SfError('E_STEP_INCOMPLETE', 'CAST.md was not written');
    const blk = parseBlocksDoc(readFileSync(castF, 'utf8')).blocks.find((b) => b.tag === 'sf-cast');
    const saved: string[] = [];
    for (const c of (blk?.data as Partial<CastMember>[] | undefined) ?? []) {
      if (!c?.id || c.role === 'narrator' || !c.name || !c.voice_id) continue;
      const rel = `characters/${c.id}/cast.json`;
      const prev = existsSync(ctx.store.abs(rel))
        ? (JSON.parse(readFileSync(ctx.store.abs(rel), 'utf8')) as Partial<CastMember>)
        : {};
      const member = { reference_images: [], ...prev, ...c, role: 'character' };
      ctx.store.write(rel, `${JSON.stringify(member, null, 2)}\n`, { by: 'cast' });
      saved.push(rel);
    }
    return {
      outputs: out ?? ['CAST.md'],
      ...(saved.length ? { summary: `Lưu ${saved.length} nhân vật cấp kênh.` } : {}),
    };
  };
}
