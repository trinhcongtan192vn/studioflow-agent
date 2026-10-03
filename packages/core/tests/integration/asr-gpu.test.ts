// 010 · SC-001 (nhãn gpu) — OmniVoice đọc câu tiếng Việt, asr.hf-transcribe nghe lại: đúng ≤ ngưỡng, sai > ngưỡng.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import {
  createHfTranscribeProvider,
  createOmniVoiceProvider,
  defaultAppDataDir,
  enginePython,
  Logger,
  whisperCli,
} from '../../src/index.js';
import { describeGpu } from '../../src/testing/gpu.js';
import { tempDir } from '../domain-helpers.js';

const work = tempDir('asr-gpu-');
afterAll(() => work.cleanup());

const SENTENCES = [
  'Bạn có bao giờ tự hỏi vì sao bầu trời lại có màu xanh không?',
  'Ánh sáng mặt trời thật ra là hỗn hợp của nhiều màu sắc khác nhau.',
];

const ready = existsSync(enginePython('omnivoice')) && Boolean(whisperCli());

describeGpu('asr.hf-transcribe on the reference GPU (010 SC-001)', () => {
  it.skipIf(!ready)(
    'WER of correctly read lines ≤ 0.15, of a different text > 0.15',
    async () => {
      process.env.SF_PYTHON_OMNIVOICE ??= enginePython('omnivoice');
      const omni = createOmniVoiceProvider({});
      const asr = createHfTranscribeProvider({ appDataDir: defaultAppDataDir() });
      expect(await asr.health()).toMatchObject({ ok: true });
      const ctx = (dir: string) => ({
        signal: new AbortController().signal,
        workdir: dir,
        progress: () => {},
        logger: new Logger(),
        span: {},
        resolveInput: (p: string) => path.join(work.dir, p),
        secrets: async () => '',
      });
      try {
        for (const [i, text] of SENTENCES.entries()) {
          const dir = path.join(work.dir, `l${i}`);
          const { mkdirSync } = await import('node:fs');
          mkdirSync(dir, { recursive: true });
          await omni.worker.run('auto', { text }, dir, { jobId: `l${i}` });
          const ok = await asr.run(
            { audio: `l${i}/out.wav`, language: 'vi', expected_text: text },
            ctx(dir),
          );
          console.log(`[asr] line ${i} WER ${ok.wer.toFixed(3)} "${ok.transcript}"`);
          expect(ok.wer).toBeLessThanOrEqual(0.15);
          expect(ok.words.length).toBeGreaterThan(5);
          expect(ok.words[0]!.start_ms).toBeLessThan(ok.words.at(-1)!.end_ms);
          const other = SENTENCES[(i + 1) % SENTENCES.length]!;
          const bad = await asr.run(
            { audio: `l${i}/out.wav`, language: 'vi', expected_text: other },
            ctx(dir),
          );
          console.log(`[asr] line ${i} vs other text WER ${bad.wer.toFixed(3)}`);
          expect(bad.wer).toBeGreaterThan(0.15);
        }
      } finally {
        await omni.worker.stop();
      }
    },
    600_000,
  );
});
