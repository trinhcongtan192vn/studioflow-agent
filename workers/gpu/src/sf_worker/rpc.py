"""Máy chủ JSON-RPC 2.0 qua stdio, một JSON mỗi dòng; log ra stderr (D4 mục 9.3).

Phương thức: health, load, offload, unload, run, cancel. Thông báo: progress {job_id, done, total}.
`run` chạy trên luồng riêng để vẫn nhận `cancel`.
"""

from __future__ import annotations

import json
import sys
import threading
import traceback
from typing import IO, Any

from sf_worker.audio import EngineError
from sf_worker.engines import Engine


class Server:
    def __init__(
        self, engine: Engine, inp: IO[str] | None = None, out: IO[str] | None = None
    ) -> None:
        self.engine = engine
        self.inp = inp or sys.stdin
        self.out = out or sys.stdout
        self.lock = threading.Lock()
        self.cancelled: set[str] = set()
        self.threads: list[threading.Thread] = []

    def send(self, msg: dict[str, Any]) -> None:
        line = json.dumps({"jsonrpc": "2.0", **msg}, ensure_ascii=False)
        with self.lock:
            self.out.write(line + "\n")
            self.out.flush()

    def error(self, rid: Any, code: str, message: str, rpc_code: int = -32000) -> None:
        self.send(
            {"id": rid, "error": {"code": rpc_code, "message": message, "data": {"code": code}}}
        )

    def handle(self, req: dict[str, Any]) -> None:
        rid = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}
        try:
            if method == "health":
                self.send({"id": rid, "result": self.engine.health()})
            elif method in ("load", "offload", "unload"):
                getattr(self.engine, method)()
                self.send({"id": rid, "result": {}})
            elif method == "cancel":
                self.cancelled.add(params.get("job_id", ""))
                self.send({"id": rid, "result": {}})
            elif method == "run":
                t = threading.Thread(target=self.run_task, args=(rid, params), daemon=True)
                self.threads.append(t)
                t.start()
            else:
                self.error(rid, "E_CLI_USAGE", f"method not found: {method}", -32601)
        except EngineError as e:
            self.error(rid, e.code, str(e))
        except Exception as e:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            self.error(rid, "E_PROVIDER_FAILED", f"{type(e).__name__}: {e}")

    def run_task(self, rid: Any, params: dict[str, Any]) -> None:
        job_id = params.get("job_id", "")

        def progress(done: int, total: int) -> None:
            self.send(
                {"method": "progress", "params": {"job_id": job_id, "done": done, "total": total}}
            )

        try:
            result = self.engine.run(
                params["task"],
                params.get("input") or {},
                params["workdir"],
                progress,
                lambda: job_id in self.cancelled,
            )
            self.send({"id": rid, "result": result})
        except EngineError as e:
            self.error(rid, e.code, str(e))
        except Exception as e:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            self.error(rid, "E_PROVIDER_FAILED", f"{type(e).__name__}: {e}")
        finally:
            self.cancelled.discard(job_id)

    def serve(self) -> None:
        for line in self.inp:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError as e:
                self.error(None, "E_CLI_BAD_JSON", f"invalid JSON: {e}", -32700)
                continue
            self.handle(req)
        for t in self.threads:
            t.join(timeout=1)
