// Agent dọn rác (2026-10-10): giọng/ảnh không ai dùng → thùng rác của kênh (khôi phục được); đang dùng → từ chối.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { trashAsset, trashVoice } from '../../src/assets/trash.js';
import { WriteStore } from '../../src/index.js';
import { copyChannel } from '../domain-helpers.js';

let c: ReturnType<typeof copyChannel> | undefined;
afterEach(() => c?.cleanup());

const voice = (dir: string, id: string) => {
  mkdirSync(path.join(dir, 'voices', id), { recursive: true });
  writeFileSync(
    path.join(dir, 'voices', id, 'profile.json'),
    JSON.stringify({ voice_id: id, name: id }),
  );
};

it('a broken voice nobody uses goes to the channel trash; a voice in use is refused', () => {
  c = copyChannel();
  const store = new WriteStore(c.dir);
  voice(c.dir, 'vo_junk0001');
  const r = trashVoice(store, 'vo_junk0001');
  expect(existsSync(path.join(c.dir, 'voices', 'vo_junk0001'))).toBe(false);
  expect(r.moved_to).toMatch(/^\.trash\/voices\/vo_junk0001-\d{14}$/);
  expect(existsSync(path.join(c.dir, ...r.moved_to.split('/'), 'profile.json'))).toBe(true);
  // giọng được nhắc trong cấu hình kênh / video → không xóa
  voice(c.dir, 'vo_used0001');
  const ch = JSON.parse(readFileSync(path.join(c.dir, 'channel.json'), 'utf8'));
  ch.config = { ...(ch.config ?? {}), 'voice.id': 'vo_used0001' };
  writeFileSync(path.join(c.dir, 'channel.json'), JSON.stringify(ch));
  expect(() => trashVoice(store, 'vo_used0001')).toThrow(/still in use/);
  expect(() => trashVoice(store, 'vo_nothere1')).toThrow(/not in this channel/);
});

it('an unused library image leaves the manifest and goes to the trash; one used by a storyboard stays', () => {
  c = copyChannel();
  const store = new WriteStore(c.dir);
  const m = JSON.parse(readFileSync(path.join(c.dir, 'assets', 'manifest.json'), 'utf8'));
  mkdirSync(path.join(c.dir, 'assets', 'files'), { recursive: true });
  writeFileSync(path.join(c.dir, 'assets', 'files', 'as_junk0001.png'), 'x');
  m.assets.push({
    ...m.assets[0],
    id: 'as_junk0001',
    file: 'assets/files/as_junk0001.png',
    hash: '2'.repeat(64),
  });
  writeFileSync(path.join(c.dir, 'assets', 'manifest.json'), JSON.stringify(m));
  const r = trashAsset(store, 'as_junk0001');
  expect(r.moved_to).toMatch(/^\.trash\/assets\/as_junk0001-\d{14}\.png$/);
  expect(existsSync(path.join(c.dir, 'assets', 'files', 'as_junk0001.png'))).toBe(false);
  const after = JSON.parse(readFileSync(path.join(c.dir, 'assets', 'manifest.json'), 'utf8'));
  expect(after.assets.some((a: { id: string }) => a.id === 'as_junk0001')).toBe(false);
  // ảnh mẫu của fixture được storyboard dùng
  expect(() => trashAsset(store, 'as_h6k2q9vt')).toThrow(
    /still used by .*videos\/vd_8m2pq7rt\/STORYBOARD\.md/,
  );
});
