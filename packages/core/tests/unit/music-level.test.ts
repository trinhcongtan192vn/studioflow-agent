// Mức nhạc theo loudness giọng: nhạc = giọng + volume_db (kẹp −40…−10 LUFS); không đo được → −20 LUFS.
import { describe, expect, it } from 'vitest';
import { bedFfmpegArgs, DEFAULT_VOICE_LUFS, musicTargetLufs } from '../../src/index.js';

describe('music level relative to the voice', () => {
  it('target = voice loudness + volume_db, clamped', () => {
    expect(musicTargetLufs(-18, -6)).toBe(-24);
    expect(musicTargetLufs(undefined, -6)).toBe(DEFAULT_VOICE_LUFS - 6);
    expect(musicTargetLufs(-12, 10)).toBe(-10);
    expect(musicTargetLufs(-35, -20)).toBe(-40);
  });

  it('the ffmpeg chain normalizes to that target and no longer subtracts volume_db again', () => {
    const args = bedFfmpegArgs(
      {
        segments: [{ track_id: 'mt_a', file: 'a.mp3', start_ms: 0, end_ms: 10_000, volume_db: -6 }],
        voice: [{ start_ms: 1000, end_ms: 4000 }],
        total_ms: 10_000,
        duck_db: -8,
        voice_lufs: -19,
      },
      'out.wav',
    ).join(' ');
    expect(args).toContain('loudnorm=I=-25:');
    expect(args).not.toMatch(/volume=-6dB/);
    expect(args).not.toContain('loudnorm=I=-24:');
  });
});
