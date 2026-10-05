import { existsSync, readdirSync } from 'node:fs';
import type { ProviderRegistry } from '../capability/registry.js';
import { runCapability } from '../capability/run.js';
import { newId } from '../domain/ids.js';
import { SfError } from '../errors.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';

/** Thuộc tính giọng theo từ vựng Voice Design của OmniVoice (033 R3). */
export const DESIGN_GENDERS = ['male', 'female'] as const;
export const DESIGN_AGES = ['child', 'teenager', 'young adult', 'middle-aged', 'elderly'] as const;
export const DESIGN_PITCHES = ['very low', 'low', 'moderate', 'high', 'very high'] as const;
export const DESIGN_ACCENTS = [
  'american',
  'australian',
  'british',
  'canadian',
  'chinese',
  'indian',
  'japanese',
  'korean',
  'portuguese',
  'russian',
] as const;

export interface VoiceDesignAttrs {
  gender: (typeof DESIGN_GENDERS)[number];
  age: (typeof DESIGN_AGES)[number];
  pitch: (typeof DESIGN_PITCHES)[number];
  whisper?: boolean;
  /** Chỉ có tác dụng với tiếng Anh. */
  accent?: (typeof DESIGN_ACCENTS)[number];
}

/** Ghép `instruct` cho OmniVoice: "female, young adult, moderate pitch[, whisper][, british accent]". */
export function designInstruct(a: VoiceDesignAttrs, language: string): string {
  if (a.accent && language !== 'en')
    throw new SfError(
      'E_SCHEMA_INVALID',
      `accent only applies to English voices (channel language is ${language})`,
    );
  return [
    a.gender,
    a.age,
    `${a.pitch} pitch`,
    ...(a.whisper ? ['whisper'] : []),
    ...(a.accent ? [`${a.accent} accent`] : []),
  ].join(', ');
}

/** Câu mẫu ~6–9 giây đọc (đủ 3–10 s cho clone) theo ngôn ngữ kênh. */
const SAMPLES: Record<string, string> = {
  vi: 'Xin chào các bạn. Đây là giọng đọc gợi ý cho kênh của bạn. Hãy nghe thử xem giọng này có hợp với nội dung video hay không nhé.',
  de: 'Hallo zusammen. Das ist eine vorgeschlagene Stimme für deinen Kanal. Hör sie dir an und entscheide, ob sie zu deinen Videos passt.',
  en: 'Hello everyone. This is a suggested narration voice for your channel. Have a listen and decide whether it suits your videos.',
};
export function defaultSampleText(language: string): string {
  return SAMPLES[language] ?? SAMPLES.en!;
}

export interface DesignedVoice {
  voice_id: string;
  name: string;
  files: string[];
  /** Câu mẫu để nghe thử (tương đối kênh). */
  preview: string;
  design: { instruct: string; seed: number };
  for?: string;
}

/**
 * Giọng gợi ý (033 R2): provider sinh câu mẫu theo `instruct` rồi clone câu đó → `voices/<vo>/`
 * như giọng clone từ file mẫu, nên mọi line dùng cùng một giọng ổn định.
 */
export async function createDesignedVoice(
  s: { providers: ProviderRegistry; db?: Db },
  store: WriteStore,
  input: VoiceDesignAttrs & {
    name: string;
    language: string;
    sample_text?: string;
    seed?: number;
    for?: string;
    appDataDir?: string;
  },
  opts: { signal?: AbortSignal; progress?: (d: number, t: number) => void } = {},
): Promise<DesignedVoice> {
  const instruct = designInstruct(input, input.language);
  const sample = input.sample_text?.trim() || defaultSampleText(input.language);
  const seed = input.seed ?? 0;
  const voicesDir = store.abs('voices');
  const voiceId = newId('vo', new Set(existsSync(voicesDir) ? readdirSync(voicesDir) : []));
  const adapter = await s.providers.resolve('voice.design', {
    channelDir: store.root,
    language: input.language,
    appDataDir: input.appDataDir,
  });
  const base = `voices/${voiceId}`;
  const r = await runCapability({
    store,
    db: s.db,
    adapter,
    capability: 'voice.design',
    input: { name: input.name, language: input.language, instruct, sample_text: sample, seed },
    outputs: { voice: `${base}/voice.pt`, ref: `${base}/ref.wav` },
    signal: opts.signal,
    progress: opts.progress,
  });
  const design = { instruct, seed };
  store.write(
    `${base}/profile.json`,
    `${JSON.stringify(
      {
        voice_id: voiceId,
        name: input.name,
        language: input.language,
        ref_text: (r.output as { ref_text?: string }).ref_text ?? sample,
        provider: adapter.manifest.id,
        created_at: new Date().toISOString(),
        design,
        ...(input.for ? { suggested_for: input.for } : {}),
      },
      null,
      2,
    )}\n`,
    { by: 'voice.design' },
  );
  return {
    voice_id: voiceId,
    name: input.name,
    files: ['voice.pt', 'ref.wav', 'profile.json'].map((f) => `${base}/${f}`),
    preview: `${base}/ref.wav`,
    design,
    ...(input.for ? { for: input.for } : {}),
  };
}
