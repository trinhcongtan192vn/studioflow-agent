/** WAV PCM16 mono: click 1 kHz theo nhịp `bpm` (cho kiểm BPM thật, 012). */
export function clickWav(
  bpm: number,
  seconds: number,
  opts: { sampleRate?: number; amp?: number } = {},
): Buffer {
  const sr = opts.sampleRate ?? 16000;
  const n = Math.round(sr * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  const step = Math.round((sr * 60) / bpm);
  const amp = opts.amp ?? 0.6;
  for (let i = 0; i < n; i++) {
    const k = i % step;
    // click tắt dần + nền nhẹ (nhạc có năng lượng liên tục)
    const v =
      (k < sr / 20
        ? amp * Math.exp(-k / (sr / 200)) * Math.sin((2 * Math.PI * 1000 * k) / sr)
        : 0) +
      0.05 * Math.sin((2 * Math.PI * 220 * i) / sr);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  return buf;
}
