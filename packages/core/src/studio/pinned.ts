import { existsSync, readFileSync } from 'node:fs';
import type { VideoState } from '../contracts/types.js';
import { sha256 } from '../domain/hash.js';
import { SfError } from '../errors.js';
import { BuildGraph, type BuilderRegistry } from '../graph/graph.js';
import type { FrameRebuilder } from '../hf/frame-builder.js';
import type { WriteStore } from '../store/writer.js';
import { applyDelta, type StudioChange } from './diff.js';

type Delta = {
  pinned_at: string;
  base_hash: string;
  changes: Pick<StudioChange, 'element_id' | 'attr' | 'before' | 'after'>[];
};

/**
 * Quyết định cho frame ghim lỗi thời (D9 mục 5, FR-ST-04, 025): `keep` giữ bản chỉnh tay; `reapply` sao
 * lưu, dựng lại frame (phiên `frame`) rồi áp lại delta theo `data-sf-id`; `discard` sao lưu, bỏ ghim, dựng lại.
 */
export class PinnedDecider {
  constructor(
    private readonly d: {
      builders: BuilderRegistry;
      appDataDir?: string;
      rebuild: () => FrameRebuilder | undefined;
    },
  ) {}

  async decide(
    store: WriteStore,
    videoId: string,
    frameId: string,
    decision: 'keep' | 'reapply' | 'discard',
  ): Promise<{
    frame_id: string;
    decision: string;
    unapplied?: Delta['changes'];
    backup?: string;
  }> {
    const v = `videos/${videoId}`;
    const stRel = `${v}/state.json`;
    const st = JSON.parse(readFileSync(store.abs(stRel), 'utf8')) as VideoState;
    const pins = (st.pinned_frames ?? {}) as Record<string, Delta>;
    const delta = pins[frameId];
    if (!delta) throw new SfError('E_ID_UNKNOWN', `frame ${frameId} is not pinned`);
    const graph = new BuildGraph({
      store,
      appDataDir: this.d.appDataDir,
      builders: this.d.builders,
    });
    if (decision === 'keep') {
      graph.acceptPinned(videoId, frameId);
      return { frame_id: frameId, decision };
    }
    const rebuild = this.d.rebuild();
    if (!rebuild)
      throw new SfError(
        'E_STEP_INCOMPLETE',
        `rebuilding frame ${frameId} needs a frame agent session`,
      );
    const rel = `${v}/compositions/frames/${frameId}.html`;
    // sao lưu bản chỉnh tay (D9 5: "sao lưu bản cũ")
    const backup = `${v}/.sf/backups/pinned-${new Date().toISOString().replace(/[:.]/g, '-')}/compositions/frames/${frameId}.html`;
    if (existsSync(store.abs(rel))) store.copyWithin(rel, backup, { by: 'frame.pinned_decide' });
    // bỏ ghim trước khi phiên frame ghi (người dùng đã chọn)
    const { [frameId]: _drop, ...rest } = pins;
    void _drop;
    st.pinned_frames = rest as VideoState['pinned_frames'];
    store.write(stRel, `${JSON.stringify(st, null, 2)}\n`, { by: 'frame.pinned_decide' });
    await rebuild({ store, videoId, frameId, signal: new AbortController().signal });
    let unapplied: Delta['changes'] | undefined;
    if (decision === 'reapply') {
      const fresh = readFileSync(store.abs(rel), 'utf8');
      const r = applyDelta(fresh, delta.changes);
      store.write(rel, r.html, { by: 'frame.pinned_decide', validate: false });
      unapplied = r.unapplied;
      const st2 = JSON.parse(readFileSync(store.abs(stRel), 'utf8')) as VideoState;
      const applied = delta.changes.filter((c) => !r.unapplied.includes(c));
      if (applied.length) {
        st2.pinned_frames = {
          ...(st2.pinned_frames ?? {}),
          [frameId]: {
            pinned_at: new Date().toISOString(),
            base_hash: sha256(fresh),
            changes: applied,
          },
        } as VideoState['pinned_frames'];
        store.write(stRel, `${JSON.stringify(st2, null, 2)}\n`, { by: 'frame.pinned_decide' });
      }
    }
    graph.markBuilt(videoId, [`frame_html:${frameId}`]);
    return { frame_id: frameId, decision, backup, ...(unapplied ? { unapplied } : {}) };
  }
}
