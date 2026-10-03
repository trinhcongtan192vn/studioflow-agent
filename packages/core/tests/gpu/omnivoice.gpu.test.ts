// 006 · SC-001/002 — OmniVoice thật qua worker + provider + cache (máy tham chiếu).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import {
  createOmniVoiceProvider,
  openDb,
  runCapability,
  WriteStore,
  enginePython,
} from '../../src/index.js';
import { describeGpu } from '../../src/testing/gpu.js';
import { copyChannel, tempDir } from '../domain-helpers.js';

const c = copyChannel();
const t = tempDir('db-');
afterAll(() => {
  c.cleanup();
  t.cleanup();
});

describeGpu('tts.omnivoice (006 SC-001)', () => {
  it.skipIf(!existsSync(enginePython('omnivoice')))(
    'clones a voice and speaks; second run hits the cache',
    async () => {
      const store = new WriteStore(c.dir);
      const db = openDb(path.join(t.dir, 'studioflow.db'));
      const omni = createOmniVoiceProvider();
      try {
        expect(await omni.adapter.health()).toMatchObject({ ok: true });
        // giọng mẫu: auto voice tiếng Việt (research R5)
        const auto = await omni.worker.run(
          'auto',
          { text: 'Xin chào, đây là giọng mẫu để thử nghiệm.' },
          t.dir,
          { jobId: 'auto' },
        );
        store.write('uploads/ref.wav', readFileSync(path.join(t.dir, auto.file as string)), {
          by: 'test',
          validate: false,
        });
        const prof = await runCapability({
          store,
          db,
          adapter: omni.adapter,
          capability: 'voice.profile',
          input: {
            name: 'test',
            language: 'vi',
            ref_audio: 'uploads/ref.wav',
            ref_text: 'Xin chào, đây là giọng mẫu để thử nghiệm.',
          },
          outputs: { voice: 'voices/vo_testtest/voice.pt', ref: 'voices/vo_testtest/ref.wav' },
        });
        expect(prof.from_cache).toBe(false);
        const input = {
          text: 'Năm một nghìn bốn trăm hai mươi tám, Lê Lợi lên ngôi.',
          language: 'vi' as const,
          voice_id: 'vo_testtest' as const,
          voice_file: store.abs('voices/vo_testtest/voice.pt'),
        };
        const a = await runCapability({
          store,
          db,
          adapter: omni.adapter,
          capability: 'tts.synthesize',
          input,
          outputs: { file: 'out/a.wav' },
        });
        const b = await runCapability({
          store,
          db,
          adapter: omni.adapter,
          capability: 'tts.synthesize',
          input,
          outputs: { file: 'out/b.wav' },
        });
        expect(a.from_cache).toBe(false);
        expect(b.from_cache).toBe(true);
        expect((a.output as { rtf: number }).rtf).toBeLessThan(0.5);
        console.log('S1', JSON.stringify(a.output));
      } finally {
        await omni.worker.stop();
        db.close();
      }
    },
    600_000,
  );
});
