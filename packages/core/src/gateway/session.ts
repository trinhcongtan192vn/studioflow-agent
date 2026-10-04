import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SessionContext } from '../contracts/types.js';
import { SfError } from '../errors.js';
import { normalizeRel } from '../store/paths.js';
import { globToRegExp } from './glob.js';

export interface SessionPath {
  /** Tương đối kênh. */
  rel: string;
  /** Tương đối thư mục video (hoặc kênh nếu phiên cấp kênh). */
  inner: string;
  /** Video chứa đường dẫn (nếu có). */
  videoId?: string;
}

const VIDEO_PREFIX = /^video:(vd_[0-9a-z]{8})\/(.*)$/;

/** `state.json.read_only_videos` của video đang làm (030: shorts từ video dài; engine đặt khi bắt đầu). */
function stateReadOnly(session: SessionContext): string[] {
  if (!session.video_id) return [];
  try {
    const st = JSON.parse(
      readFileSync(
        path.join(session.channel_dir, 'videos', session.video_id, 'state.json'),
        'utf8',
      ),
    ) as { read_only_videos?: string[] };
    return st.read_only_videos ?? [];
  } catch {
    return [];
  }
}

/**
 * Đường dẫn do agent đưa (tương đối video/kênh, D4 mục 2.2) → đường dẫn tương đối kênh.
 * `video:<vd>/…` chỉ để đọc video trong `read_only_videos`.
 */
export function sessionPath(
  session: SessionContext,
  p: string,
  mode: 'read' | 'write',
): SessionPath {
  if (p.includes('\0')) throw new SfError('E_PATH_OUTSIDE', 'path contains NUL');
  const m = VIDEO_PREFIX.exec(p);
  if (m) {
    const vd = m[1]!;
    if (mode === 'write')
      throw new SfError('E_SCOPE_DENIED', `cannot write into another video (${vd})`);
    if (
      vd !== session.video_id &&
      !(session.read_only_videos ?? []).includes(vd as never) &&
      !stateReadOnly(session).includes(vd)
    ) {
      throw new SfError('E_SCOPE_DENIED', `video ${vd} is not readable in this session`);
    }
    const inner = normalizeRel(m[2]!);
    return { rel: `videos/${vd}/${inner}`, inner, videoId: vd };
  }
  if (/^video:/.test(p)) throw new SfError('E_PATH_OUTSIDE', `bad video: prefix in "${p}"`);
  const inner = normalizeRel(p);
  return session.video_id
    ? { rel: `videos/${session.video_id}/${inner}`, inner, videoId: session.video_id }
    : { rel: inner, inner };
}

/** Phiên `frame`/`producer` chỉ ghi `allowed_paths` (D4 mục 2.2, D5 mục 4). */
export function checkWriteScope(session: SessionContext, inner: string): void {
  if (session.kind === 'main') return;
  const allowed = session.allowed_paths ?? [];
  if (!allowed.some((a) => a === inner || globToRegExp(a).test(inner))) {
    throw new SfError(
      'E_SCOPE_DENIED',
      `${session.kind} session may only write: ${allowed.join(', ') || '(nothing)'}`,
    );
  }
}

/** File cảnh chịu khóa `owner` (D3 mục 1, D9). */
export const isSceneFile = (inner: string): boolean =>
  /^(compositions\/.+|index\.html|hyperframes\.json|caption-overrides\.json)$/.test(inner);

export function checkOwner(channelDir: string, sp: SessionPath): void {
  if (!sp.videoId || !isSceneFile(sp.inner)) return;
  const statePath = path.join(channelDir, 'videos', sp.videoId, 'state.json');
  if (!existsSync(statePath)) return;
  const owner = (JSON.parse(readFileSync(statePath, 'utf8')) as { owner?: string }).owner;
  if (owner === 'studio') {
    throw new SfError(
      'E_OWNER_CONFLICT',
      `${sp.inner} is being edited in Studio; wait until Studio is closed`,
    );
  }
}
