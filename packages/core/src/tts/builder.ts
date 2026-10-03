import { existsSync, readFileSync } from 'node:fs';
import type { ProviderRegistry } from '../capability/registry.js';
import { runCapability } from '../capability/run.js';
import { sha256 } from '../domain/hash.js';
import { SfError } from '../errors.js';
import type { Builder } from '../graph/graph.js';
import { readAsrState } from '../asr/state.js';
import { voiceOf } from '../graph/model.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';

/** `voices/<vo>/voice.pt` → đường dẫn tuyệt đối + hash (thiếu → undefined/null). */
export function voiceFile(
  store: WriteStore,
  voiceId: string,
): { file?: string; hash: string | null } {
  const abs = store.abs(`voices/${voiceId}/voice.pt`);
  return existsSync(abs) ? { file: abs, hash: sha256(readFileSync(abs)) } : { hash: null };
}

/** Builder nút `audio.line` (D4 mục 8.1): TTS một line qua provider giải theo D4 mục 4.4. */
export function audioLineBuilder(deps: {
  providers: ProviderRegistry;
  db?: Db;
  appDataDir?: string;
}): Builder {
  return async (ctx) => {
    const line = ctx.line!;
    const voice = voiceOf(ctx.model, line);
    if (!voice) {
      throw new SfError(
        'E_ID_UNKNOWN',
        `line ${line.id} has no voice: set voice.id for the channel/video${line.speaker !== 'narrator' ? ` or voice_id of cast ${line.speaker}` : ''}`,
      );
    }
    const adapter = await deps.providers.resolve('tts.synthesize', {
      channelDir: ctx.channelDir,
      videoId: ctx.videoId,
      language: ctx.model.language,
      appDataDir: deps.appDataDir,
    });
    const vf = voiceFile(ctx.store, voice);
    const file = `audio/lines/${line.id}.wav`;
    // sinh lại do ASR lệch (010 R3): seed = số lần sinh lại
    const regen = readAsrState(ctx.model.videoDir).regen[line.id] ?? 0;
    const r = await runCapability({
      store: ctx.store,
      db: deps.db,
      adapter,
      capability: 'tts.synthesize',
      input: {
        text: line.tts_text ?? line.text,
        language: ctx.model.language,
        voice_id: voice,
        ...(line.emotion ? { emotion: line.emotion } : {}),
        ...(vf.file ? { voice_file: vf.file } : {}),
        voice_hash: vf.hash,
        ...(regen ? { seed: regen } : {}),
      },
      ...(regen ? { seed: regen } : {}),
      videoId: ctx.videoId,
      outputs: { file: `${ctx.videoRel}/${file}` },
      signal: ctx.signal,
    });
    return {
      outputs: [file],
      meta: {
        duration_ms: (r.output as { duration_ms: number }).duration_ms,
        voice_id: voice,
        file,
        content_hash: r.cache_key,
      },
    };
  };
}
