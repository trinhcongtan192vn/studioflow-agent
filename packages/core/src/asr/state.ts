import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { WriteStore } from '../store/writer.js';

/** `.sf/asr.json` (010 R3, R4): số lần sinh lại theo line, chấp nhận theo `content_hash` audio. */
export interface AsrState {
  schema_version: 1;
  regen: Record<string, number>;
  accepted: Record<string, string>;
}

const rel = (videoId: string) => `videos/${videoId}/.sf/asr.json`;

export function readAsrState(videoDir: string): AsrState {
  const f = path.join(videoDir, '.sf', 'asr.json');
  if (!existsSync(f)) return { schema_version: 1, regen: {}, accepted: {} };
  try {
    const s = JSON.parse(readFileSync(f, 'utf8')) as Partial<AsrState>;
    return { schema_version: 1, regen: s.regen ?? {}, accepted: s.accepted ?? {} };
  } catch {
    return { schema_version: 1, regen: {}, accepted: {} }; // dẫn xuất: hỏng → đếm lại
  }
}

export function writeAsrState(store: WriteStore, videoId: string, s: AsrState): void {
  store.write(rel(videoId), `${JSON.stringify(s, null, 2)}\n`, { by: 'asr', validate: false });
}
