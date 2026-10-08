import { existsSync, readFileSync } from 'node:fs';
import type { MusicFindInput } from '../contracts/types.js';
import { parseStoryboard, serializeStoryboard } from '../domain/markdown/storyboard.js';
import { isSfError } from '../errors.js';
import type { TextEmbedder } from '../music/clap.js';
import { findMusicSemantic } from '../music/find.js';
import type { StepExecutorResult, StepRunContext } from './engine.js';

type SceneMusic = 'none' | { track_id?: string; query?: string; volume_db?: number };

/**
 * 085 (FR-WF-85-03): bước `music` do engine chạy, không phiên agent (0 token). Mỗi scene chưa có bài
 * (`track_id`) và không `none`: `music.find` theo `music.query` (thiếu → `mood`) với `min_duration_ms` ≈
 * thời lượng audio; không thấy → thử lại không lọc thời lượng; vẫn không → `music: none`.
 */
export function musicExecutor(d: { appDataDir: string; embedder?: TextEmbedder }) {
  return async (ctx: StepRunContext): Promise<StepExecutorResult> => {
    const rel = `videos/${ctx.videoId}/STORYBOARD.md`;
    const p = parseStoryboard(readFileSync(ctx.store.abs(rel), 'utf8'));
    const metaF = ctx.store.abs(`videos/${ctx.videoId}/audio_meta.json`);
    const total = existsSync(metaF)
      ? Number(
          (JSON.parse(readFileSync(metaF, 'utf8')) as { total_duration_ms?: number })
            .total_duration_ms,
        ) || 0
      : 0;
    const find = async (input: MusicFindInput) => {
      try {
        return (
          await findMusicSemantic(
            {
              channel: ctx.store,
              appDataDir: d.appDataDir,
              ...(d.embedder ? { embedder: d.embedder } : {}),
            },
            input,
          )
        ).results[0]?.track_id;
      } catch (e) {
        if (isSfError(e) && e.code === 'E_MUSIC_NOT_FOUND') return undefined;
        throw e;
      }
    };
    const scenes = p.blocks.filter((b) => b.tag === 'sf-scene');
    let picked = 0;
    let none = 0;
    for (const [i, b] of scenes.entries()) {
      const data = b.data as { music?: SceneMusic; mood?: string; title?: string };
      const m = data.music;
      if (m === 'none' || (m && m.track_id)) continue;
      const query = (m && m.query) || data.mood || '';
      ctx.progress?.(i, scenes.length, `Chọn nhạc cho scene ${i + 1}/${scenes.length}`);
      const base: MusicFindInput = query ? { query } : {};
      const id =
        (total ? await find({ ...base, min_duration_ms: total }) : undefined) ?? (await find(base));
      const value: SceneMusic = id ? { ...(m ?? {}), track_id: id } : 'none';
      if (id) picked++;
      else none++;
      const node = b.doc.createNode(value);
      if (typeof value === 'object') (node as { flow?: boolean }).flow = true;
      b.doc.set('music', node);
      b.docDirty = true;
      b.data = b.doc.toJS();
    }
    if (picked + none) {
      const text = serializeStoryboard(p);
      // storyboard đã duyệt: thêm nhạc không bắt duyệt lại (engine cập nhật hash approval)
      if (ctx.writeKeepingApproval) await ctx.writeKeepingApproval('STORYBOARD.md', text);
      else ctx.store.write(rel, text, { by: `step.${ctx.step.id}` });
    }
    return {
      outputs: ['STORYBOARD.md'],
      summary: picked
        ? `Đã chọn nhạc cho ${picked} scene${none ? `; ${none} scene không có bài phù hợp (không nhạc)` : ''}.`
        : none
          ? 'Kho nhạc không có bài phù hợp — video không có nhạc nền. Nạp nhạc ở tab Nhạc rồi chạy lại bước này.'
          : 'Mọi scene đã có nhạc.',
    };
  };
}
