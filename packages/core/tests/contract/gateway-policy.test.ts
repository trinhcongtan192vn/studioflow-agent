// 003 · US2 AC1 · FR-004 · SC-002 — bảng chính sách D5 mục 4.
import { describe, expect, it } from 'vitest';
import { kindsForTool, SESSION_KINDS } from '../../src/index.js';

// Bảng D5 mục 4 (chỉ cột Gateway; Read/Glob/Grep/Skill/TodoWrite là tool runtime, thuộc 005).
const D5: [string, string[]][] = [
  ['artifact.read', ['main', 'frame', 'producer', 'critic']],
  ['artifact.list', ['main', 'frame', 'producer']],
  ['artifact.validate', ['main', 'frame', 'producer']],
  ['config.resolve', ['main', 'frame', 'producer']],
  ['config.set', ['main']],
  ['artifact.write', ['main', 'frame', 'producer']],
  ['script.run', ['main', 'frame']],
  ['graph.status', ['main']],
  ['graph.build', ['main']],
  ['workflow.list', ['main']],
  ['workflow.select', ['main']],
  ['workflow.run_to', ['main']],
  ['workflow.pause', ['main']],
  ['workflow.rewind', ['main']],
  ['workflow.state', ['main']],
  ['workflow.gate_check', ['main']],
  ['approval.annotate', ['main']],
  ['workflow.step_complete', ['main', 'frame', 'producer']],
  ['asset.import', ['main']],
  ['asset.search', ['main', 'frame']],
  ['tts.synthesize', ['main']],
  ['asr.align', ['main']],
  ['voice.profile_create', ['main']],
  ['voice.design', ['main']],
  ['music.find', ['main']],
  ['sfx.find', ['main']],
  ['lipsync.cues', ['main']],
  ['grade.compare', ['main']],
  ['media.treatment', ['main']],
  ['image.generate', ['main', 'frame']],
  ['image.edit', ['main', 'frame']],
  ['render.video', ['main']],
  ['studio.open', ['main']],
  ['job.status', ['main', 'frame']],
  ['job.wait', ['main', 'frame']],
];

describe('Gateway policy table = D5 section 4 (003 SC-002)', () => {
  for (const [tool, kinds] of D5) {
    it(tool, () => {
      for (const k of SESSION_KINDS)
        expect(kindsForTool(tool).includes(k), `${tool} × ${k}`).toBe(kinds.includes(k));
    });
  }

  it('unknown tools are main-only', () => {
    expect(kindsForTool('brand.new')).toEqual(['main']);
  });
});
