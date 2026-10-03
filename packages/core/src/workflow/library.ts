import type { GateDecl, StepDecl, StepLibraryId, WorkflowManifest } from '../contracts/types.js';

export interface StepSpec {
  by: 'engine' | 'agent';
  /** Token dữ liệu đọc/ghi (D6 mục 2) — dùng kiểm thứ tự (`E_STEP_ORDER`). */
  reads: (params?: Record<string, unknown>) => string[];
  writes: (params?: Record<string, unknown>) => string[];
  /** File đầu ra mặc định (tương đối video) — đưa vào `artifact_hashes` của approval. */
  outputs: (params?: Record<string, unknown>) => string[];
  gates: (params?: Record<string, unknown>) => GateDecl[];
}

const r =
  (...t: string[]) =>
  () =>
    t;
const valid = (path: string): GateDecl => ({ kind: 'artifact_valid', path });

/** Thư viện bước — chép bảng D6 mục 2 (một nguồn). */
export const STEP_LIBRARY: Record<StepLibraryId, StepSpec> = {
  'design-system': {
    by: 'engine',
    reads: r('profile', 'channel.json'),
    writes: r('frame.md'),
    outputs: r('frame.md'),
    gates: () => [valid('frame.md')],
  },
  script: {
    by: 'engine',
    reads: (p) =>
      p?.mode === 'screenplay' ? ['BRIEF', 'prompts', 'STORY', 'CAST'] : ['BRIEF', 'prompts'],
    writes: (p) => (p?.mode === 'outline' ? ['STORY'] : ['SCRIPT']),
    outputs: (p) => (p?.mode === 'outline' ? ['STORY.md'] : ['SCRIPT.md']),
    gates: (p) => [valid(p?.mode === 'outline' ? 'STORY.md' : 'SCRIPT.md')],
  },
  storyboard: {
    by: 'agent',
    reads: r('BRIEF', 'SCRIPT', 'frame.md', 'blueprint'),
    writes: r('STORYBOARD'),
    outputs: r('STORYBOARD.md'),
    gates: () => [valid('STORYBOARD.md'), { kind: 'objective', check: 'coverage' }],
  },
  cast: {
    by: 'agent',
    reads: r('STORY', 'BRIEF'),
    writes: r('CAST', 'characters'),
    outputs: r('CAST.md'),
    gates: () => [valid('CAST.md')],
  },
  voice: {
    by: 'engine',
    reads: r('SCRIPT', 'CAST'),
    writes: r('audio'),
    outputs: r('audio_meta.json'),
    gates: () => [{ kind: 'graph_fresh', nodes: 'audio.line:*' }],
  },
  assets: {
    by: 'agent',
    reads: r('STORYBOARD'),
    writes: r('assets'),
    outputs: r('assets/manifest.json'),
    gates: () => [],
  },
  lipsync: {
    by: 'engine',
    reads: r('audio', 'CAST'),
    writes: r('lipsync'),
    outputs: r(),
    gates: () => [],
  },
  'frame-build': {
    by: 'agent',
    reads: r('STORYBOARD', 'audio', 'frame.md', 'assets', 'lipsync'),
    writes: r('frames'),
    outputs: r(),
    gates: () => [],
  },
  animatic: {
    by: 'engine',
    reads: r('STORYBOARD', 'audio', 'assets'),
    writes: r('renders'),
    outputs: r(),
    gates: () => [],
  },
  captions: {
    by: 'engine',
    reads: r('audio', 'SCRIPT'),
    writes: r('captions'),
    outputs: r('caption_groups.json'),
    gates: () => [valid('caption_groups.json')],
  },
  music: {
    by: 'agent',
    reads: r('STORYBOARD', 'music'),
    writes: r('music', 'STORYBOARD'),
    outputs: r('STORYBOARD.md'),
    gates: () => [],
  },
  look: {
    by: 'agent',
    reads: r('profile'),
    writes: r('STORYBOARD'),
    outputs: r('STORYBOARD.md'),
    gates: () => [],
  },
  effects: {
    by: 'agent',
    reads: r('profile'),
    writes: r('STORYBOARD'),
    outputs: r('STORYBOARD.md'),
    gates: () => [],
  },
  overlays: {
    by: 'agent',
    reads: r('profile'),
    writes: r('STORYBOARD'),
    outputs: r('STORYBOARD.md'),
    gates: () => [],
  },
  finalize: {
    by: 'engine',
    reads: r('frames', 'audio', 'captions', 'music'),
    writes: r('index'),
    outputs: r(),
    gates: () => [{ kind: 'graph_fresh', nodes: '*' }],
  },
  'publish-meta': {
    by: 'engine',
    reads: r('BRIEF', 'SCRIPT'),
    writes: r('publish'),
    outputs: r('publish.md'),
    gates: () => [valid('publish.md'), { kind: 'objective', check: 'meta_limits' }],
  },
  render: { by: 'engine', reads: r('index'), writes: r('renders'), outputs: r(), gates: () => [] },
};

export interface ManifestError {
  code: 'E_SCHEMA_INVALID' | 'E_STEP_ORDER';
  message: string;
}

/** Thứ tự thực thi suy từ `after` (mặc định: bước trước), ổn định theo thứ tự manifest. */
export function executionOrder(steps: StepDecl[]): { order: string[]; cycle: boolean } {
  const deps = new Map(steps.map((s, i) => [s.id, s.after ?? (i > 0 ? [steps[i - 1]!.id] : [])]));
  const done = new Set<string>();
  const order: string[] = [];
  let progressed = true;
  while (order.length < steps.length && progressed) {
    progressed = false;
    for (const s of steps) {
      if (done.has(s.id)) continue;
      if ((deps.get(s.id) ?? []).every((d) => done.has(d) || !deps.has(d))) {
        done.add(s.id);
        order.push(s.id);
        progressed = true;
      }
    }
  }
  return { order, cycle: order.length < steps.length };
}

/** Kiểm manifest ngoài schema: id trùng, `after` lạ, vòng, thứ tự dữ liệu (D6 mục 2, 9). */
export function validateManifest(m: WorkflowManifest): ManifestError[] {
  const errors: ManifestError[] = [];
  const ids = new Set<string>();
  for (const s of m.steps) {
    if (ids.has(s.id))
      errors.push({ code: 'E_SCHEMA_INVALID', message: `duplicate step id ${s.id}` });
    ids.add(s.id);
  }
  for (const s of m.steps) {
    for (const a of s.after ?? [])
      if (!ids.has(a))
        errors.push({ code: 'E_SCHEMA_INVALID', message: `step ${s.id}: after unknown step ${a}` });
  }
  const { order, cycle } = executionOrder(m.steps);
  if (cycle) errors.push({ code: 'E_SCHEMA_INVALID', message: 'steps have a dependency cycle' });
  const byId = new Map(m.steps.map((s) => [s.id, s]));
  order.forEach((id, i) => {
    const s = byId.get(id)!;
    const spec = STEP_LIBRARY[s.uses];
    const earlier = new Set(
      order.slice(0, i).flatMap((e) => STEP_LIBRARY[byId.get(e)!.uses].writes(byId.get(e)!.params)),
    );
    const later = new Set(
      order
        .slice(i + 1)
        .flatMap((e) => STEP_LIBRARY[byId.get(e)!.uses].writes(byId.get(e)!.params)),
    );
    for (const token of spec.reads(s.params)) {
      if (!earlier.has(token) && later.has(token)) {
        errors.push({
          code: 'E_STEP_ORDER',
          message: `step ${s.id} reads ${token} which is only written by a later step`,
        });
      }
    }
  });
  return errors;
}
