import { isMap, isSeq, type YAMLMap } from 'yaml';
import type { Frame, Scene, StoryboardDoc, StoryboardFrontMatter } from '../../contracts/types.js';
import { SfError } from '../../errors.js';
import { newId, type IdPrefix } from '../ids.js';
import { blockReplacements, findBlocks, renderBody, type SfBlock } from './blocks.js';
import {
  parseError,
  renderFrontMatter,
  splitFrontMatter,
  type FrontMatter,
} from './frontmatter.js';

export interface ParsedStoryboard {
  front: Record<string, unknown>;
  frontMatter: FrontMatter;
  body: string[];
  bodyStart: number;
  /** Khối `sf-scene`/`sf-frame` theo thứ tự trong file. */
  blocks: SfBlock[];
}

/** Parse `STORYBOARD.md` (D3 5.5). */
export function parseStoryboard(text: string): ParsedStoryboard {
  const { front, body, bodyStart } = splitFrontMatter(text);
  const blocks = findBlocks(body, bodyStart).filter(
    (b) => b.tag === 'sf-scene' || b.tag === 'sf-frame',
  );
  let seenScene = false;
  for (const b of blocks) {
    if (b.data === null || typeof b.data !== 'object' || Array.isArray(b.data)) {
      throw parseError(b.line, `${b.tag} must be a YAML map`);
    }
    if (b.tag === 'sf-scene') seenScene = true;
    else if (!seenScene) throw parseError(b.line, 'sf-frame before any sf-scene');
  }
  return { front: front.data, frontMatter: front, body, bodyStart, blocks };
}

export function serializeStoryboard(p: ParsedStoryboard): string {
  p.frontMatter.data = p.front;
  return [
    ...renderFrontMatter(p.frontMatter),
    ...renderBody(p.body, blockReplacements(p.blocks)),
  ].join('\n');
}

function prependId(map: YAMLMap, id: string, doc: SfBlock['doc']): void {
  map.items.unshift(doc.createPair('id', id));
}

/** Gán ID cho scene/frame/layer chưa có (sửa YAML tại chỗ để giữ định dạng). */
export function assignStoryboardIds(
  text: string,
  taken: ReadonlySet<string> = new Set(),
): { text: string; assigned: string[] } {
  const p = parseStoryboard(text);
  const used = new Set<string>(taken);
  const collect = (v: unknown) => typeof v === 'string' && used.add(v);
  for (const b of p.blocks) {
    const d = b.data as Record<string, unknown>;
    collect(d.id);
    if (Array.isArray(d.layers)) for (const l of d.layers) collect((l as { id?: unknown })?.id);
  }
  const assigned: string[] = [];
  const fresh = (prefix: IdPrefix) => {
    const id = newId(prefix, used);
    used.add(id);
    assigned.push(id);
    return id;
  };
  for (const b of p.blocks) {
    const root = b.doc.contents;
    if (!isMap(root)) continue;
    if (!root.has('id')) {
      prependId(root, fresh(b.tag === 'sf-scene' ? 'sc' : 'fr'), b.doc);
      b.docDirty = true;
    }
    const layers = root.get('layers', true);
    if (b.tag === 'sf-frame' && isSeq(layers)) {
      for (const item of layers.items) {
        if (isMap(item) && !item.has('id')) {
          prependId(item, fresh('el'), b.doc);
          b.docDirty = true;
        }
      }
    }
    if (b.docDirty) b.data = b.doc.toJS();
  }
  return { text: assigned.length ? serializeStoryboard(p) : text, assigned };
}

/** Mô hình `StoryboardDoc`: suy `order`, `frame_ids`, `scene_id` theo vị trí (D3 5.5). */
export function toStoryboardDoc(
  p: ParsedStoryboard,
  opts: { loose?: boolean } = {},
): StoryboardDoc {
  const scenes: Scene[] = [];
  const frames: Frame[] = [];
  for (const b of p.blocks) {
    const d = { ...(b.data as Record<string, unknown>) };
    if (d.id === undefined && !opts.loose) {
      throw new SfError(
        'E_SCHEMA_INVALID',
        `${b.tag} at line ${b.line} has no id; assign ids before use`,
      );
    }
    if (b.tag === 'sf-scene') {
      scenes.push({ ...d, order: scenes.length, frame_ids: [] } as unknown as Scene);
    } else {
      const scene = scenes[scenes.length - 1]!;
      const order = scene.frame_ids.length;
      if (typeof d.id === 'string') scene.frame_ids.push(d.id as Frame['id']);
      frames.push({ ...d, scene_id: scene.id, order } as unknown as Frame);
    }
  }
  return { front: p.front as unknown as StoryboardFrontMatter, scenes, frames };
}
