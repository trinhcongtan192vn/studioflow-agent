import { existsSync, readFileSync } from 'node:fs';
import type { ProviderRegistry } from '../capability/registry.js';
import { cacheDir, cacheKey, cacheKeyParts, runCapability } from '../capability/run.js';
import { sha256 } from '../domain/hash.js';
import { SfError } from '../errors.js';
import type { Builder, Planner } from '../graph/graph.js';
import { readAsrState } from '../asr/state.js';
import { voiceOf } from '../graph/model.js';
import { spokenText } from './spoken.js';
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

/**
 * Giọng theo cảm xúc (FR-VO-05, 031): nhân vật có `emotions[<emotion>]` (ref audio trong kênh) → voice
 * prompt riêng `voices/<vo>/emotions/<emotion>.pt` (tạo một lần bằng `voice.profile`, cache).
 */
export function emotionVoiceRel(castId: string, emotion: string): string {
  return `characters/${castId}/emotions/${emotion.replace(/[^\w-]/g, '_')}.pt`;
}

async function emotionVoice(
  ctx: Parameters<Builder>[0],
  deps: { providers: ProviderRegistry; db?: Db; appDataDir?: string },
  voice: string,
): Promise<{ file: string; hash: string } | undefined> {
  const line = ctx.line!;
  if (!line.emotion || line.speaker === 'narrator') return undefined;
  const ref = ctx.model.cast[line.speaker]?.emotions?.[line.emotion];
  if (!ref) return undefined;
  const rel = emotionVoiceRel(line.speaker, line.emotion);
  if (!existsSync(ctx.store.abs(rel))) {
    const adapter = await deps.providers.resolve('voice.profile', {
      channelDir: ctx.channelDir,
      videoId: ctx.videoId,
      language: ctx.model.language,
      appDataDir: deps.appDataDir,
    });
    await runCapability({
      store: ctx.store,
      db: deps.db,
      adapter,
      capability: 'voice.profile',
      input: { name: `${voice}:${line.emotion}`, language: ctx.model.language, ref_audio: ref },
      outputs: { voice: rel, ref: rel.replace(/\.pt$/, '.wav') },
      signal: ctx.signal,
    });
  }
  const abs = ctx.store.abs(rel);
  return { file: abs, hash: sha256(readFileSync(abs)) };
}

/** Planner `audio.line` (020 R5): engine của provider và trúng cache (khóa như lúc build). */
export function audioLinePlanner(deps: { providers: ProviderRegistry }): Planner {
  return ({ store, model, def }) => {
    const line = def.line!;
    const voice = voiceOf(model, line);
    const id = model.config<string | null>('provider.tts.synthesize');
    let adapter = id ? deps.providers.get(id) : undefined;
    if (!adapter && process.env.SF_GPU === '0')
      adapter = deps.providers
        .forCapability('tts.synthesize')
        .find((a) => a.manifest.id.endsWith('.fake'));
    if (!adapter || !voice) return {};
    const vf = voiceFile(store, voice);
    const regen = readAsrState(model.videoDir).regen[line.id] ?? 0;
    const input = {
      text: spokenText(line, model.lines),
      language: model.language,
      voice_id: voice,
      ...(line.emotion ? { emotion: line.emotion } : {}),
      voice_hash: vf.hash,
      ...(model.voiceSpeed !== 1 ? { speed: model.voiceSpeed } : {}),
      ...(regen ? { seed: regen } : {}),
    };
    const key = cacheKey(cacheKeyParts(adapter, 'tts.synthesize', input, regen || undefined));
    return {
      ...(adapter.manifest.engine ? { engine: adapter.manifest.engine } : {}),
      from_cache: existsSync(store.abs(`${cacheDir(key)}/meta.json`)),
    };
  };
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
    const vf = (await emotionVoice(ctx, deps, voice)) ?? voiceFile(ctx.store, voice);
    const file = `audio/lines/${line.id}.wav`;
    // sinh lại do ASR lệch (010 R3): seed = số lần sinh lại
    const regen = readAsrState(ctx.model.videoDir).regen[line.id] ?? 0;
    const r = await runCapability({
      store: ctx.store,
      db: deps.db,
      adapter,
      capability: 'tts.synthesize',
      input: {
        text: spokenText(line, ctx.model.lines),
        language: ctx.model.language,
        voice_id: voice,
        ...(line.emotion ? { emotion: line.emotion } : {}),
        ...(vf.file ? { voice_file: vf.file } : {}),
        voice_hash: vf.hash,
        ...(ctx.model.voiceSpeed !== 1 ? { speed: ctx.model.voiceSpeed } : {}),
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
