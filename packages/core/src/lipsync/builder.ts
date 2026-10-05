import { readFileSync } from 'node:fs';
import type { ProviderRegistry } from '../capability/registry.js';
import { runCapability } from '../capability/run.js';
import { sha256 } from '../domain/hash.js';
import type { Builder } from '../graph/graph.js';
import type { Db } from '../store/db.js';
import type { Mouth } from './amplitude.js';

/**
 * Builder nút `lipsync.line` (D4 mục 8.1, 032): cue miệng của line qua capability `lipsync.cues`
 * (mặc định `lipsync.amplitude`) → `lipsync/<ln>.json` (`LipsyncCues`, D3 5.9).
 */
export function lipsyncLineBuilder(deps: {
  providers: ProviderRegistry;
  db?: Db;
  appDataDir?: string;
}): Builder {
  return async (ctx) => {
    const p = ctx.def!.parts as { cast_id: string; fps: number };
    const audio = `${ctx.videoRel}/audio/lines/${ctx.key}.wav`;
    const adapter = await deps.providers.resolve('lipsync.cues', {
      channelDir: ctx.channelDir,
      videoId: ctx.videoId,
      appDataDir: deps.appDataDir,
    });
    const r = await runCapability({
      store: ctx.store,
      db: deps.db,
      adapter,
      capability: 'lipsync.cues',
      input: { audio, fps: p.fps, audio_hash: sha256(readFileSync(ctx.store.abs(audio))) },
      outputs: {},
      videoId: ctx.videoId,
      signal: ctx.signal,
    });
    const doc = {
      schema_version: 1,
      line_id: ctx.key,
      cast_id: p.cast_id,
      fps: p.fps,
      cues: (r.output as { cues: { frame: number; mouth: Mouth }[] }).cues,
    };
    const file = `lipsync/${ctx.key}.json`;
    ctx.store.write(`${ctx.videoRel}/${file}`, `${JSON.stringify(doc)}\n`, { by: 'graph.build' });
    return { outputs: [file] };
  };
}
