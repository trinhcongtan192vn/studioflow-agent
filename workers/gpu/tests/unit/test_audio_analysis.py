"""012 FR-MU-02 — phân tích bài: thời lượng, BPM, energy, LUFS, im lặng."""

import numpy as np
import soundfile as sf

from sf_worker.engines.audio_analysis import analyze


def click_track(path, bpm=90.0, seconds=12.0, sr=44100, lead_silence=1.0):
    n = int(sr * seconds)
    y = np.zeros(n, dtype=np.float32)
    start = int(sr * lead_silence)
    step = int(sr * 60.0 / bpm)
    for i in range(start, n, step):
        k = np.arange(min(2000, n - i))
        y[i : i + len(k)] += 0.8 * np.sin(2 * np.pi * 1000 * k / sr) * np.exp(-k / 300)
    sf.write(path, np.stack([y, y], axis=1), sr)


def test_analyze_click_track(tmp_path):
    f = tmp_path / "click.wav"
    click_track(f)
    a = analyze(str(f))
    assert a["duration_ms"] == 12000
    assert a["sample_rate"] == 44100 and a["channels"] == 2
    assert abs(a["bpm"] - 90) <= 3 or abs(a["bpm"] / 2 - 90) <= 3 or abs(a["bpm"] * 2 - 90) <= 3
    assert 0 <= a["bpm_confidence"] <= 1
    assert 0 < a["energy"] < 1 and len(a["energy_curve"]) == 12
    assert -70 <= a["loudness_lufs"] < 0
    assert 900 <= a["silence_head_ms"] <= 1100


def test_short_sfx_has_no_bpm(tmp_path):
    f = tmp_path / "pop.wav"
    sf.write(f, (0.5 * np.sin(np.linspace(0, 400, 22050))).astype(np.float32), 22050)
    a = analyze(str(f))
    assert a["duration_ms"] == 1000 and "bpm" not in a
