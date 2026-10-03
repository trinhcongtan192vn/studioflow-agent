"""Lệnh tự kiểm của worker (001 US3 AC3): báo sẵn sàng, chạy được cả khi không có GPU."""

from __future__ import annotations

import platform
import shutil
import subprocess

from sf_worker import __version__


def detect_gpu(nvidia_smi: str | None = None) -> dict[str, object]:
    """Phát hiện GPU NVIDIA qua `nvidia-smi`; không có/lỗi thì `available: False`."""
    exe = nvidia_smi or shutil.which("nvidia-smi")
    if not exe:
        return {"available": False}
    try:
        out = subprocess.run(
            [exe, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return {"available": False}
    if not out:
        return {"available": False}
    name, _, mem = out.splitlines()[0].partition(",")
    return {"available": True, "name": name.strip(), "vram_mb": int(mem.strip() or 0)}


def selftest() -> dict[str, object]:
    return {
        "status": "ready",
        "worker": "sf-worker",
        "version": __version__,
        "python": platform.python_version(),
        "gpu": detect_gpu(),
    }
