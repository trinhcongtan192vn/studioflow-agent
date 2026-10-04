import { BuildGraph, loadVideoModel, WriteStore } from '../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId } from './domain-helpers.js';

export const V = `videos/${fixtureVideoId}`;

/** Kênh mẫu + build graph với builder giả cho audio.line/asr.line/captions/index. */
export function graphFixture(opts: { failAudio?: string; withAsr?: boolean } = {}) {
  const c = copyChannel();
  const store = new WriteStore(c.dir);
  const graph = new BuildGraph({ store, appDataDir: fixtureAppData });
  const calls: string[] = [];
  graph.registerBuilder('audio.line', async (ctx) => {
    calls.push(ctx.nodeId);
    if (ctx.key === opts.failAudio) throw new Error('tts crashed');
    const file = `audio/lines/${ctx.key}.wav`;
    ctx.store.write(`${ctx.videoRel}/${file}`, Buffer.from(`wav:${ctx.line!.text}`), {
      by: 'test',
    });
    return {
      outputs: [file],
      meta: {
        duration_ms: ctx.line!.text.length * 50,
        voice_id: 'vo_c3z8p1mn',
        file,
        content_hash: ctx.inputHash,
      },
    };
  });
  if (opts.withAsr !== false) {
    graph.registerBuilder('asr.line', async (ctx) => {
      calls.push(ctx.nodeId);
      const words = ctx
        .line!.text.split(/\s+/)
        .map((text, i) => ({ i, text, start_ms: i * 100, end_ms: i * 100 + 90 }));
      return { meta: { words, asr_wer: 0, asr_flag: 'ok' } };
    });
  }
  graph.registerBuilder('captions', async (ctx) => {
    calls.push(ctx.nodeId);
    const doc = {
      schema_version: 1,
      video_id: ctx.videoId,
      style: 'caption-highlight',
      groups: [],
    };
    ctx.store.write(`${ctx.videoRel}/caption_groups.json`, JSON.stringify(doc), { by: 'test' });
    return { outputs: ['caption_groups.json'] };
  });
  graph.registerBuilder('index', async (ctx) => {
    calls.push(ctx.nodeId);
    ctx.store.write(`${ctx.videoRel}/index.html`, '<html></html>', { by: 'test' });
    return { outputs: ['index.html'] };
  });
  return { dir: c.dir, store, graph, calls, cleanup: c.cleanup };
}

/** File frame hợp lệ (qua `checkFrameFile`): đủ data-sf-id của layer + timeline đăng ký. */
export function validFrameHtml(frameId: string, layerIds: string[], tag = ''): string {
  return `<template><div data-composition-id="${frameId}">${layerIds.map((id) => `<div data-sf-id="${id}">${tag}</div>`).join('')}<script>window.__timelines = window.__timelines || {}; window.__timelines["${frameId}"] = gsap.timeline({ paused: true });</script></div></template>`;
}

/** Ghi frame giả hợp lệ cho mọi frame của video (nút frame_html nhận vào graph, 020). */
export function writeValidFrames(store: WriteStore, videoId: string): void {
  for (const f of loadVideoModel(store.root, videoId).frames)
    store.write(
      `videos/${videoId}/compositions/frames/${f.id}.html`,
      validFrameHtml(
        f.id,
        f.layers.map((l) => l.id),
      ),
      { by: 'test', validate: false },
    );
}
