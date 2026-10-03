"""Client JSON-RPC tối giản cho test worker (chạy tiến trình thật)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

SRC = str(Path(__file__).resolve().parents[1] / "src")


class WorkerProc:
    def __init__(self, engine: str, python: str | None = None) -> None:
        env = {**os.environ, "PYTHONPATH": SRC, "PYTHONIOENCODING": "utf-8"}
        self.p = subprocess.Popen(
            [python or sys.executable, "-m", "sf_worker", "serve", "--engine", engine],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            env=env,
        )
        self.next_id = 0
        self.notes: list[dict] = []

    def send(self, method: str, params: dict | None = None) -> int:
        self.next_id += 1
        msg = {"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params or {}}
        self.p.stdin.write(json.dumps(msg) + "\n")
        self.p.stdin.flush()
        return self.next_id

    def read_until(self, rid: int) -> dict:
        while True:
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError(f"worker exited: {self.p.stderr.read()}")
            msg = json.loads(line)
            if msg.get("id") == rid:
                return msg
            self.notes.append(msg)

    def call(self, method: str, params: dict | None = None) -> dict:
        return self.read_until(self.send(method, params))

    def close(self) -> None:
        if self.p.poll() is None:
            self.p.stdin.close()
            self.p.wait(timeout=10)
