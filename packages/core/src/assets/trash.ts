import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';
import { listVoices } from '../tts/library.js';
import { readManifest } from './library.js';

/** Thời điểm cho tên mục thùng rác: `YYYYMMDDHHmmss`. */
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

/** Tệp nhỏ của kênh có thể nhắc tới một ID (storyboard, cast, design, cấu hình video). */
function referencesTo(store: WriteStore, id: string): string[] {
  const root = store.root;
  const files: string[] = [
    'channel.json',
    'profile/design-system.json',
    'profile/design-proposals.json',
  ];
  const sub = (d: string) =>
    existsSync(path.join(root, d))
      ? readdirSync(path.join(root, d), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [];
  for (const ca of sub('characters')) files.push(`characters/${ca}/cast.json`);
  for (const vd of sub('videos'))
    for (const f of ['STORYBOARD.md', 'CAST.md', 'state.json', 'visual-cast.json'])
      files.push(`videos/${vd}/${f}`);
  return files.filter((rel) => {
    const abs = path.join(root, ...rel.split('/'));
    return existsSync(abs) && readFileSync(abs, 'utf8').includes(id);
  });
}

/**
 * `voice.delete`: giọng rác (lỗi, thử không dùng) → thùng rác của kênh `.trash/voices/<vo>-<thời điểm>` (khôi
 * phục được). Từ chối khi giọng đang là giọng dẫn/giọng nhân vật hoặc còn được video nào nhắc tới.
 */
export function trashVoice(
  store: WriteStore,
  voiceId: string,
  appDataDir?: string,
): { voice_id: string; moved_to: string } {
  if (!/^vo_[0-9a-z]{8}$/.test(voiceId) || !existsSync(store.abs(`voices/${voiceId}`)))
    throw new SfError('E_ID_UNKNOWN', `voice ${voiceId} is not in this channel`);
  const used = listVoices(store.root, undefined, appDataDir).voices.find(
    (v) => v.voice_id === voiceId,
  )?.used_by;
  const refs = referencesTo(store, voiceId);
  if (used?.length || refs.length)
    throw new SfError(
      'E_SCHEMA_INVALID',
      `voice ${voiceId} is still in use (${[...(used ?? []), ...refs].join(', ')}); assign another voice first`,
    );
  const to = `.trash/voices/${voiceId}-${stamp()}`;
  store.moveToTrash(`voices/${voiceId}`, to, { by: 'voice.delete' });
  return { voice_id: voiceId, moved_to: to };
}

/**
 * `asset.delete`: ảnh/tệp rác của thư viện kênh → `.trash/assets/` và bỏ khỏi `assets/manifest.json`. Từ chối khi
 * storyboard, nhân vật, design hoặc cấu hình nào còn nhắc tới asset.
 */
export function trashAsset(
  store: WriteStore,
  assetId: string,
): { asset_id: string; moved_to: string } {
  const m = readManifest(store);
  const a = m.assets.find((x) => x.id === assetId);
  if (!a) throw new SfError('E_ID_UNKNOWN', `asset ${assetId} is not in assets/manifest.json`);
  const refs = referencesTo(store, assetId);
  if (refs.length)
    throw new SfError(
      'E_SCHEMA_INVALID',
      `asset ${assetId} is still used by ${refs.join(', ')}; remove it there first`,
    );
  const to = `.trash/assets/${assetId}-${stamp()}${path.extname(a.file)}`;
  if (existsSync(store.abs(a.file))) store.moveToTrash(a.file, to, { by: 'asset.delete' });
  m.assets = m.assets.filter((x) => x.id !== assetId);
  store.write('assets/manifest.json', `${JSON.stringify(m, null, 2)}\n`, { by: 'asset.delete' });
  return { asset_id: assetId, moved_to: to };
}
