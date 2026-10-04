"""Engine `clap` (CPU, D4 mục 4.3, D8 mục 1, 021): embedding âm thanh/văn bản để tìm nhạc.

Model `laion/clap-htsat-unfused` (Apache-2.0; bản `larger_clap_music` trên HF suy biến,
021 R1), đọc từ cache Hugging Face của app (`HF_HOME`).
"""

from __future__ import annotations

import os
from typing import Any

from sf_worker.audio import EngineError

MODEL_ID = "laion/clap-htsat-unfused"
SR = 48_000
WINDOW_S = 10.0


class ClapEngine:
    name = "clap"

    def __init__(self) -> None:
        self.model: Any = None
        self.processor: Any = None
        # import ở luồng chính (Windows: import lần đầu trong luồng `run` có thể treo, 006)
        try:
            import librosa  # noqa: F401
            import numpy  # noqa: F401
            import torch  # noqa: F401
            from transformers import ClapModel, ClapProcessor  # noqa: F401
        except Exception:  # noqa: BLE001
            pass

    def health(self) -> dict[str, Any]:
        try:
            import torch
            import transformers
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "engine": self.name, "detail": f"python deps missing: {e}"}
        hf = os.environ.get("HF_HOME", "")
        snap = os.path.join(hf, "hub", "models--laion--clap-htsat-unfused")
        if hf and not os.path.isdir(snap):
            return {"ok": False, "engine": self.name, "detail": f"CLAP model not installed: {snap}"}
        return {
            "ok": True,
            "engine": self.name,
            "torch": torch.__version__,
            "transformers": transformers.__version__,
        }

    def load(self) -> None:
        if self.model is not None:
            return
        from transformers import ClapModel, ClapProcessor

        self.model = ClapModel.from_pretrained(MODEL_ID, local_files_only=True).eval()
        self.processor = ClapProcessor.from_pretrained(MODEL_ID, local_files_only=True)

    def offload(self) -> None:
        pass  # CPU: không giữ VRAM

    def unload(self) -> None:
        self.model = None
        self.processor = None

    def _unit(self, x: Any) -> Any:
        return x / x.norm(dim=-1, keepdim=True).clamp_min(1e-9)

    def embed_audio(self, file: str) -> Any:
        import librosa
        import torch

        try:
            y, _ = librosa.load(file, sr=SR, mono=True)
        except Exception as e:  # noqa: BLE001
            raise EngineError("E_AUDIO_UNSUPPORTED", f"cannot read {file}: {e}") from e
        n = int(WINDOW_S * SR)
        if len(y) <= n:
            clips = [y]
        else:
            # ba cửa sổ 10 s ở 25 % / 50 % / 75 % độ dài: đại diện cả bài, chi phí cố định
            clips = [
                y[int(p * (len(y) - n)) : int(p * (len(y) - n)) + n] for p in (0.25, 0.5, 0.75)
            ]
        try:
            inputs = self.processor(audio=clips, sampling_rate=SR, return_tensors="pt")
        except TypeError:
            inputs = self.processor(audios=clips, sampling_rate=SR, return_tensors="pt")
        with torch.no_grad():
            feats = self._feats(self.model.get_audio_features(**inputs))
        return self._unit(self._unit(feats).mean(dim=0))

    def _feats(self, out: Any) -> Any:
        # transformers 5 có thể trả đối tượng output thay vì tensor
        return out if hasattr(out, "norm") else out.pooler_output

    def embed_texts(self, texts: list[str]) -> Any:
        import torch

        inputs = self.processor(text=texts, return_tensors="pt", padding=True)
        with torch.no_grad():
            return self._unit(self._feats(self.model.get_text_features(**inputs)))

    def run(self, task, params, workdir, progress, cancelled) -> dict[str, Any]:
        import numpy as np

        self.load()
        if task == "music.embed":
            v = self.embed_audio(params["file"]).numpy().astype(np.float32)
            out = os.path.join(workdir, "embedding.npy")
            np.save(out, v)
            progress(1, 1)
            return {"file": "embedding.npy", "dim": int(v.shape[0]), "model": MODEL_ID}
        if task == "text.embed":
            m = self.embed_texts(list(params["texts"])).numpy().astype(np.float32)
            progress(1, 1)
            return {"vectors": m.tolist(), "model": MODEL_ID}
        raise EngineError("E_SCHEMA_INVALID", f"unknown task {task}")
