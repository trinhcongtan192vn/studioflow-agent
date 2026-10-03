"""Điểm vào `python -m sf_worker <lệnh>`; JSON ra stdout, lỗi `{code, message}` ra stderr.

- `selftest`: báo sẵn sàng (001).
- `serve --engine <fake|omnivoice>`: máy chủ JSON-RPC stdio (D4 mục 9.3).
"""

from __future__ import annotations

import json
import sys

from sf_worker.selftest import selftest


def usage() -> int:
    err = {"code": "E_CLI_USAGE", "message": "usage: sf_worker selftest | serve --engine <name>"}
    sys.stderr.write(json.dumps(err) + "\n")
    return 2


def main(argv: list[str]) -> int:
    if argv[:1] == ["selftest"]:
        sys.stdout.write(json.dumps(selftest()) + "\n")
        return 0
    if argv[:1] == ["serve"] and len(argv) == 3 and argv[1] == "--engine":
        from sf_worker.engines import create_engine
        from sf_worker.rpc import Server

        try:
            engine = create_engine(argv[2])
        except ValueError as e:
            sys.stderr.write(json.dumps({"code": "E_CLI_USAGE", "message": str(e)}) + "\n")
            return 2
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")
        Server(engine).serve()
        return 0
    return usage()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
