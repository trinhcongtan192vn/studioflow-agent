import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { importAsset, readManifest } from '../assets/library.js';
import { resolveConfig } from '../config/resolve.js';
import type { CastMember } from '../contracts/types.js';
import { newId } from '../domain/ids.js';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';

/** Ảnh tải lên làm nhân vật dẫn chuyện (`.jfif` là JPEG — lưu thành `.jpg`). */
const IMAGE_EXT: Record<string, string> = {
  '.png': '.png',
  '.jpg': '.jpg',
  '.jpeg': '.jpg',
  '.jfif': '.jpg',
  '.webp': '.webp',
};

export interface ChannelHost {
  id: string;
  name: string;
  look?: string;
  /** Ảnh tham chiếu người dùng tải lên (asset kênh). */
  asset_id: string;
  /** Đường dẫn tuyệt đối của ảnh (xem trước). */
  image?: string;
}

const readJson = <T>(f: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

/**
 * Nhân vật dẫn chuyện của kênh (2026-10-10): nhân vật cấp kênh vai `narrator` có ảnh tham chiếu. Xuất hiện trong
 * cảnh như người dẫn; ảnh của nó là tham chiếu **phong cách** cho mọi nhân vật mới của kênh.
 */
export function readHost(channelDir: string): ChannelHost | undefined {
  const root = path.join(channelDir, 'characters');
  if (!existsSync(root)) return undefined;
  for (const id of readdirSync(root)) {
    const c = readJson<Partial<CastMember> & { look?: string }>(path.join(root, id, 'cast.json'));
    const asset = c?.reference_images?.[0];
    if (c?.role === 'narrator' && asset && c.id) {
      const m = readJson<{ assets: { id: string; file: string }[] }>(
        path.join(channelDir, 'assets', 'manifest.json'),
      );
      const file = m?.assets.find((a) => a.id === asset)?.file;
      return {
        id: c.id,
        name: c.name ?? c.id,
        ...(c.look ? { look: c.look } : {}),
        asset_id: asset,
        ...(file ? { image: path.join(channelDir, ...file.split('/')) } : {}),
      };
    }
  }
  return undefined;
}

/** Tạo/cập nhật nhân vật dẫn chuyện: ảnh mới (tùy chọn) vào thư viện kênh, tên, ngoại hình. */
export function setHost(
  store: WriteStore,
  input: { path_on_disk?: string; name: string; look?: string },
  appDataDir?: string,
): ChannelHost {
  const cur = readHost(store.root);
  let asset = cur?.asset_id;
  if (input.path_on_disk) {
    const ext = IMAGE_EXT[path.extname(input.path_on_disk).toLowerCase()];
    if (!ext)
      throw new SfError('E_SCHEMA_INVALID', 'host image must be png, jpg, jpeg, jfif or webp');
    if (statSync(input.path_on_disk).size > 30 * 1024 * 1024)
      throw new SfError('E_UPLOAD_TOO_LARGE', 'host image is larger than 30 MB');
    const up = `uploads/${randomUUID()}${ext}`;
    store.importFile(input.path_on_disk, up, { by: 'channel.host' });
    asset = importAsset(store, {
      path: up,
      tags: ['cast', 'host'],
      description: `${input.name} — channel host (style reference for every character)`,
    }).asset_id;
  }
  if (!asset) throw new SfError('E_SCHEMA_INVALID', 'upload a host image first');
  const voice = resolveConfig<string | null>(
    'voice.id',
    { channelDir: store.root },
    { appDataDir },
  ).value;
  if (!voice)
    throw new SfError(
      'E_SCHEMA_INVALID',
      'choose the channel narrator voice first (the host speaks with it)',
    );
  const id =
    cur?.id ??
    newId(
      'ca',
      new Set(existsSync(store.abs('characters')) ? readdirSync(store.abs('characters')) : []),
    );
  const prev = readJson<Record<string, unknown>>(store.abs(`characters/${id}/cast.json`)) ?? {};
  const look = input.look?.trim();
  const c = {
    ...prev,
    id,
    name: input.name.trim() || 'Host',
    role: 'narrator',
    voice_id: voice,
    reference_images: [asset],
    ...(look ? { look } : {}),
  };
  if (!look) delete (c as { look?: string }).look;
  store.write(`characters/${id}/cast.json`, `${JSON.stringify(c, null, 2)}\n`, {
    by: 'channel.host',
    validate: false,
  });
  // ảnh thật đã có trong thư viện (kiểm nhanh, lỗi nhập thì báo ngay)
  if (!readManifest(store).assets.some((a) => a.id === asset))
    throw new SfError('E_ID_UNKNOWN', `asset ${asset} missing from the library`);
  return readHost(store.root)!;
}
