"""Engine `audio-analysis` (CPU, D4 mục 9.3, D8 mục 1, 012): phân tích bài nhạc/SFX khi nạp."""

from __future__ import annotations

import math
from typing import Any

from sf_worker.audio import EngineError

SILENCE_DB = -50.0


def _db(x: float) -> float:
    return 20.0 * math.log10(max(x, 1e-9))


def _energy(rms: float) -> float:
    """RMS → 0–1 theo dBFS (−60 dB → 0, 0 dB → 1)."""
    return round(min(1.0, max(0.0, (_db(rms) + 60.0) / 60.0)), 4)


class AudioAnalysisEngine:
    name = "audio-analysis"

    def __init__(self) -> None:
        # import ở luồng chính (Windows: import lần đầu trong luồng `run` có thể treo, 006)
        try:
            import librosa  # noqa: F401
            import pyloudnorm  # noqa: F401
            import soundfile  # noqa: F401
        except Exception:  # noqa: BLE001
            pass

    def health(self) -> dict[str, Any]:
        try:
            import librosa
            import pyloudnorm  # noqa: F401
            import soundfile
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "engine": self.name, "detail": f"python deps missing: {e}"}
        return {
            "ok": True,
            "engine": self.name,
            "librosa": librosa.__version__,
            "libsndfile": soundfile.__libsndfile_version__,
        }

    def load(self) -> None:
        pass

    def offload(self) -> None:
        pass

    def unload(self) -> None:
        pass

    def run(self, task, params, workdir, progress, cancelled) -> dict[str, Any]:
        if task != "music.analyze":
            raise EngineError("E_SCHEMA_INVALID", f"unknown task {task}")
        return analyze(params["file"], progress)


def analyze(path: str, progress=lambda d, t: None) -> dict[str, Any]:
    import librosa
    import numpy as np
    import pyloudnorm
    import soundfile as sf

    try:
        info = sf.info(path)
        data, sr = sf.read(path, dtype="float32", always_2d=True)
    except Exception as e:  # noqa: BLE001
        raise EngineError("E_AUDIO_UNSUPPORTED", f"cannot decode {path}: {e}") from e
    if data.shape[0] == 0:
        raise EngineError("E_AUDIO_UNSUPPORTED", f"{path} has no audio frames")
    progress(1, 4)
    mono = data.mean(axis=1)
    duration_ms = round(len(mono) * 1000 / sr)

    # độ to (ITU-R BS.1770); bài quá ngắn → −70
    try:
        lufs = float(pyloudnorm.Meter(sr).integrated_loudness(data))
    except Exception:  # noqa: BLE001
        lufs = float("-inf")
    if not math.isfinite(lufs):
        lufs = -70.0

    # RMS mỗi giây + trung bình
    sec = int(sr)
    curve = [
        _energy(float(np.sqrt(np.mean(mono[i : i + sec] ** 2))))
        for i in range(0, len(mono), sec)
        if len(mono[i : i + sec]) > 0
    ]
    energy = _energy(float(np.sqrt(np.mean(mono**2))))
    progress(2, 4)

    # im lặng đầu/cuối (khung 50 ms dưới −50 dBFS)
    hop = max(1, int(sr * 0.05))
    frames = [
        _db(float(np.sqrt(np.mean(mono[i : i + hop] ** 2)))) for i in range(0, len(mono), hop)
    ]
    loud = [i for i, d in enumerate(frames) if d > SILENCE_DB]
    head = loud[0] * 50 if loud else duration_ms
    tail = (len(frames) - 1 - loud[-1]) * 50 if loud else duration_ms
    progress(3, 4)

    out: dict[str, Any] = {
        "duration_ms": duration_ms,
        "sample_rate": int(info.samplerate),
        "channels": int(info.channels),
        "energy": energy,
        "energy_curve": curve,
        "loudness_lufs": round(lufs, 2),
        "silence_head_ms": int(head),
        "silence_tail_ms": int(min(tail, duration_ms)),
    }
    # BPM khi đủ dài (≥ 5 s) — độ tin cậy từ độ nổi đỉnh tempogram [chờ S11]
    if duration_ms >= 5000:
        y = librosa.resample(mono, orig_sr=sr, target_sr=22050) if sr != 22050 else mono
        onset = librosa.onset.onset_strength(y=y, sr=22050)
        tempo, _beats = librosa.beat.beat_track(onset_envelope=onset, sr=22050)
        bpm = float(np.atleast_1d(tempo)[0])
        ac = librosa.autocorrelate(onset - onset.mean())
        ac = ac / (ac[0] + 1e-9)
        lag = int(round(60.0 * 22050 / 512 / max(bpm, 1e-3)))
        conf = float(ac[lag]) if 0 < lag < len(ac) else 0.0
        if bpm > 0:
            out["bpm"] = round(bpm, 1)
            out["bpm_confidence"] = round(min(1.0, max(0.0, conf)), 3)
    progress(4, 4)
    return out
