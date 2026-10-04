import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { EXTENSIONS_DIR } from '../agent/options.js';

/** Gói phong cách `extensions/styles/<id>/style.yaml` (D13 mục 6) — phần look/overlay dùng ở 027. */
export interface StylePack {
  id: string;
  dir: string;
  /** Bản vá color-grading HyperFrames (`media-treatment --grading`); không có → không grade. */
  grading?: Record<string, unknown>;
  /** Biến thể theo scene (`sf-scene.look: <khóa>`). */
  variants?: Record<string, Record<string, unknown>>;
  palette?: Record<string, string>;
  lut?: string;
}

/** Thư mục gói phong cách: app-data (người dùng cài) trước, rồi gói đi kèm app. */
export function styleDirs(appDataDir?: string): string[] {
  return [
    ...(appDataDir ? [path.join(appDataDir, 'extensions', 'styles')] : []),
    path.join(EXTENSIONS_DIR, 'styles'),
  ];
}

export function stylePack(id: string, appDataDir?: string): StylePack | undefined {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) return undefined;
  for (const d of styleDirs(appDataDir)) {
    const f = path.join(d, id, 'style.yaml');
    if (!existsSync(f)) continue;
    const y = (parse(readFileSync(f, 'utf8')) ?? {}) as Omit<StylePack, 'id' | 'dir'>;
    return { ...y, id, dir: path.dirname(f) };
  }
  return undefined;
}

export interface OverlayVar {
  id: string;
  label?: string;
  required?: boolean;
  default?: string;
}

export interface OverlayBlock {
  id: string;
  title: string;
  tags: string[];
  duration_ms: number;
  delay_ms: number;
  vars: OverlayVar[];
  /** Mẫu HTML có chỗ thay `{{composition_id}}`, `{{vars.<id>}}`… */
  template: string;
  pack: string;
}

/** Khối overlay `overlays/<id>/overlay.{yaml,html}` trong mọi gói phong cách (FN-common mục 6). */
export function overlayBlocks(appDataDir?: string): Map<string, OverlayBlock> {
  const out = new Map<string, OverlayBlock>();
  for (const d of [...styleDirs(appDataDir)].reverse()) {
    if (!existsSync(d)) continue;
    for (const pack of readdirSync(d)) {
      const od = path.join(d, pack, 'overlays');
      if (!existsSync(od)) continue;
      for (const id of readdirSync(od)) {
        const y = path.join(od, id, 'overlay.yaml');
        const h = path.join(od, id, 'overlay.html');
        if (!existsSync(y) || !existsSync(h)) continue;
        const m = (parse(readFileSync(y, 'utf8')) ?? {}) as Partial<OverlayBlock>;
        out.set(id, {
          id,
          title: m.title ?? id,
          tags: m.tags ?? [],
          duration_ms: m.duration_ms ?? 4000,
          delay_ms: m.delay_ms ?? 0,
          vars: m.vars ?? [],
          template: readFileSync(h, 'utf8'),
          pack,
        });
      }
    }
  }
  return out;
}

/** Id mọi gói phong cách đã cài. */
export function styleIds(appDataDir?: string): string[] {
  return [
    ...new Set(
      styleDirs(appDataDir)
        .filter((d) => existsSync(d))
        .flatMap((d) => readdirSync(d).filter((id) => existsSync(path.join(d, id, 'style.yaml')))),
    ),
  ];
}
