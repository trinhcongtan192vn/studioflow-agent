// Chính sách tool theo loại phiên — chép đúng bảng D5 mục 4 (một nguồn cho Gateway).
// Read/Glob/Grep/Skill/TodoWrite là tool của runtime, xử lý ở canUseTool (005).

export const SESSION_KINDS = ['main', 'frame', 'producer', 'critic'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

const ALL: SessionKind[] = ['main', 'frame', 'producer', 'critic'];
const MFP: SessionKind[] = ['main', 'frame', 'producer'];
const MF: SessionKind[] = ['main', 'frame'];
const M: SessionKind[] = ['main'];

/** Thứ tự quan trọng: dòng cụ thể trước dòng mẫu. */
const TABLE: [string | RegExp, SessionKind[]][] = [
  ['artifact.read', ALL],
  [/^artifact\.(list|validate)$/, MFP],
  ['config.resolve', MFP],
  ['config.set', M],
  ['artifact.write', MFP],
  ['script.run', MF],
  ['workflow.step_complete', MFP],
  [/^(graph|workflow)\./, M],
  ['approval.annotate', M],
  ['cast.list', M],
  ['asset.import', M],
  ['asset.search', MF],
  [/^image\./, MF],
  [/^(tts|asr|voice|music|sfx|lipsync|grade|media)\./, M],
  ['render.video', M],
  [/^studio\./, M],
  [/^youtube\./, M],
  [/^research\.(scan|get)$/, M],
  [/^autopilot\.plan_(get|run|update)$/, M],
  [/^job\./, MF],
];

/** Loại phiên được gọi tool; tool không có trong bảng → chỉ `main`. */
export function kindsForTool(name: string): SessionKind[] {
  for (const [pattern, kinds] of TABLE) {
    if (typeof pattern === 'string' ? pattern === name : pattern.test(name)) return kinds;
  }
  return M;
}
