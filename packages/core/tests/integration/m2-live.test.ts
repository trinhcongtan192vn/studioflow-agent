// 023 · AC-M2-01 (dạng ngắn, máy tham chiếu) — video tài liệu story-documentary từ brief tới MP4 phát
// hành: Claude thật (refine kịch bản, refine storyboard với phiên producer + critic, phiên frame, meta),
// OmniVoice + Whisper + Qwen-Image-2.1 (ComfyUI) trên GPU, HyperFrames render. Chỉ chạy khi
// SF_LLM=record và SF_M2_LIVE=1; duyệt tự động (bản 8–12 phút thật: Tan, trong app).
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

const work = tempDir('m2-');
afterAll(() => {
  if (!process.env.SF_KEEP) work.cleanup();
  else console.log('[m2] kept', work.dir);
});

const REF_TEXT =
  'Xin chào các bạn, hôm nay chúng ta cùng ngược dòng lịch sử, trở về những năm tháng hào hùng của dân tộc.';

describeLive('M2 acceptance: story-documentary from brief to release MP4 (AC-M2-01 short)', () => {
  it.skipIf(process.env.SF_M2_LIVE !== '1')(
    'produces a release render through all approval points',
    async () => {
      delete process.env.SF_GPU;
      process.env.SF_PYTHON_OMNIVOICE ??= enginePython('omnivoice');
      process.env.HF_HOME ??= path.join(defaultAppDataDir(), 'models', 'hf');
      process.env.SF_LLM_FIXTURES ??= path.join(work.dir, 'llm');
      mkdirSync(process.env.SF_LLM_FIXTURES, { recursive: true });
      // SF_M2_RESUME="<thư mục kênh>|<video>": chạy tiếp lần trước từ bước lỗi (tiết kiệm hạn mức)
      const resume = process.env.SF_M2_RESUME?.split('|');
      const channel = resume?.[0] ?? path.join(work.dir, 'kênh sử việt');
      if (!resume) {
        mkdirSync(channel, { recursive: true });
        initChannel(channel, { name: 'Sử Việt', language: 'vi' });
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
          console.log('[m2] permission', r.summary);
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
          if (j.status !== 'running') console.log('[m2] job', j.kind, j.status);
        },
      );
      host.on('event', (n: string, d: { type?: string; name?: string }) => {
        if (n === 'chat.event' && d.type === 'tool_call') console.log('[m2] tool', d.name);
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
          videoId = createVideo(store, { title: 'Khởi nghĩa Lam Sơn' }).video_id;
          const briefRel = `videos/${videoId}/BRIEF.md`;
          const brief = parseBlocksDoc(readFileSync(store.abs(briefRel), 'utf8'));
          brief.front = { ...brief.front, target_duration_ms: 60_000 };
          brief.body = [
            '# Brief',
            '',
            'Chủ đề: Khởi nghĩa Lam Sơn (1418–1428) do Lê Lợi lãnh đạo, từ dựng cờ ở Lam Sơn tới chiến thắng Chi Lăng – Xương Giang và Bình Ngô đại cáo.',
            'Mốc: 1418 dựng cờ; 1424 tiến vào Nghệ An; 1427 Chi Lăng – Xương Giang; 1428 Bình Ngô đại cáo. Địa danh: Lam Sơn (Thanh Hóa), Chi Lăng, Đông Quan. Nhân vật: Lê Lợi, Nguyễn Trãi.',
            'Khán giả: người yêu lịch sử. Độ dài: khoảng 1 phút, 2 scene. Giọng văn: trang trọng, kể chuyện.',
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
            workflow_id: 'story-documentary',
            output_profile: 'yt-1080p30',
          });
        } else {
          const st0 = JSON.parse(
            readFileSync(path.join(channel, 'videos', videoId, 'state.json'), 'utf8'),
          ) as VideoState;
          // SF_M2_REWIND: bước chạy lại
          const failed =
            process.env.SF_M2_REWIND ??
            Object.entries(st0.steps).find(([, s]) => s.status === 'failed')?.[0];
          if (failed) await e.rewind(failed);
        }
        const state = () =>
          JSON.parse(
            readFileSync(path.join(channel, 'videos', videoId, 'state.json'), 'utf8'),
          ) as VideoState;
        let fixes = 0;
        for (let i = 0; i < 20; i++) {
          await e.idle();
          const st = state();
          console.log(
            '[m2]',
            Math.round((Date.now() - t0) / 1000),
            's',
            JSON.stringify(
              Object.fromEntries(Object.entries(st.steps).map(([k, s]) => [k, s.status])),
            ),
          );
          const failed = Object.entries(st.steps).find(([, s]) => s.status === 'failed');
          // thời lượng đo trên audio thật lệch mục tiêu (D6 4.2): như người dùng — nhờ agent sửa beat
          // lệch trong SCRIPT.md qua chat rồi chạy lại voice (chỉ line đổi được sinh lại)
          if (
            failed?.[0] === 'voice' &&
            /audio_duration/.test(failed[1].error?.message ?? '') &&
            fixes++ < 2
          ) {
            console.log('[m2] fix duration', failed[1].error?.message);
            await host.call('chat.send', {
              channel,
              video: videoId,
              text: `Bước giọng đọc chưa đạt thời lượng: ${failed[1].error?.message}. Hãy sửa SCRIPT.md: rút gọn (hoặc thêm) nội dung ở đúng các beat lệch để tổng thời lượng về gần mục tiêu, giữ nguyên ID line còn dùng. Chỉ sửa SCRIPT.md, không chạy bước nào.`,
            });
            await e.rewind('voice');
            continue;
          }
          if (failed)
            throw new Error(`step ${failed[0]} failed: ${JSON.stringify(failed[1].error)}`);
          if (st.steps.render?.status === 'done') break;
          const pending = st.approvals.find((a) => a.status === 'pending');
          if (!pending) throw new Error('stuck without a pending approval');
          console.log('[m2] approve', pending.step_id, pending.note ?? '');
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
          '[m2] done in',
          Math.round((Date.now() - t0) / 1000),
          's →',
          path.join(channel, 'videos', videoId, mp4),
        );
        console.log('[m2] budget', JSON.stringify(st.budget));
      } finally {
        host.close();
      }
    },
    7_200_000,
  );
});
