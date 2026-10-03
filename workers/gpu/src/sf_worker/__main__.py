"""Điểm vào `python -m sf_worker <lệnh>`; JSON ra stdout, lỗi `{code, message}` ra stderr."""

from __future__ import annotations

import json
import sys

from sf_worker.selftest import selftest


def main(argv: list[str]) -> int:
    if argv[:1] != ["selftest"]:
        err = {"code": "E_CLI_USAGE", "message": "usage: sf_worker selftest"}
        sys.stderr.write(json.dumps(err) + "\n")
        return 2
    sys.stdout.write(json.dumps(selftest()) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
