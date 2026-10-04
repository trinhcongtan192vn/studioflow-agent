// 016 · AC-M1-01 (nghiệm thu thật, máy tham chiếu) — từ ý tưởng tới MP4 phát hành với workflow
// narrated-explainer: Claude thật (refine kịch bản, phiên main cho storyboard/assets/music, phiên frame,
// meta), OmniVoice + Whisper trên GPU, HyperFrames render. Chỉ chạy khi SF_LLM=record và SF_M1_LIVE=1;
// duyệt tự động (người duyệt thật: Tan, trong app).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import {
  CoreHost,
  createOmniVoiceProvider,
  createVideo,
  createVoiceProfile,
  defaultAppDataDir,
  enginePython,
  initChannel,
  parseBlocksDoc,
  serializeBlocksDoc,
  type VideoState,
} from '../../src/index.js';
import { describeLive } from '../../src/testing/live.js';
import { tempDir } from '../domain-helpers.js';

const work = tempDir('m1-');
afterAll(() => {
  if (!process.env.SF_KEEP) work.cleanup();
  else console.log('[m1] kept', work.dir);
});

const REF_TEXT =
  'Xin chào các bạn, hôm nay chúng ta sẽ cùng nhau tìm hiểu một hiện tượng thú vị của thiên nhiên.';

describeLive('M1 acceptance: narrated-explainer from idea to release MP4 (AC-M1-01)', () => {
  it.skipIf(process.env.SF_M1_LIVE !== '1')(
    'produces a release render through all approval points',
    async () => {
      delete process.env.SF_GPU;
      process.env.SF_PYTHON_OMNIVOICE ??= enginePython('omnivoice');
      process.env.HF_HOME ??= path.join(defaultAppDataDir(), 'models', 'hf');
      process.env.SF_LLM_FIXTURES ??= path.join(work.dir, 'llm');
      mkdirSync(process.env.SF_LLM_FIXTURES, { recursive: true });
      // SF_M1_RESUME="<thư mục kênh>|<video>": chạy tiếp lần trước từ bước lỗi (tiết kiệm hạn mức)
      const resume = process.env.SF_M1_RESUME?.split('|');
      const channel = resume?.[0] ?? path.join(work.dir, 'kênh khoa học');
      if (!resume) {
        mkdirSync(channel, { recursive: true });
        initChannel(channel, { name: 'Khoa học vui', language: 'vi' });
      }
      // app-data thật (engine, model đã cài); DB riêng cho lần chạy
      const host = new CoreHost({
        dbFile: path.join(work.dir, 'studioflow.db'),
        permissionTimeoutMs: 600_000,
      });
      const core = host.core;
      core.gateway.permissions.on(
        'permission.requested',
        (r: { request_id: string; summary: string }) => {
          console.log('[m1] permission', r.summary);
          core.gateway.permissions.decide({ request_id: r.request_id, allow: true });
        },
      );
      core.queue.on(
        'job.updated',
        (j: {
          kind: string;
          status: string;
          progress: { done: number; total: number; message?: string };
        }) => {
          if (j.status !== 'running') console.log('[m1] job', j.kind, j.status);
        },
      );
      host.on('event', (n: string, d: { type?: string; name?: string }) => {
        if (n === 'chat.event' && d.type === 'tool_call') console.log('[m1] tool', d.name);
      });
      const t0 = Date.now();
      try {
        const store = core.gateway.storeFor(channel);
        let videoId = resume?.[1] ?? '';
        if (!resume) {
          // giọng kênh
          const omni = createOmniVoiceProvider({});
          const auto = await omni.worker.run('auto', { text: REF_TEXT }, work.dir, {
            jobId: 'ref',
          });
          await omni.worker.stop();
          store.write('uploads/ref.wav', readFileSync(path.join(work.dir, auto.file as string)), {
            by: 'test',
            validate: false,
          });
          const voice = await createVoiceProfile(core, store, {
            name: 'Người dẫn',
            ref_audio: 'uploads/ref.wav',
            language: 'vi',
            ref_text: REF_TEXT,
          });
          await host.call('settings.get', {});
          const ch = JSON.parse(readFileSync(path.join(channel, 'channel.json'), 'utf8'));
          ch.config['voice.id'] = voice.voice_id;
          store.write('channel.json', `${JSON.stringify(ch, null, 2)}\n`, { by: 'test' });

          // brief (pha briefing do test điền thay cho router)
          videoId = createVideo(store, { title: 'Vì sao bầu trời có màu xanh?' }).video_id;
          const briefRel = `videos/${videoId}/BRIEF.md`;
          const brief = parseBlocksDoc(readFileSync(store.abs(briefRel), 'utf8'));
          brief.front = { ...brief.front, target_duration_ms: 45_000 };
          brief.body = [
            '# Brief',
            '',
            'Chủ đề: Vì sao bầu trời ban ngày có màu xanh còn hoàng hôn màu đỏ cam?',
            'Khán giả: học sinh cấp 2 và người lớn tò mò. Thông điệp: tán xạ Rayleigh — ánh sáng bước sóng ngắn bị không khí tán xạ mạnh hơn.',
            'Độ dài: khoảng 45 giây. Giọng văn: thân thiện, rõ ràng.',
            '',
          ];
          store.write(briefRel, serializeBlocksDoc(brief), { by: 'test' });
        }

        const e = host.core.workflows.engine(channel, videoId);
        await host.call('video.open', { channel, video: videoId });
        if (!resume) {
          await host.call('workflow.select', {
            channel,
            video: videoId,
            workflow_id: 'narrated-explainer',
            output_profile: 'yt-1080p30',
          });
        } else {
          const st0 = JSON.parse(
            readFileSync(path.join(channel, 'videos', videoId, 'state.json'), 'utf8'),
          ) as VideoState;
          // SF_M1_WPM: hiệu chuẩn tốc độ đọc của giọng (tầng kênh); SF_M1_REWIND: bước chạy lại
          if (process.env.SF_M1_WPM) {
            const chf = path.join(channel, 'channel.json');
            const chj = JSON.parse(readFileSync(chf, 'utf8'));
            chj.config['script.wpm.vi'] = Number(process.env.SF_M1_WPM);
            store.write(
              'channel.json',
              `${JSON.stringify(chj, null, 2)}
`,
              { by: 'test' },
            );
          }
          const failed =
            process.env.SF_M1_REWIND ??
            Object.entries(st0.steps).find(([, s]) => s.status === 'failed')?.[0];
          if (failed) await e.rewind(failed);
        }
        const state = () =>
          JSON.parse(
            readFileSync(path.join(channel, 'videos', videoId, 'state.json'), 'utf8'),
          ) as VideoState;
        for (let i = 0; i < 20; i++) {
          await e.idle();
          const st = state();
          console.log(
            '[m1]',
            Math.round((Date.now() - t0) / 1000),
            's',
            JSON.stringify(
              Object.fromEntries(Object.entries(st.steps).map(([k, s]) => [k, s.status])),
            ),
          );
          const failed = Object.entries(st.steps).find(([, s]) => s.status === 'failed');
          if (failed)
            throw new Error(`step ${failed[0]} failed: ${JSON.stringify(failed[1].error)}`);
          if (st.steps.render?.status === 'done') break;
          const pending = st.approvals.find((a) => a.status === 'pending');
          if (!pending) throw new Error('stuck without a pending approval');
          console.log('[m1] approve', pending.step_id, pending.note ?? '');
          await host.call('approval.decide', {
            channel,
            video: videoId,
            approval_id: pending.id,
            decision: 'approve',
          });
        }
        const st = state();
        expect(st.steps.render?.status).toBe('done');
        const mp4 = st.steps.render!.outputs!.find((o) => o.endsWith('video.mp4'))!;
        expect(existsSync(path.join(channel, 'videos', videoId, mp4))).toBe(true);
        console.log(
          '[m1] done in',
          Math.round((Date.now() - t0) / 1000),
          's →',
          path.join(channel, 'videos', videoId, mp4),
        );
        console.log('[m1] budget', JSON.stringify(st.budget));
      } finally {
        host.close();
      }
    },
    7_200_000,
  );
});
