/** WAV PCM 16-bit mono (mặc định 48 kHz) chứa sóng sin xác định — dùng cho provider giả (D12 mục 2). */
export function encodeWav(
  durationMs: number,
  opts: { sampleRate?: number; freq?: number } = {},
): Buffer {
  const sr = opts.sampleRate ?? 48000;
  const freq = opts.freq ?? 220;
  const n = Math.round((sr * durationMs) / 1000);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * freq * i) / sr)), 44 + i * 2);
  return buf;
}

/** Thời lượng (ms) của WAV PCM từ header. */
export function wavDurationMs(buf: Buffer): number {
  const sr = buf.readUInt32LE(24);
  const bytesPerFrame = buf.readUInt16LE(32);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return Math.round(((size / bytesPerFrame) * 1000) / sr);
    off += 8 + size;
  }
  return 0;
}
