"""006 SC-001/002 — OmniVoice thật qua worker (máy tham chiếu, nhãn gpu)."""

import json
import os
from pathlib import Path

import pytest

from sf_worker.audio import wav_info
from tests.worker_helpers import WorkerProc

REF_TEXT = (
    "Xin chào các bạn, hôm nay chúng ta sẽ cùng nhau tìm hiểu "
    "một câu chuyện lịch sử thú vị của Việt Nam."
)

ENV_PY = Path(
    os.environ.get("APPDATA", ""),
    "StudioFlow",
    "providers",
    "python",
    "omnivoice",
    "Scripts",
    "python.exe",
)


@pytest.mark.gpu
@pytest.mark.skipif(
    not ENV_PY.exists(), reason="omnivoice engine env not installed (scripts/setup-engine.mjs)"
)
def test_clone_and_speak_vietnamese(tmp_path):
    w = WorkerProc("omnivoice", python=str(ENV_PY))
    try:
        h = w.call("health")["result"]
        assert h["ok"] and h["cuda"], h
        auto = tmp_path / "auto"
        auto.mkdir()
        r = w.call(
            "run",
            {
                "job_id": "a",
                "task": "auto",
                "input": {"text": REF_TEXT},
                "workdir": str(auto),
            },
        )
        assert "result" in r, r
        ref_ms = wav_info(auto / "out.wav")["duration_ms"]
        assert 3000 <= ref_ms <= 10000, ref_ms
        voice = tmp_path / "voice"
        voice.mkdir()
        r = w.call(
            "run",
            {
                "job_id": "v",
                "task": "voice.profile",
                "input": {
                    "ref_audio": str(auto / "out.wav"),
                    "ref_text": REF_TEXT,
                },
                "workdir": str(voice),
            },
        )
        assert r["result"]["voice"] == "voice.pt", r
        out = tmp_path / "out"
        out.mkdir()
        r = w.call(
            "run",
            {
                "job_id": "t",
                "task": "tts.synthesize",
                "input": {
                    "text": "Năm một nghìn bốn trăm hai mươi tám, Lê Lợi lên ngôi.",
                    "voice_prompt": str(voice / "voice.pt"),
                },
                "workdir": str(out),
            },
        )
        res = r["result"]
        info = wav_info(out / "out.wav")
        assert info["sample_rate"] == 48000 and info["channels"] == 1
        assert 1500 < res["duration_ms"] < 15000
        print(
            "S1",
            json.dumps(
                {
                    "rtf": res["rtf"],
                    "vram_peak_mb": res["vram_peak_mb"],
                    "duration_ms": res["duration_ms"],
                }
            ),
        )
        assert res["vram_peak_mb"] <= 6 * 1024
    finally:
        w.close()


@pytest.mark.gpu
@pytest.mark.skipif(
    not ENV_PY.exists(), reason="omnivoice engine env not installed (scripts/setup-engine.mjs)"
)
def test_seed_makes_generation_reproducible(tmp_path):
    """010 FR-009 — cùng seed → cùng audio; seed khác → audio khác (sinh lại khi ASR lệch)."""
    w = WorkerProc("omnivoice", python=str(ENV_PY))
    try:
        outs = []
        for i, seed in enumerate([7, 7, 8]):
            d = tmp_path / f"s{i}"
            d.mkdir()
            r = w.call(
                "run",
                {
                    "job_id": f"s{i}",
                    "task": "auto",
                    "input": {"text": "Bầu trời màu xanh.", "seed": seed},
                    "workdir": str(d),
                },
            )
            assert "result" in r, r
            outs.append((d / "out.wav").read_bytes())
        assert outs[0] == outs[1]
        assert outs[0] != outs[2]
    finally:
        w.close()


@pytest.mark.gpu
@pytest.mark.skipif(
    not ENV_PY.exists(), reason="omnivoice engine env not installed (scripts/setup-engine.mjs)"
)
def test_voice_design_vietnamese_then_speak(tmp_path):
    """033 SC-004 — giọng gợi ý từ mô tả (tiếng Việt): câu mẫu 3–10 s → voice.pt → TTS line."""
    w = WorkerProc("omnivoice", python=str(ENV_PY))
    try:
        voice = tmp_path / "design"
        voice.mkdir()
        r = w.call(
            "run",
            {
                "job_id": "d",
                "task": "voice.design",
                "input": {
                    "text": (
                        "Xin chào các bạn. Đây là giọng đọc gợi ý cho kênh của bạn. "
                        "Hãy nghe thử xem giọng này có hợp với nội dung video hay không nhé."
                    ),
                    "instruct": "female, young adult, moderate pitch",
                    "language": "vi",
                    "seed": 1,
                },
                "workdir": str(voice),
            },
        )
        assert "result" in r, r
        assert r["result"]["voice"] == "voice.pt"
        ms = wav_info(voice / "ref.wav")["duration_ms"]
        assert 3000 <= ms <= 15000, ms
        out = tmp_path / "out"
        out.mkdir()
        r = w.call(
            "run",
            {
                "job_id": "t",
                "task": "tts.synthesize",
                "input": {
                    "text": "Năm một nghìn bốn trăm hai mươi tám, Lê Lợi lên ngôi.",
                    "voice_prompt": str(voice / "voice.pt"),
                },
                "workdir": str(out),
            },
        )
        assert 1500 < r["result"]["duration_ms"] < 15000, r
        bad = tmp_path / "bad"
        bad.mkdir()
        r = w.call(
            "run",
            {
                "job_id": "b",
                "task": "voice.design",
                "input": {"text": "Xin chào các bạn.", "instruct": "robot voice"},
                "workdir": str(bad),
            },
        )
        assert r["error"]["data"]["code"] == "E_SCHEMA_INVALID", r
        print("033 design ref_ms", ms)
    finally:
        w.close()
