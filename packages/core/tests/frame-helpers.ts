import type { FramePacket } from '../src/index.js';

/** Frame hợp lệ theo vai frame worker (cho runtime giả). */
/** `overlap`: thêm một khối chữ đè lên lớp chữ đầu (hyperframes check báo `content_overlap`, 093). */
export function sampleFrame(p: FramePacket, drop?: string, overlap = false): string {
  const id = p.frame.id;
  // khung theo output profile (quy tắc "Canvas W×H" trong packet; shorts dọc 030)
  const m = /Canvas (\d+)×(\d+)/.exec(p.rules.join('\n'));
  const W = m ? Number(m[1]) : 1920;
  const H = m ? Number(m[2]) : 1080;
  const d = (p.timing.duration_ms / 1000).toFixed(3);
  // nền có ảnh trong packet → <img> phủ khung (như frame worker thật; 027 grade ảnh này)
  const bgAsset = p.assets?.[0];
  const layers = p.frame.layers
    .filter((l) => l.id !== drop)
    .map((l, i) =>
      l.kind === 'mouth'
        ? `    <div class="clip ${id}-layer" data-sf-id="${l.id}" data-start="0" data-duration="${d}" data-track-index="${i}" style="position:absolute;left:${Math.round(W * 0.47)}px;top:${Math.round(H * 0.45)}px;width:${Math.round(W * 0.06)}px;height:${Math.round(W * 0.036)}px"></div>`
        : l.kind === 'background' && bgAsset
          ? `    <img class="clip ${id}-layer" data-sf-id="${l.id}" data-start="0" data-duration="${d}" data-track-index="${i}" src="${bgAsset.file}" alt="" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:cover">`
          : `    <div class="clip ${id}-layer" data-sf-id="${l.id}" data-start="0" data-duration="${d}" data-track-index="${i}" style="position:absolute;left:${120 + i * 40}px;top:${160 + i * 120}px;font-family:sans-serif;font-size:96px;color:#f4f1ea;background:rgba(10,12,16,0.85);padding:8px 24px">${l.text ?? l.kind}</div>`,
    );
  return `<template>
  <div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}" data-start="0" data-duration="${d}">
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>#root { position: relative; width: ${W}px; height: ${H}px; }</style>
    <div class="clip" id="${id}-bg" data-start="0" data-duration="${d}" data-track-index="9" style="position:absolute;inset:0;background:#101418"></div>
${layers.join('\n')}
${overlap ? `    <div class="clip" data-start="0" data-duration="${d}" data-track-index="8" style="position:absolute;left:120px;top:160px;font-family:sans-serif;font-size:96px;color:#f4f1ea">Chữ đè lên chữ khác</div>\n` : ''}    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#${id}-bg", { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0);
      window.__timelines["${id}"] = tl;
    </script>
  </div>
</template>
`;
}
