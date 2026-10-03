"""Engine OmniVoice (k2-fsa/OmniVoice): clone giọng + TTS theo line (006, D4 mục 4.3)."""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from sf_worker.audio import OUTPUT_SR, EngineError, check_ref_duration

MODEL_ID = os.environ.get("SF_OMNIVOICE_MODEL", "k2-fsa/OmniVoice")
MODEL_SR = 24000


class OmniVoiceEngine:
    name = "omnivoice"

    def __init__(self) -> None:
        self.model = None
        self.device = "cpu"
        self._prompts: dict[str, Any] = {}

    # ---------- vòng đời ----------

    def health(self) -> dict[str, Any]:
        try:
            import omnivoice  # noqa: F401
            import torch  # noqa: F401
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "engine": self.name, "detail": f"python deps missing: {e}"}
        import torch

        cuda = torch.cuda.is_available()
        return {
            "ok": True,
            "engine": self.name,
            "cuda": cuda,
            "device": torch.cuda.get_device_name(0) if cuda else "cpu",
            "loaded": self.model is not None,
        }

    def load(self) -> None:
        import torch
        from omnivoice import OmniVoice

        target = "cuda:0" if torch.cuda.is_available() else "cpu"
        if self.model is None:
            dtype = torch.float16 if target.startswith("cuda") else torch.float32
            self.model = OmniVoice.from_pretrained(MODEL_ID, device_map=target, dtype=dtype)
        elif self.device != target:
            self.model.to(target)
        self.device = target

    def offload(self) -> None:
        """VRAM → RAM (lịch GPU, D4 mục 6)."""
        if self.model is not None and self.device != "cpu":
            import torch

            self.model.to("cpu")
            self.device = "cpu"
            torch.cuda.empty_cache()

    def unload(self) -> None:
        if self.model is not None:
            import torch

            self.model = None
            self._prompts.clear()
            torch.cuda.empty_cache()

    # ---------- tác vụ ----------

    def _prompt(self, path: str):
        from omnivoice import VoiceClonePrompt

        key = f"{path}:{os.path.getmtime(path)}"
        if key not in self._prompts:
            self._prompts[key] = VoiceClonePrompt.load(path)
        return self._prompts[key]

    def run(self, task, params, workdir, progress, cancelled) -> dict[str, Any]:
        import numpy as np
        import soundfile as sf
        import torch
        import torchaudio

        if self.model is None or self.device == "cpu":
            self.load()
        model = self.model
        if task in ("tts.synthesize", "auto"):
            text = (params.get("text") or "").strip()
            if not text:
                raise EngineError("E_SCHEMA_INVALID", "text is empty")
            kwargs: dict[str, Any] = {"text": text}
            if params.get("speed"):
                kwargs["speed"] = float(params["speed"])
            if params.get("num_step"):
                kwargs["num_step"] = int(params["num_step"])
            if task == "tts.synthesize" and params.get("voice_prompt"):
                kwargs["voice_clone_prompt"] = self._prompt(params["voice_prompt"])
            if torch.cuda.is_available():
                torch.cuda.reset_peak_memory_stats()
            t0 = time.perf_counter()
            audio = model.generate(**kwargs)[0]
            elapsed = time.perf_counter() - t0
            wav = torch.from_numpy(np.asarray(audio, dtype=np.float32)).unsqueeze(0)
            wav = torchaudio.functional.resample(wav, MODEL_SR, OUTPUT_SR).squeeze(0).numpy()
            out = Path(workdir, "out.wav")
            sf.write(str(out), np.clip(wav, -1.0, 1.0), OUTPUT_SR, subtype="PCM_16")
            duration_ms = round(len(wav) * 1000 / OUTPUT_SR)
            progress(1, 1)
            return {
                "file": "out.wav",
                "duration_ms": duration_ms,
                "sample_rate": OUTPUT_SR,
                "rtf": round(elapsed / max(duration_ms / 1000, 1e-6), 4),
                "vram_peak_mb": round(torch.cuda.max_memory_allocated() / 2**20)
                if torch.cuda.is_available()
                else 0,
            }
        if task == "voice.profile":
            ref = params["ref_audio"]
            info = sf.info(ref)
            check_ref_duration(round(info.frames * 1000 / info.samplerate))
            data, sr = sf.read(ref, dtype="float32", always_2d=True)
            mono = torch.from_numpy(data.mean(axis=1)).unsqueeze(0)
            mono = torchaudio.functional.resample(mono, sr, MODEL_SR).squeeze(0).numpy()
            ref_out = Path(workdir, "ref.wav")
            sf.write(str(ref_out), mono, MODEL_SR, subtype="PCM_16")
            prompt = model.create_voice_clone_prompt(
                ref_audio=str(ref_out), ref_text=params.get("ref_text") or None
            )
            prompt.save(str(Path(workdir, "voice.pt")))
            progress(1, 1)
            return {
                "voice": "voice.pt",
                "ref": "ref.wav",
                "ref_text": getattr(prompt, "ref_text", None) or params.get("ref_text") or "",
            }
        raise EngineError("E_SCHEMA_INVALID", f"unknown task {task}")
