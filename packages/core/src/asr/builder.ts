import { readFileSync } from 'node:fs';
import type { ProviderRegistry } from '../capability/registry.js';
import { runCapability } from '../capability/run.js';
import { sha256 } from '../domain/hash.js';
import { Logger } from '../log.js';
import type { Builder } from '../graph/graph.js';
import type { Db } from '../store/db.js';
import type { AsrAlignOutput } from './providers.js';
import { spokenText } from '../tts/spoken.js';
import { alignWords, type TimedWord, asrErrorRate } from './text.js';

export interface AsrLineMeta {
  words: TimedWord[];
  asr_wer: number;
  asr_flag: 'ok' | 'mismatch';
  transcript: string;
}

/**
 * Builder nút `asr.line` (D4 mục 8.1, 010 FR-003): `asr.align` trên audio của line, so với văn bản
 * đã đọc (`tts_text` ?? `text`), mốc cho từ hiển thị.
 */
export function asrLineBuilder(deps: {
  providers: ProviderRegistry;
  db?: Db;
  appDataDir?: string;
  logger?: Logger;
}): Builder {
  const logger = deps.logger ?? new Logger();
  return async (ctx) => {
    const line = ctx.line!;
    const audio = ctx.records[`audio.line:${line.id}`]?.meta as
      { file: string; duration_ms: number } | undefined;
    if (!audio) throw new Error(`no audio for line ${line.id}`);
    const audioRel = `${ctx.videoRel}/${audio.file}`;
    const adapter = await deps.providers.resolve('asr.align', {
      channelDir: ctx.channelDir,
      videoId: ctx.videoId,
      language: ctx.model.language,
      appDataDir: deps.appDataDir,
    });
    const spoken = spokenText(line, ctx.model.lines);
    const r = await runCapability({
      store: ctx.store,
      db: deps.db,
      adapter,
      capability: 'asr.align',
      input: {
        audio: audioRel,
        language: ctx.model.language,
        expected_text: spoken,
        audio_hash: sha256(readFileSync(ctx.store.abs(audioRel))),
      },
      videoId: ctx.videoId,
      outputs: {},
      signal: ctx.signal,
    });
    const out = r.output as AsrAlignOutput;
    const threshold = Number(ctx.model.config(`asr.wer_threshold.${ctx.model.language}`));
    // 038: chấm lại từ transcript (tiếng Việt theo ký tự, quy phụ âm đầu dễ lẫn) — kể cả kết quả cache cũ
    const wer =
      Math.round(asrErrorRate(spoken, out.transcript, ctx.model.language) * 10000) / 10000;
    const flag = wer <= threshold ? 'ok' : 'mismatch';
    logger.write(flag === 'ok' ? 'info' : 'warn', 'sf.asr.line', {
      line_id: line.id,
      wer,
      threshold,
      provider: adapter.manifest.id,
    });
    const meta: AsrLineMeta = {
      words: alignWords(
        line.text,
        spoken === line.text ? undefined : spoken,
        out.words,
        audio.duration_ms,
      ),
      asr_wer: wer,
      asr_flag: flag,
      transcript: out.transcript,
    };
    return { meta };
  };
}
