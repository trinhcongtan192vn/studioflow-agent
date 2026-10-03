import { existsSync, readFileSync } from 'node:fs';
import type { AudioMeta } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';
import { BuildGraph, type BuildResult, type BuilderRegistry } from '../graph/graph.js';
import type { WriteStore } from '../store/writer.js';
import { readAsrState, writeAsrState } from './state.js';

export interface AlignResult {
  status: BuildResult['status'];
  /** Line còn lệch sau khi đã sinh lại tối đa `asr.max_regen` lần. */
  mismatched: { line_id: string; asr_wer: number; regen: number }[];
  /** Số lần đã sinh lại trong lần chạy này, theo line. */
  regenerated: Record<string, number>;
  nodes: BuildResult['nodes'];
}

function readMeta(store: WriteStore, videoId: string): AudioMeta | undefined {
  const f = store.abs(`videos/${videoId}/audio_meta.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as AudioMeta) : undefined;
}

/**
 * Căn chỉnh ASR + sinh lại line lệch (D4 `asr.align`, 010 FR-004): build tới `captions`; line
 * `mismatch` còn lượt → tăng `regen` → build lại line đó; hết lượt → giữ `mismatch` và báo.
 */
export async function alignVideo(
  d: { store: WriteStore; builders: BuilderRegistry; appDataDir?: string },
  videoId: string,
  opts: {
    lineIds?: string[];
    signal?: AbortSignal;
    progress?: (done: number, total: number, message?: string) => void;
  } = {},
): Promise<AlignResult> {
  const graph = new BuildGraph({ store: d.store, appDataDir: d.appDataDir, builders: d.builders });
  const max = Number(
    resolveConfig(
      'asr.max_regen',
      { channelDir: d.store.root, videoId },
      { appDataDir: d.appDataDir },
    ).value,
  );
  const tail = ['audio_meta', ...(d.builders.active('captions') ? ['captions'] : [])];
  let targets = opts.lineIds?.length
    ? [...opts.lineIds.map((l) => `asr.line:${l}`), ...tail]
    : ['asr.line', ...tail];
  const scope = opts.lineIds?.length ? new Set(opts.lineIds) : undefined;
  const regenerated: Record<string, number> = {};
  const nodes: BuildResult['nodes'] = {};
  for (;;) {
    const r = await graph.build(videoId, {
      targets,
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.progress ? { progress: opts.progress } : {}),
    });
    Object.assign(nodes, r.nodes);
    const meta = readMeta(d.store, videoId);
    if (r.status === 'failed' || !meta)
      return { status: r.status, mismatched: [], regenerated, nodes };
    const st = readAsrState(d.store.abs(`videos/${videoId}`));
    const bad = meta.lines.filter(
      (l) => l.asr_flag === 'mismatch' && (!scope || scope.has(l.line_id)),
    );
    const retry = bad.filter((l) => (st.regen[l.line_id] ?? 0) < max);
    if (retry.length === 0) {
      return {
        status: r.status,
        mismatched: bad.map((l) => ({
          line_id: l.line_id,
          asr_wer: l.asr_wer ?? 1,
          regen: st.regen[l.line_id] ?? 0,
        })),
        regenerated,
        nodes,
      };
    }
    for (const l of retry) {
      st.regen[l.line_id] = (st.regen[l.line_id] ?? 0) + 1;
      regenerated[l.line_id] = (regenerated[l.line_id] ?? 0) + 1;
    }
    writeAsrState(d.store, videoId, st);
    targets = [...retry.map((l) => `asr.line:${l.line_id}`), ...tail];
  }
}

/** `asr.accept` (D4): chấp nhận audio hiện tại của line dù lệch → `asr_flag = accepted`. */
export async function acceptLines(
  d: { store: WriteStore; builders: BuilderRegistry; appDataDir?: string },
  videoId: string,
  lineIds: string[],
): Promise<Record<string, never>> {
  const meta = readMeta(d.store, videoId);
  const st = readAsrState(d.store.abs(`videos/${videoId}`));
  for (const id of lineIds) {
    const l = meta?.lines.find((x) => x.line_id === id);
    if (!l) throw new SfError('E_ID_UNKNOWN', `line ${id} has no audio in audio_meta.json`);
    st.accepted[id] = l.content_hash;
  }
  writeAsrState(d.store, videoId, st);
  const graph = new BuildGraph({ store: d.store, appDataDir: d.appDataDir, builders: d.builders });
  await graph.build(videoId, {
    targets: ['audio_meta', ...(d.builders.active('captions') ? ['captions'] : [])],
  });
  return {};
}
