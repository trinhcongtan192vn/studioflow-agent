import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXTENSIONS_DIR } from '../agent/options.js';
import type { OutputProfile } from '../contracts/types.js';
import { SfError } from '../errors.js';

export const DEFAULT_OUTPUT_PROFILE = 'yt-1080p30';

/** Output profile `extensions/outputs/<id>/output.json` (D3 `OutputProfile`). */
export function loadOutputProfile(id: string | null | undefined): OutputProfile {
  const pid = id ?? DEFAULT_OUTPUT_PROFILE;
  const f = path.join(EXTENSIONS_DIR, 'outputs', pid, 'output.json');
  if (!existsSync(f)) throw new SfError('E_ID_UNKNOWN', `output profile ${pid} is not installed`);
  return JSON.parse(readFileSync(f, 'utf8')) as OutputProfile;
}
