import { existsSync, readFileSync } from 'node:fs';
import type { AudioMeta } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { parseScript, toScriptDoc } from '../domain/markdown/script.js';
import type { WriteStore } from '../store/writer.js';

/**
 * Tốc độ đọc theo giọng (016 R4): phụ thuộc giọng và nội dung kênh nên không cố định. Đo lúc tạo giọng
 * (đoạn hiệu chuẩn) và cập nhật sau mỗi lần sinh giọng cho video; lưu `voices/<vo>/profile.json.wpm`.
 */
export const CALIBRATION_TEXT: Record<string, string> = {
  vi: 'Xin chào các bạn. Hôm nay chúng ta cùng tìm hiểu một câu chuyện thú vị, từ những điều quen thuộc quanh ta cho tới những bí ẩn của thiên nhiên và vũ trụ rộng lớn.',
  en: 'Hello everyone. Today we will explore an interesting story, from the familiar things around us to the mysteries of nature and the vast universe.',
  de: 'Hallo zusammen. Heute erkunden wir eine spannende Geschichte, von vertrauten Dingen um uns herum bis zu den Rätseln der Natur und des weiten Universums.',
};

export const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const profileRel = (voiceId: string) => `voices/${voiceId}/profile.json`;

interface VoiceProfileFile {
  wpm?: number;
  wpm_samples?: number;
  [k: string]: unknown;
}

export function voiceWpm(
  store: WriteStore,
  voiceId: string | null | undefined,
): number | undefined {
  if (!voiceId) return undefined;
  const f = store.abs(profileRel(voiceId));
  if (!existsSync(f)) return undefined;
  const w = (JSON.parse(readFileSync(f, 'utf8')) as VoiceProfileFile).wpm;
  return typeof w === 'number' && w > 0 ? w : undefined;
}

/** Ghi số đo mới: trung bình có trọng số theo số mẫu (giọng mới đo sát nội dung thật hơn). */
export function recordVoiceWpm(
  store: WriteStore,
  voiceId: string,
  wpm: number,
  weight = 1,
): number | undefined {
  const rel = profileRel(voiceId);
  if (!existsSync(store.abs(rel)) || !Number.isFinite(wpm) || wpm <= 0) return undefined;
  const p = JSON.parse(readFileSync(store.abs(rel), 'utf8')) as VoiceProfileFile;
  const n = p.wpm_samples ?? 0;
  const next = p.wpm ? (p.wpm * n + wpm * weight) / (n + weight) : wpm;
  p.wpm = Math.round(next * 10) / 10;
  p.wpm_samples = n + weight;
  store.write(rel, `${JSON.stringify(p, null, 2)}\n`, { by: 'voice.rate' });
  return p.wpm;
}

/**
 * Tốc độ đọc dùng cho độ dài kịch bản: `script.wpm.<lang>` người dùng đặt (kênh/video) → tốc độ đo của
 * giọng `voice.id` → mặc định cấu hình.
 */
export function readingRate(
  store: WriteStore,
  videoId: string | undefined,
  lang: string,
  appDataDir?: string,
): number {
  const scope = { channelDir: store.root, ...(videoId ? { videoId } : {}) };
  const r = resolveConfig(`script.wpm.${lang}`, scope, { appDataDir });
  if (r.source === 'channel' || r.source === 'video') return Number(r.value);
  const voice = resolveConfig<string | null>('voice.id', scope, { appDataDir }).value;
  return voiceWpm(store, voice) ?? (Number(r.value) || 150);
}

/** Đo từ audio thật của video (số từ hiển thị — đơn vị của kiểm `length` — / thời lượng lời), cập nhật giọng người dẫn. */
export function learnFromVideo(
  store: WriteStore,
  videoId: string,
  appDataDir?: string,
): number | undefined {
  const v = `videos/${videoId}`;
  const metaF = store.abs(`${v}/audio_meta.json`);
  const scriptF = store.abs(`${v}/SCRIPT.md`);
  if (!existsSync(metaF) || !existsSync(scriptF)) return undefined;
  const meta = JSON.parse(readFileSync(metaF, 'utf8')) as AudioMeta;
  const doc = toScriptDoc(parseScript(readFileSync(scriptF, 'utf8')));
  const byId = new Map(doc.lines.map((l) => [l.id as string, l]));
  const narr = meta.lines.filter((l) => l.speaker === 'narrator');
  const words = narr.reduce((s, l) => s + countWords(byId.get(l.line_id)?.text ?? ''), 0);
  const ms = narr.reduce((s, l) => s + l.duration_ms, 0);
  const voice = narr[0]?.voice_id;
  if (!voice || words < 20 || ms < 5000) return undefined;
  void appDataDir;
  // một video = một mẫu nặng hơn đoạn hiệu chuẩn ngắn
  return recordVoiceWpm(
    store,
    voice,
    words / (ms / 60000),
    Math.min(5, Math.max(1, Math.round(words / 50))),
  );
}
