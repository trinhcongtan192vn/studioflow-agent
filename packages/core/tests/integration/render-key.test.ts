// Render một lần (2026-10-10): khóa bản HyperFrames giữ nguyên khi hình/tiếng không đổi (Render phát hành dùng
// lại bản của bản nháp), đổi khi một ảnh của video đổi.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { renderKey } from '../../src/render/render.js';
import { WriteStore } from '../../src/index.js';
import { copyChannel, fixtureVideoId } from '../domain-helpers.js';

let c: ReturnType<typeof copyChannel> | undefined;
afterEach(() => c?.cleanup());

it('render key follows what the render reads, not the meta files', () => {
  c = copyChannel();
  const d = { store: new WriteStore(c.dir), builders: {} as never };
  const vdir = path.join(c.dir, 'videos', fixtureVideoId);
  mkdirSync(path.join(vdir, 'public'), { recursive: true });
  writeFileSync(path.join(vdir, 'public', 'a.png'), 'one');
  const k1 = renderKey(d, fixtureVideoId, 30, 18);
  // tiêu đề/mô tả (publish.md) đổi sau duyệt → vẫn dùng lại
  writeFileSync(path.join(vdir, 'publish.md'), 'changed');
  expect(renderKey(d, fixtureVideoId, 30, 18)).toBe(k1);
  expect(renderKey(d, fixtureVideoId, 25, 18)).not.toBe(k1);
  writeFileSync(path.join(vdir, 'public', 'a.png'), 'two');
  expect(renderKey(d, fixtureVideoId, 30, 18)).not.toBe(k1);
});
