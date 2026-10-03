// 006 · AC-M0-01, AC-M0-02 (qua chat, Claude thật + OmniVoice thật). Chạy khi SF_LLM=record trên máy có GPU.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import {
  createCore,
  createRuntime,
  createOmniVoiceProvider,
  createVoiceProfile,
  enginePython,
  sessionOptionsFor,
  validateArtifact,
  type AgentEvent,
  type Core,
} from '../../src/index.js';
import { describeLive } from '../../src/testing/live.js';
import { coreDir } from '../helpers.js';
import { copyChannel, tempDir } from '../domain-helpers.js';

const ch = copyChannel();
const app = tempDir('app-');
afterAll(() => {
  ch.cleanup();
  app.cleanup();
});

async function chat(core: Core, videoId: string, text: string): Promise<AgentEvent[]> {
  const rt = createRuntime({
    gateway: core.gateway,
    fixtureDir: path.join(coreDir, 'tests', 'fixtures', 'llm', 'm0'),
  });
  const s = await rt.openSession(
    sessionOptionsFor(
      'main',
      { session_id: 'ss_m0accept', kind: 'main', channel_dir: ch.dir, video_id: videoId as never },
      core.gateway,
    ),
  );
  const ev: AgentEvent[] = [];
  for await (const e of s.send({ text })) {
    if (e.type !== 'text_delta')
      console.log('[m0]', new Date().toISOString(), JSON.stringify(e).slice(0, 300));
    ev.push(e);
  }
  await s.close();
  return ev;
}

const REF_TEXT =
  'Xin chào các bạn, hôm nay chúng ta sẽ cùng nhau tìm hiểu một câu chuyện lịch sử thú vị của Việt Nam.';

const READ_ONE =
  'Hãy đọc câu sau bằng giọng của kênh: "Xin chào các bạn, đây là bản thử giọng đọc." ' +
  'Cách làm: ghi SCRIPT.md của video hiện tại thành một beat "Thử" chứa đúng một line của narrator với câu đó, ' +
  'rồi gọi tts.synthesize cho mọi line và chờ job xong. Trả lời ngắn gọn khi xong.';

describeLive('M0 acceptance via chat (006 AC-M0-01/02)', () => {
  it.skipIf(process.env.SF_GPU === '0' || !existsSync(enginePython('omnivoice')))(
    'reading a sentence produces audio + audio_meta.json + provenance; repeating hits the cache',
    async () => {
      // dùng môi trường engine thật đã cài ở %APPDATA%; DB/settings tạm
      process.env.SF_PYTHON_OMNIVOICE ??= enginePython('omnivoice');
      const core = createCore({ appDataDir: app.dir, permissionTimeoutMs: 600_000 });
      core.gateway.permissions.on('permission.requested', (r: { request_id: string }) =>
        core.gateway.permissions.decide({ request_id: r.request_id, allow: true }),
      );
      try {
        // giọng kênh: tạo ref tiếng Việt bằng auto voice của OmniVoice rồi clone (006 research R5)
        const store = core.gateway.storeFor(ch.dir);
        const omni = createOmniVoiceProvider({ appDataDir: app.dir });
        console.log('[m0] auto voice');
        const auto = await omni.worker.run('auto', { text: REF_TEXT }, app.dir, { jobId: 'ref' });
        await omni.worker.stop();
        store.write('uploads/ref.wav', readFileSync(path.join(app.dir, auto.file as string)), {
          by: 'test',
          validate: false,
        });
        console.log('[m0] clone');
        const voice = await createVoiceProfile(core, store, {
          name: 'Thử',
          ref_audio: 'uploads/ref.wav',
          language: 'vi',
          ref_text: REF_TEXT,
          appDataDir: app.dir,
        });
        const chJson = JSON.parse(readFileSync(path.join(ch.dir, 'channel.json'), 'utf8'));
        chJson.config['voice.id'] = voice.voice_id;
        store.write('channel.json', JSON.stringify(chJson, null, 2), { by: 'test' });

        const videoId = 'vd_8m2pq7rt';
        const v = path.join(ch.dir, 'videos', videoId);
        console.log('[m0] chat');
        core.queue.on(
          'job.updated',
          (j: { id: string; kind: string; status: string; progress: unknown }) =>
            console.log('[m0] job', j.id, j.kind, j.status, JSON.stringify(j.progress)),
        );
        const ev = await chat(core, videoId, READ_ONE);
        expect(ev.some((e) => e.type === 'tool_call' && e.name === 'mcp__sf__tts_synthesize')).toBe(
          true,
        );
        const meta = readFileSync(path.join(v, 'audio_meta.json'), 'utf8');
        expect(validateArtifact(`videos/${videoId}/audio_meta.json`, meta).errors).toEqual([]);
        const lines = JSON.parse(meta).lines as { file: string }[];
        expect(lines).toHaveLength(1);
        expect(existsSync(path.join(v, lines[0]!.file))).toBe(true);
        const provs = readdirSync(path.join(v, 'provenance')).map((f) =>
          JSON.parse(readFileSync(path.join(v, 'provenance', f), 'utf8')),
        );
        const first = provs.find(
          (p) => p.output === lines[0]!.file && p.provider === 'tts.omnivoice',
        );
        expect(first).toMatchObject({ from_cache: false });

        // AC-M0-02: cùng câu lần nữa → cache, không gọi OmniVoice
        const say = await import('../../src/tts/tools.js');
        const again = await say.speak(core, store, {
          voice_id: voice.voice_id,
          text: 'Xin chào các bạn, đây là bản thử giọng đọc.',
          appDataDir: app.dir,
        });
        expect(again.from_cache).toBe(true);
      } finally {
        core.close();
      }
    },
    900_000,
  );
});
