"""001 US3 AC3 — selftest in JSON và thoát 0 kể cả không có GPU."""

import json
import os
import subprocess
import sys


def run(*args, env=None):
    return subprocess.run(
        [sys.executable, "-m", "sf_worker", *args],
        capture_output=True,
        text=True,
        env={**os.environ, **(env or {})},
    )


def test_selftest_reports_ready():
    r = run("selftest")
    assert r.returncode == 0
    out = json.loads(r.stdout)
    assert out["status"] == "ready"
    assert isinstance(out["gpu"]["available"], bool)


def test_selftest_without_gpu_tooling():
    # PATH rỗng: không tìm thấy nvidia-smi → vẫn sẵn sàng.
    r = run("selftest", env={"PATH": ""})
    assert r.returncode == 0
    assert json.loads(r.stdout)["gpu"] == {"available": False}


def test_bad_usage_exit_2():
    r = run("bogus")
    assert r.returncode == 2
    assert r.stdout == ""
    assert json.loads(r.stderr)["code"] == "E_CLI_USAGE"
