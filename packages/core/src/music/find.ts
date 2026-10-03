import type { MusicFindInput, MusicFindOutput, MusicTrack } from '../contracts/types.js';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';
import { appLibrary, readMusicManifest, recentVideoIds } from './library.js';

const norm = (s: string) => s.normalize('NFC').toLowerCase();

/** Độ khớp từ khóa 0–1: tỉ lệ từ của `query` có trong tags/title/description/tên gốc. */
function keywordScore(t: MusicTrack, words: string[]): { score: number; hits: string[] } {
  if (!words.length) return { score: 1, hits: [] };
  const hay = norm(
    [t.tags.join(' '), t.title ?? '', t.description ?? '', t.original_name].join(' '),
  );
  const hits = words.filter((w) => hay.includes(w));
  return { score: hits.length / words.length, hits };
}

/**
 * `music.find` / `sfx.find` (D8 mục 2.2): lọc cứng tags/BPM/energy/thời lượng/loại trừ; điểm =
 * 0,7 × từ khóa + 0,3 × (1 − phạt dùng gần đây) (FN-012); kênh ưu tiên khi bằng điểm.
 */
export function findMusic(
  d: { channel: WriteStore; appDataDir: string },
  input: MusicFindInput,
  kind: 'music' | 'sfx' = 'music',
): MusicFindOutput {
  const words = norm(input.query ?? '')
    .split(/[\s,.;]+/)
    .filter((w) => w.length > 1);
  const recent = new Set(recentVideoIds(d.channel.root));
  const tagsReq = (input.tags ?? []).map(norm);
  const cands: { t: MusicTrack; scope: 'channel' | 'app' }[] = [
    ...readMusicManifest({ scope: 'channel', store: d.channel }).tracks.map((t) => ({
      t,
      scope: 'channel' as const,
    })),
    ...readMusicManifest(appLibrary(d.appDataDir)).tracks.map((t) => ({
      t,
      scope: 'app' as const,
    })),
  ];
  const out = cands
    .filter(({ t }) => t.kind === kind)
    .filter(({ t }) => !input.exclude_ids?.includes(t.id))
    .filter(({ t }) => tagsReq.every((x) => t.tags.map(norm).includes(x)))
    .filter(({ t }) => {
      const b = input.bpm;
      if (!b) return true;
      const bpm = t.analysis.bpm;
      if (bpm === undefined) return false;
      // nhân/chia đôi tempo vẫn tính (S11: BPM có thể lệch bội 2)
      return [bpm, bpm * 2, bpm / 2].some(
        (x) => (b.min === undefined || x >= b.min) && (b.max === undefined || x <= b.max),
      );
    })
    .filter(
      ({ t }) =>
        !input.energy ||
        ((input.energy.min === undefined || t.analysis.energy >= input.energy.min) &&
          (input.energy.max === undefined || t.analysis.energy <= input.energy.max)),
    )
    .filter(
      ({ t }) =>
        kind === 'sfx' ||
        input.min_duration_ms === undefined ||
        t.analysis.duration_ms >= input.min_duration_ms,
    )
    .map(({ t, scope }) => {
      const kw = keywordScore(t, words);
      const used = t.used_in.filter((v) => recent.has(v)).length;
      const penalty = Math.min(1, used / 2);
      const score = Math.round((0.7 * kw.score + 0.3 * (1 - penalty)) * 1000) / 1000;
      const reasons = [
        ...(kw.hits.length ? [`khớp: ${kw.hits.join(', ')}`] : []),
        ...(t.analysis.bpm !== undefined ? [`BPM ${Math.round(t.analysis.bpm)}`] : []),
        `dài ${Math.round(t.analysis.duration_ms / 1000)} s`,
        ...(t.tags.length ? [`tag: ${t.tags.slice(0, 4).join(', ')}`] : []),
        ...(used ? [`đã dùng ở ${used} video gần đây`] : []),
        ...(scope === 'app' ? ['kho app'] : []),
      ];
      return { t, scope, score, reasons };
    })
    .sort(
      (a, b) => b.score - a.score || (a.scope === b.scope ? 0 : a.scope === 'channel' ? -1 : 1),
    );
  if (!out.length) {
    const hints = [
      ...(input.tags?.length ? ['bỏ bớt tags'] : []),
      ...(input.bpm ? ['nới khoảng BPM'] : []),
      ...(input.energy ? ['nới khoảng energy'] : []),
      ...(input.min_duration_ms ? ['giảm min_duration_ms'] : []),
    ];
    throw new SfError(
      'E_MUSIC_NOT_FOUND',
      `no ${kind} track matches the hard filters${hints.length ? `; try: ${hints.join(', ')}` : '; add tracks with music.library.add'}`,
    );
  }
  return {
    results: out
      .slice(0, input.limit ?? 5)
      .map((x) => ({ track_id: x.t.id, score: x.score, reasons: x.reasons })),
  };
}
