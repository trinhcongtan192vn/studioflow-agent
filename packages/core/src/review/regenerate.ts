import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isMap, isSeq, type YAMLMap } from 'yaml';
import { parseStoryboard, serializeStoryboard } from '../domain/markdown/storyboard.js';
import { SfError } from '../errors.js';
import { BuildGraph, type BuilderRegistry } from '../graph/graph.js';
import type { WriteStore } from '../store/writer.js';
import type { TextService } from '../text/service.js';

/** Khóa dùng chung của lớp ảnh (`bg:`/`img:`/`actor:`): cùng prompt → cùng seed → sinh một lần (graph). */
const KEYED = /^\s*(actor|bg|img):/i;

/**
 * Tạo lại một ảnh của cảnh (tab Xem trước, 2026-10-10): người dùng ghi lỗi của ảnh hiện tại (tiếng Việt được) →
 * model phụ viết lại prompt tiếng Anh để lỗi đó không lặp lại → ghi vào `STORYBOARD.md` (giữ ID lớp). Mọi lớp
 * dùng chung ảnh đó (cùng prompt + tham chiếu) đổi theo và mang khóa dùng chung → ảnh sinh **một lần**, các cảnh
 * khác lấy từ cache. Ảnh cũ giữ trong thư viện.
 */
export async function regenerateLayerImage(
  d: { store: WriteStore; builders: BuilderRegistry; text?: TextService; appDataDir?: string },
  videoId: string,
  layerId: string,
  note: string,
): Promise<{ prompt: string; status: string; layers: number; error?: string }> {
  const rel = `videos/${videoId}/STORYBOARD.md`;
  const sb = parseStoryboard(readFileSync(d.store.abs(rel), 'utf8'));
  const all: { item: YAMLMap; req: YAMLMap; id: string; mark: () => void }[] = [];
  for (const b of sb.blocks) {
    if (b.tag !== 'sf-frame' || !isMap(b.doc.contents)) continue;
    const ls = b.doc.contents.get('layers', true);
    if (!isSeq(ls)) continue;
    for (const item of ls.items) {
      if (!isMap(item)) continue;
      const req = item.get('asset_request', true);
      if (isMap(req))
        all.push({ item, req, id: String(item.get('id')), mark: () => (b.docDirty = true) });
    }
  }
  const target = all.find((x) => x.id === layerId);
  if (!target || target.req.get('source') !== 'generate')
    throw new SfError(
      'E_SCHEMA_INVALID',
      `layer ${layerId} has no generated image (library image or not in STORYBOARD.md) — ask the agent in chat to change it`,
    );
  const refsOf = (r: YAMLMap) => JSON.stringify(r.toJSON().reference_asset_ids ?? []);
  const oldPrompt = String(target.req.get('prompt') ?? '');
  const shared = all.filter(
    (x) =>
      x.req.get('source') === 'generate' &&
      String(x.req.get('prompt') ?? '') === oldPrompt &&
      refsOf(x.req) === refsOf(target.req),
  );
  const fix = note.trim();
  let prompt = `${oldPrompt}, ${fix}`;
  if (d.text && fix) {
    try {
      const r = await d.text.generate(
        'aux',
        {
          role: 'aux',
          messages: [
            {
              role: 'user',
              content: [
                'You fix prompts for an image generation model.',
                `Current prompt: ${oldPrompt}`,
                `The image made from it had this problem (user note, may be in Vietnamese): ${fix}`,
                'Rewrite the prompt in English so that this problem cannot happen again: keep the same subject, action, art style and composition; add explicit, concrete constraints for the problem (e.g. "exactly five fingers on each hand", "whole head visible, not cropped"). Keep it one comma-separated prompt.',
                'Reply with ONLY the new prompt.',
              ].join('\n'),
            },
          ],
          max_tokens: 800,
        },
        { store: d.store, videoId },
      );
      const t = r.text.trim().replace(/^["'`]+|["'`]+$/g, '');
      if (t.length > 20) prompt = t;
    } catch {
      /* không gọi được model phụ → ghép ghi chú vào prompt */
    }
  }
  const key = `regen-${createHash('sha256').update(prompt).digest('hex').slice(0, 8)}`;
  for (const x of shared) {
    x.req.set('prompt', prompt);
    // storyboard cũ (seed theo scene) → gắn khóa dùng chung để mọi cảnh lấy cùng một ảnh
    if (!KEYED.test(String(x.item.get('notes') ?? ''))) x.item.set('notes', `img: ${key}`);
    x.mark();
  }
  for (const b of sb.blocks) if (b.docDirty) b.data = b.doc.toJS();
  d.store.write(rel, serializeStoryboard(sb), { by: 'image.regenerate' });
  const r = await new BuildGraph({
    store: d.store,
    appDataDir: d.appDataDir,
    builders: d.builders,
  }).build(videoId, { targets: shared.map((x) => `asset:${x.id}`) });
  const node = r.nodes[`asset:${layerId}`];
  return {
    prompt,
    status: node?.status ?? r.status,
    layers: shared.length,
    ...(node?.status === 'failed' ? { error: node.error?.message } : {}),
  };
}
