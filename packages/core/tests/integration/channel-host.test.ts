// Nhân vật dẫn chuyện của kênh (2026-10-10): ảnh tải lên (kể cả .jfif) → nhân vật kênh vai narrator có ảnh tham
// chiếu; ảnh nhân vật trong suốt sinh thẳng bằng Qwen RGBA với prompt không tả nền.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readHost, setHost } from '../../src/cast/host.js';
import { alphaNegative, alphaPrompt } from '../../src/image/alpha-prompt.js';
import { WriteStore } from '../../src/index.js';
import { copyChannel, tempDir } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

// JPEG nhỏ nhất đủ để đọc kích thước (SOF0 4×4)
const JPEG = Buffer.from(
  'ffd8ffe000104a46494600010100000100010000ffc0000b080004000401011100ffd9',
  'hex',
);

it('a .jfif host image becomes the channel host (stored as .jpg in the library)', () => {
  const c = copyChannel();
  const t = tempDir('host-');
  cleanups.push(c.cleanup, t.cleanup);
  const src = path.join(t.dir, 'mascot.jfif');
  writeFileSync(src, JPEG);
  const store = new WriteStore(c.dir);
  expect(readHost(c.dir)).toBeUndefined();
  const h = setHost(store, { path_on_disk: src, name: 'Owly', look: 'cartoon owl, teal scarf' });
  expect(h).toMatchObject({ name: 'Owly', look: 'cartoon owl, teal scarf' });
  expect(h.image).toMatch(/\.jpg$/);
  const cast = JSON.parse(
    readFileSync(path.join(c.dir, 'characters', h.id, 'cast.json'), 'utf8'),
  ) as Record<string, unknown>;
  expect(cast).toMatchObject({
    role: 'narrator',
    reference_images: [h.asset_id],
    voice_id: 'vo_c3z8p1mn',
  });
  // đổi tên, giữ ảnh
  expect(setHost(store, { name: 'Owly 2' })).toMatchObject({ id: h.id, asset_id: h.asset_id });
  expect(() => setHost(store, { path_on_disk: path.join(t.dir, 'x.gif'), name: 'x' })).toThrow(
    /png, jpg/,
  );
});

it('transparent prompts drop what describes a background and block it in the negative prompt', () => {
  const p = alphaPrompt(
    'old man kneeling on the deck, cupping his ear, isolated on an empty plain background, no floor, vintage scientific illustration, soft watercolor wash on aged paper',
  );
  expect(p).not.toMatch(/deck|paper|background|floor/);
  expect(p).toContain('cupping his ear');
  expect(p).toContain('old man kneeling');
  expect(p).toContain('soft watercolor wash');
  expect(p).toContain('vintage scientific illustration');
  expect(alphaNegative()).toMatch(/paper.*floor/);
});
