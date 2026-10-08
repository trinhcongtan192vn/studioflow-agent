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
    // D6 mục 2/4.2: thời lượng đo trên audio thật (không ước từ số từ/phút)
    gates: () => [
      { kind: 'graph_fresh', nodes: 'audio.line:*' },
      { kind: 'objective', check: 'audio_duration' },
    ],
  },
  assets: {
    by: 'agent',
    reads: r('STORYBOARD'),
    writes: r('assets'),
    outputs: r('assets/manifest.json'),
    // D6 mục 2: mọi layer có asset (023)
    gates: () => [{ kind: 'objective', check: 'assets_resolved' }],
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
    // 027: kiểm khách quan phần hoàn thiện (gói phong cách, dry-run grading, ngân sách, khối overlay)
    gates: () => [{ kind: 'objective', check: 'look_valid' }],
  },
  effects: {
    by: 'agent',
    reads: r('profile'),
    writes: r('STORYBOARD'),
    outputs: r('STORYBOARD.md'),
    // 027: kiểm khách quan phần hoàn thiện (gói phong cách, dry-run grading, ngân sách, khối overlay)
    gates: () => [{ kind: 'objective', check: 'effects_valid' }],
  },
  overlays: {
    by: 'agent',
    reads: r('profile'),
    writes: r('STORYBOARD'),
    outputs: r('STORYBOARD.md'),
    // 027: kiểm khách quan phần hoàn thiện (gói phong cách, dry-run grading, ngân sách, khối overlay)
    gates: () => [{ kind: 'objective', check: 'overlays_valid' }],
  },
  // 062: look + hiệu ứng + overlay trong một phiên agent (thay ba bước riêng, đỡ hai phiên)
  finish: {
    by: 'agent',
    reads: r('profile'),
    writes: r('STORYBOARD'),
    outputs: r('STORYBOARD.md'),
    gates: () => [
      { kind: 'objective', check: 'look_valid' },
      { kind: 'objective', check: 'effects_valid' },
      { kind: 'objective', check: 'overlays_valid' },
    ],
  },
  finalize: {
    by: 'engine',
    reads: r('frames', 'audio', 'captions', 'music'),
    writes: r('index'),
    outputs: r(),
    // D6 mục 2: graph_fresh * + thời lượng timeline trong check.duration_tolerance của mục tiêu
    gates: () => [
      { kind: 'graph_fresh', nodes: '*' },
      { kind: 'objective', check: 'audio_duration', params: { source: 'timeline' } },
      // 061: dòng đọc sai chặn render phát hành → báo sớm ở đây (kiểm mềm)
      { kind: 'objective', check: 'asr_clean' },
    ],
  },
  'publish-meta': {
    by: 'engine',
    reads: r('BRIEF', 'SCRIPT', 'audio'),
    writes: r('publish'),
    outputs: r('publish.md'),
    gates: () => [valid('publish.md'), { kind: 'objective', check: 'meta_limits' }],
  },
  // 063: hình đại diện YouTube theo phong cách kênh (câu móc + ảnh nền), trước render
  thumbnail: {
    by: 'engine',
    reads: r('publish', 'BRIEF', 'frame.md'),
    writes: r('thumbnail'),
    outputs: r('thumbnail.jpg'),
    gates: () => [{ kind: 'objective', check: 'thumbnail_valid' }],
  },
  render: { by: 'engine', reads: r('index'), writes: r('renders'), outputs: r(), gates: () => [] },
  // 091: đăng bản render phát hành lên nền tảng người dùng chọn (video làm tay)
  publish: {
    by: 'engine',
    reads: r('renders', 'publish'),
    writes: r('publish_state'),
    outputs: r(),
    gates: () => [],
  },
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
