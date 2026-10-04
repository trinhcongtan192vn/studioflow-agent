import type { FramePacket } from '../src/index.js';

/** Frame hợp lệ theo vai frame worker (cho runtime giả). */
export function sampleFrame(p: FramePacket, drop?: string): string {
  const id = p.frame.id;
  const d = (p.timing.duration_ms / 1000).toFixed(3);
  // nền có ảnh trong packet → <img> phủ khung (như frame worker thật; 027 grade ảnh này)
  const bgAsset = p.assets?.[0];
  const layers = p.frame.layers
    .filter((l) => l.id !== drop)
    .map((l, i) =>
      l.kind === 'background' && bgAsset
        ? `    <img class="clip ${id}-layer" data-sf-id="${l.id}" data-start="0" data-duration="${d}" data-track-index="${i}" src="${bgAsset.file}" alt="" style="position:absolute;left:0;top:0;width:1920px;height:1080px;object-fit:cover">`
        : `    <div class="clip ${id}-layer" data-sf-id="${l.id}" data-start="0" data-duration="${d}" data-track-index="${i}" style="position:absolute;left:${120 + i * 40}px;top:${160 + i * 120}px;font-family:sans-serif;font-size:96px;color:#f4f1ea;background:rgba(10,12,16,0.85);padding:8px 24px">${l.text ?? l.kind}</div>`,
    );
  return `<template>
  <div id="root" data-composition-id="${id}" data-width="1920" data-height="1080" data-start="0" data-duration="${d}">
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>#root { position: relative; width: 1920px; height: 1080px; }</style>
    <div class="clip" id="${id}-bg" data-start="0" data-duration="${d}" data-track-index="9" style="position:absolute;inset:0;background:#101418"></div>
${layers.join('\n')}
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#${id}-bg", { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0);
      window.__timelines["${id}"] = tl;
    </script>
  </div>
</template>
`;
}
