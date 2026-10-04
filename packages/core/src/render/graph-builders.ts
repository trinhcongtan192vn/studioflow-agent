import type { Builder, BuilderRegistry, Planner } from '../graph/graph.js';
import { creditsFor, renderVideo } from './render.js';

/** Builder nút `credits` (D4 mục 8.1): `.sf/CREDITS.txt` từ nhạc + asset đã dùng (định dạng 013). */
export function creditsBuilder(deps: { appDataDir?: string }): Builder {
  return async (ctx) => {
    const text = creditsFor(
      { store: ctx.store, appDataDir: deps.appDataDir } as Parameters<typeof creditsFor>[0],
      ctx.videoId,
    );
    const rel = '.sf/CREDITS.txt';
    ctx.store.write(`${ctx.videoRel}/${rel}`, text ? `${text}\n` : '', {
      by: 'graph.build',
      validate: false,
    });
    return { outputs: [rel] };
  };
}

/**
 * Builder nút `render` (chỉ khi được chọn, 020 R4): render nháp từ `index` hiện tại; đầu ra là MP4 của
 * render đó.
 */
export function renderBuilder(deps: { builders: BuilderRegistry; appDataDir?: string }): Builder {
  return async (ctx) => {
    const r = await renderVideo(
      { store: ctx.store, builders: deps.builders, appDataDir: deps.appDataDir },
      ctx.videoId,
      { mode: 'draft' },
      { signal: ctx.signal, skipBuild: true },
    );
    return { outputs: [r.file!], meta: { render_id: r.id } };
  };
}

export const renderPlanner: Planner = () => ({ engine: 'render' });
