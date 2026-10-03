// Mô hình thời gian (D4 mục 8.3): chuỗi lời đọc → audio_meta; frame nối tiếp → frame_timing.

export interface LineDuration {
  line_id: string;
  duration_ms: number;
  pause_after_ms?: number;
}

/** Vị trí các line trên chuỗi lời đọc: nối theo thứ tự SCRIPT + `pause_after_ms` (D3 5.7). */
export function assembleAudioLines(lines: LineDuration[]): {
  lines: { line_id: string; start_ms: number; duration_ms: number }[];
  total_duration_ms: number;
} {
  let t = 0;
  const out = lines.map((l) => {
    const r = { line_id: l.line_id, start_ms: t, duration_ms: l.duration_ms };
    t += l.duration_ms + (l.pause_after_ms ?? 0);
    return r;
  });
  return { lines: out, total_duration_ms: t };
}

export interface FrameTimingInput {
  id: string;
  line_ids: string[];
  /** Giá trị khóa `frame.min_duration_ms` đã giải ở tầng frame. */
  min_duration_ms: number;
  /** Trường `min_duration_ms` của khối `sf-frame` (nếu có). */
  frame_min_duration_ms?: number;
  transition_in?: { type: string; duration_ms: number };
}

export interface FrameTiming {
  frames: { id: string; start_ms: number; duration_ms: number; transition_start_ms?: number }[];
  lines: { id: string; frame_id: string; start_ms: number; duration_ms: number }[];
  total_ms: number;
}

/**
 * Thời lượng frame = Σ(duration + pause) của line; không line → `frame.min_duration_ms`; frame có
 * `min_duration_ms` → lấy giá trị lớn hơn. Frame nối tiếp; transition chồng lên cuối frame trước.
 */
export function computeFrameTiming(
  frames: FrameTimingInput[],
  lines: Record<string, { duration_ms: number; pause_after_ms?: number }>,
): FrameTiming {
  let t = 0;
  const outFrames: FrameTiming['frames'] = [];
  const outLines: FrameTiming['lines'] = [];
  for (const f of frames) {
    let offset = 0;
    for (const id of f.line_ids) {
      const l = lines[id];
      if (!l) throw new Error(`frame ${f.id}: no audio for line ${id}`);
      outLines.push({ id, frame_id: f.id, start_ms: t + offset, duration_ms: l.duration_ms });
      offset += l.duration_ms + (l.pause_after_ms ?? 0);
    }
    let duration = f.line_ids.length ? offset : f.min_duration_ms;
    if (f.frame_min_duration_ms !== undefined)
      duration = Math.max(duration, f.frame_min_duration_ms);
    outFrames.push({
      id: f.id,
      start_ms: t,
      duration_ms: duration,
      ...(f.transition_in && outFrames.length
        ? { transition_start_ms: t - f.transition_in.duration_ms }
        : {}),
    });
    t += duration;
  }
  return { frames: outFrames, lines: outLines, total_ms: t };
}
