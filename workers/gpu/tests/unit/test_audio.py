"""006 FR-005, US2 AC2 — WAV 48 kHz mono 16-bit, kiểm độ dài ref."""

import pytest

from sf_worker.audio import EngineError, check_ref_duration, sine, wav_info, write_pcm16


def test_write_and_read_back(tmp_path):
    p = tmp_path / "a.wav"
    n = write_pcm16(p, sine(250))
    assert n == 12000
    assert wav_info(p) == {"sample_rate": 48000, "channels": 1, "frames": 12000, "duration_ms": 250}


def test_values_are_clipped(tmp_path):
    p = tmp_path / "c.wav"
    write_pcm16(p, [2.0, -2.0, 0.0])
    assert wav_info(p)["frames"] == 3


@pytest.mark.parametrize("ms", [2999, 10001])
def test_ref_duration_bounds(ms):
    with pytest.raises(EngineError) as e:
        check_ref_duration(ms)
    assert e.value.code == "E_AUDIO_UNSUPPORTED"


def test_ref_duration_ok():
    check_ref_duration(3000)
    check_ref_duration(10000)
