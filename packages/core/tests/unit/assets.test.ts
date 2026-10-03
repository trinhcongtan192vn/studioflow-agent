// 011 · US3 · FR-007 — header ảnh, thư viện asset kênh.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  encodeWav,
  imageInfo,
  importAsset,
  searchAssets,
  validateArtifact,
  WriteStore,
} from '../../src/index.js';
import { copyChannel, fixtureVideoId } from '../domain-helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function png(w: number, h: number, colorType = 6): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[24] = 8;
  b[25] = colorType;
  return b;
}
function jpeg(w: number, h: number): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    3,
    0,
    0,
    0,
    0,
  ]);
}

describe('imageInfo (011 R6)', () => {
  it('PNG, JPEG, GIF, SVG', () => {
    expect(imageInfo(png(640, 360))).toEqual({
      kind: 'image',
      width: 640,
      height: 360,
      alpha: true,
    });
    expect(imageInfo(png(10, 20, 2))).toMatchObject({ alpha: false });
    expect(imageInfo(jpeg(1920, 1080))).toEqual({
      kind: 'image',
      width: 1920,
      height: 1080,
      alpha: false,
    });
    const gif = Buffer.from('GIF89a\x20\x00\x10\x00', 'latin1');
    expect(imageInfo(gif)).toMatchObject({ width: 32, height: 16 });
    expect(
      imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"></svg>')),
    ).toEqual({ kind: 'svg', width: 100, height: 50, alpha: true });
    expect(imageInfo(Buffer.from('xx'))).toBeUndefined();
  });
});

describe('asset library (011 US3)', () => {
  it('import → channel library + manifest + video public/; dedupe by hash; search', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const store = new WriteStore(c.dir);
    const up = path.join(c.dir, 'videos', fixtureVideoId, 'uploads');
    mkdirSync(up, { recursive: true });
    writeFileSync(path.join(up, 'map.png'), png(1600, 900, 2));
    const r = importAsset(store, {
      path: `videos/${fixtureVideoId}/uploads/map.png`,
      tags: ['bản đồ', 'cổ'],
      description: 'Bản đồ Đại Việt',
      videoId: fixtureVideoId,
    });
    expect(r).toMatchObject({
      asset_id: expect.stringMatching(/^as_/),
      file: `assets/files/${r.asset_id}.png`,
      public: `${r.asset_id}.png`.replace(/^/, 'public/'),
    });
    const manifest = readFileSync(path.join(c.dir, 'assets', 'manifest.json'), 'utf8');
    expect(validateArtifact('assets/manifest.json', manifest).errors).toEqual([]);
    expect(JSON.parse(manifest).assets.at(-1)).toMatchObject({
      id: r.asset_id,
      kind: 'image',
      width: 1600,
      height: 900,
      alpha: false,
      source: { kind: 'user_import' },
    });
    expect(readFileSync(path.join(c.dir, 'videos', fixtureVideoId, r.public!)).length).toBe(33);
    // cùng nội dung → cùng asset
    writeFileSync(path.join(up, 'map2.png'), png(1600, 900, 2));
    expect(importAsset(store, { path: `videos/${fixtureVideoId}/uploads/map2.png` }).asset_id).toBe(
      r.asset_id,
    );
    expect(searchAssets(store, { query: 'bản đồ' }).assets[0]!.id).toBe(r.asset_id);
    expect(searchAssets(store, { query: 'hoàng hôn' }).assets.map((a) => a.id)).toEqual([
      'as_h6k2q9vt',
    ]);
    expect(searchAssets(store, { query: '', tags: ['cổ'] }).assets.map((a) => a.id)).toEqual([
      r.asset_id,
    ]);
  });

  it('rejects paths outside uploads/ and unsupported files', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const store = new WriteStore(c.dir);
    expect(() => importAsset(store, { path: 'channel.json' })).toThrow(
      expect.objectContaining({ code: 'E_PATH_OUTSIDE' }),
    );
    const up = path.join(c.dir, 'uploads');
    mkdirSync(up, { recursive: true });
    writeFileSync(path.join(up, 'a.txt'), 'hello');
    expect(() => importAsset(store, { path: 'uploads/a.txt' })).toThrow(
      expect.objectContaining({ code: 'E_SCHEMA_INVALID' }),
    );
    writeFileSync(path.join(up, 'a.wav'), encodeWav(500));
    expect(importAsset(store, { path: 'uploads/a.wav' }).file).toMatch(/\.wav$/);
  });
});
