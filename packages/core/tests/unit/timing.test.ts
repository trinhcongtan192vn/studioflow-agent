// 004 · US4 — audio_meta và frame_timing (D4 mục 8.3).
import { describe, expect, it } from 'vitest';
import { assembleAudioLines, computeFrameTiming } from '../../src/index.js';

describe('assembleAudioLines (004 US4 AC1)', () => {
  it('chains lines in script order with pauses', () => {
    const r = assembleAudioLines([
      { line_id: 'ln_a', duration_ms: 1000, pause_after_ms: 300 },
      { line_id: 'ln_b', duration_ms: 500 },
      { line_id: 'ln_c', duration_ms: 200, pause_after_ms: 100 },
    ]);
    expect(r.lines.map((l) => [l.line_id, l.start_ms])).toEqual([
      ['ln_a', 0],
      ['ln_b', 1300],
      ['ln_c', 1800],
    ]);
    expect(r.total_duration_ms).toBe(2100);
  });
});

describe('computeFrameTiming (004 US4 AC2)', () => {
  const lines = {
    ln_a: { duration_ms: 1000, pause_after_ms: 300 },
    ln_b: { duration_ms: 500, pause_after_ms: 0 },
    ln_c: { duration_ms: 200, pause_after_ms: 100 },
  };

  it('frame duration = Σ(line + pause); frames are sequential; lines get absolute starts', () => {
    const t = computeFrameTiming(
      [
        { id: 'fr_1', line_ids: ['ln_a', 'ln_b'], min_duration_ms: 2000 },
        { id: 'fr_2', line_ids: [], min_duration_ms: 2000 },
        {
          id: 'fr_3',
          line_ids: ['ln_c'],
          min_duration_ms: 2000,
          transition_in: { type: 'crossfade', duration_ms: 600 },
        },
      ],
      lines,
    );
    expect(t.frames).toEqual([
      { id: 'fr_1', start_ms: 0, duration_ms: 1800 },
      { id: 'fr_2', start_ms: 1800, duration_ms: 2000 },
      { id: 'fr_3', start_ms: 3800, duration_ms: 300, transition_start_ms: 3200 },
    ]);
    expect(t.lines).toEqual([
      { id: 'ln_a', frame_id: 'fr_1', start_ms: 0, duration_ms: 1000 },
      { id: 'ln_b', frame_id: 'fr_1', start_ms: 1300, duration_ms: 500 },
      { id: 'ln_c', frame_id: 'fr_3', start_ms: 3800, duration_ms: 200 },
    ]);
    expect(t.total_ms).toBe(4100);
  });

  it('a frame-level min_duration_ms wins when larger than its lines', () => {
    const t = computeFrameTiming(
      [{ id: 'fr_1', line_ids: ['ln_b'], min_duration_ms: 2000, frame_min_duration_ms: 3000 }],
      lines,
    );
    expect(t.frames[0]!.duration_ms).toBe(3000);
  });
});
