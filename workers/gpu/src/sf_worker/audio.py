"""Tiện ích WAV (stdlib): đầu ra TTS luôn PCM 16-bit mono 48 kHz (D4 mục 3, 006 FR-005)."""

from __future__ import annotations

import math
import struct
import wave
from collections.abc import Iterable
from pathlib import Path

OUTPUT_SR = 48000


def write_pcm16(path: str | Path, samples: Iterable[float], sample_rate: int = OUTPUT_SR) -> int:
    """Ghi mẫu float [-1, 1] thành WAV PCM 16-bit mono. Trả số mẫu."""
    frames = bytearray()
    n = 0
    for s in samples:
        v = max(-1.0, min(1.0, float(s)))
        frames += struct.pack("<h", int(round(v * 32767)))
        n += 1
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(bytes(frames))
    return n


def wav_info(path: str | Path) -> dict[str, int]:
    """`{sample_rate, channels, frames, duration_ms}` của file WAV PCM."""
    with wave.open(str(path), "rb") as w:
        sr, ch, nf = w.getframerate(), w.getnchannels(), w.getnframes()
    return {"sample_rate": sr, "channels": ch, "frames": nf, "duration_ms": round(nf * 1000 / sr)}


def sine(duration_ms: int, freq: float = 220.0, sample_rate: int = OUTPUT_SR) -> list[float]:
    """Sóng sin xác định (provider giả `tts.fake`, D12 mục 2)."""
    n = int(sample_rate * duration_ms / 1000)
    return [0.3 * math.sin(2 * math.pi * freq * i / sample_rate) for i in range(n)]


def check_ref_duration(duration_ms: int, min_ms: int = 3000, max_ms: int = 10000) -> None:
    """Ref audio cho clone giọng 3–10 giây (Phụ lục A)."""
    if duration_ms < min_ms or duration_ms > max_ms:
        raise EngineError(
            "E_AUDIO_UNSUPPORTED",
            f"ref audio must be {min_ms // 1000}-{max_ms // 1000} s, "
            f"got {duration_ms / 1000:.1f} s",
        )


class EngineError(Exception):
    """Lỗi có mã (registry docs/contracts/errors.json)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
