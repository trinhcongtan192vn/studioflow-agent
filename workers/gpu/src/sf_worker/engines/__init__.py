"""Engine của worker (D4 mục 9.3): một tiến trình mỗi engine."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol

Progress = Callable[[int, int], None]


class Engine(Protocol):
    name: str

    def health(self) -> dict[str, Any]: ...
    def load(self) -> None: ...
    def offload(self) -> None: ...
    def unload(self) -> None: ...
    def run(
        self,
        task: str,
        params: dict[str, Any],
        workdir: str,
        progress: Progress,
        cancelled: Callable[[], bool],
    ) -> dict[str, Any]: ...


def create_engine(name: str) -> Engine:
    if name == "fake":
        from sf_worker.engines.fake import FakeEngine

        return FakeEngine()
    if name == "omnivoice":
        from sf_worker.engines.omnivoice import OmniVoiceEngine

        return OmniVoiceEngine()
    raise ValueError(f"unknown engine: {name}")
