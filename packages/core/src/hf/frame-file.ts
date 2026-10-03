/** `data-sf-id` có trong HTML (D9 mục 3). */
export function sfIdsOf(html: string): Set<string> {
  return new Set([...html.matchAll(/\bdata-sf-id\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]!));
}

export interface FrameFileProblem {
  code: string;
  message: string;
}

/**
 * Kiểm file frame do phiên `frame` viết (011 FR-004, hợp đồng frame worker HyperFrames): đúng một
 * `<template>`, root `data-composition-id="<fr>"`, style/script nằm trong template, timeline đăng ký,
 * đủ `data-sf-id` của layer, phần tử phụ dùng tiền tố `el_`.
 */
export function checkFrameFile(
  html: string,
  frameId: string,
  layerIds: string[],
): FrameFileProblem[] {
  const out: FrameFileProblem[] = [];
  const t = html.trim();
  if (
    !t.startsWith('<template') ||
    !t.endsWith('</template>') ||
    (t.match(/<template\b/g) ?? []).length !== 1
  ) {
    out.push({
      code: 'missing_template_wrapper',
      message: 'file must be exactly one <template>…</template> fragment',
    });
  }
  if (/<!doctype|<html\b|<body\b|<head\b/i.test(t))
    out.push({
      code: 'full_document',
      message: 'no <!doctype>/<html>/<head>/<body> in a frame file',
    });
  if (!new RegExp(`data-composition-id\\s*=\\s*["']${frameId}["']`).test(t)) {
    out.push({
      code: 'missing_composition_id',
      message: `root must carry data-composition-id="${frameId}"`,
    });
  }
  if (!new RegExp(`__timelines\\s*\\[\\s*["']${frameId}["']\\s*\\]`).test(t)) {
    out.push({
      code: 'timeline_not_registered',
      message: `register one paused timeline at window.__timelines["${frameId}"]`,
    });
  }
  if (/<audio\b/i.test(t))
    out.push({
      code: 'audio_in_frame',
      message: 'no <audio> in a frame (audio is assembled in index.html)',
    });
  const ids = sfIdsOf(t);
  const missing = layerIds.filter((id) => !ids.has(id));
  if (missing.length)
    out.push({
      code: 'missing_sf_id',
      message: `missing data-sf-id for layers: ${missing.join(', ')}`,
    });
  const bad = [...ids].filter((id) => !layerIds.includes(id) && !/^el_[0-9a-z]{8}$/.test(id));
  if (bad.length)
    out.push({
      code: 'bad_sf_id',
      message: `extra elements must use data-sf-id="el_<8 chars [0-9a-z]>": ${bad.join(', ')}`,
    });
  const counts = new Map<string, number>();
  for (const m of t.matchAll(/\bdata-sf-id\s*=\s*["']([^"']+)["']/g))
    counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  const dup = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  if (dup.length)
    out.push({ code: 'duplicate_sf_id', message: `duplicate data-sf-id: ${dup.join(', ')}` });
  return out;
}
