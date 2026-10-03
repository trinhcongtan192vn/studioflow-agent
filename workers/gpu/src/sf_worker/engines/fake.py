"""Engine giả (stdlib) — kiểm giao thức worker và chạy CI không GPU (D12 mục 2)."""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Any

from sf_worker.audio import EngineError, check_ref_duration, sine, wav_info, write_pcm16

MS_PER_CHAR = 60


class FakeEngine:
    name = "fake"

    def __init__(self) -> None:
        self.loaded = False

    def health(self) -> dict[str, Any]:
        return {"ok": True, "engine": self.name, "loaded": self.loaded}

    def load(self) -> None:
        self.loaded = True

    def offload(self) -> None:
        self.loaded = False

    def unload(self) -> None:
        self.loaded = False

    def run(self, task, params, workdir, progress, cancelled) -> dict[str, Any]:
        if task == "tts.synthesize":
            text = params.get("text") or ""
            if not text.strip():
                raise EngineError("E_SCHEMA_INVALID", "text is empty")
            duration = max(200, len(text) * MS_PER_CHAR)
            write_pcm16(Path(workdir, "out.wav"), sine(duration))
            progress(1, 1)
            return {"file": "out.wav", "duration_ms": duration, "sample_rate": 48000}
        if task == "voice.profile":
            ref = params["ref_audio"]
            check_ref_duration(wav_info(ref)["duration_ms"])
            shutil.copyfile(ref, Path(workdir, "ref.wav"))
            Path(workdir, "voice.pt").write_bytes(b"fake-voice:" + Path(ref).read_bytes()[:64])
            progress(1, 1)
            return {"voice": "voice.pt", "ref": "ref.wav", "ref_text": params.get("ref_text") or ""}
        if task == "sleep":
            end = time.monotonic() + params.get("ms", 1000) / 1000
            while time.monotonic() < end:
                if cancelled():
                    raise EngineError("E_JOB_CANCELED", "canceled")
                time.sleep(0.01)
            return {"slept": True}
        if task == "crash":
            os._exit(3)
        raise EngineError("E_SCHEMA_INVALID", f"unknown task {task}")
