"""006 US4 — giao thức worker JSON-RPC 2.0 qua stdio (D4 mục 9.3), engine fake."""

import json
import threading
import time
import wave
from pathlib import Path

import pytest

from tests.worker_helpers import WorkerProc


@pytest.fixture
def worker():
    w = WorkerProc("fake")
    yield w
    w.close()


def test_health_load_offload_unload(worker):
    assert worker.call("health")["result"] == {"ok": True, "engine": "fake", "loaded": False}
    assert worker.call("load")["result"] == {}
    assert worker.call("health")["result"]["loaded"] is True
    assert worker.call("offload")["result"] == {}
    assert worker.call("unload")["result"] == {}


def test_run_tts_reports_progress_and_writes_48k_mono(worker, tmp_path):
    r = worker.call(
        "run",
        {
            "job_id": "jb_1",
            "task": "tts.synthesize",
            "input": {"text": "Xin chào"},
            "workdir": str(tmp_path),
        },
    )
    assert r["result"] == {"file": "out.wav", "duration_ms": 480, "sample_rate": 48000}
    assert {
        "jsonrpc": "2.0",
        "method": "progress",
        "params": {"job_id": "jb_1", "done": 1, "total": 1},
    } in worker.notes
    with wave.open(str(tmp_path / "out.wav")) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (48000, 1, 2)


def test_errors_carry_codes(worker, tmp_path):
    r = worker.call(
        "run",
        {"job_id": "x", "task": "tts.synthesize", "input": {"text": " "}, "workdir": str(tmp_path)},
    )
    assert r["error"]["data"]["code"] == "E_SCHEMA_INVALID"
    assert worker.call("nope")["error"]["code"] == -32601
    worker.p.stdin.write("{not json\n")
    worker.p.stdin.flush()
    msg = json.loads(worker.p.stdout.readline())
    assert msg["error"]["code"] == -32700


def test_cancel_stops_a_running_task(worker, tmp_path):
    rid = worker.send(
        "run", {"job_id": "jb_c", "task": "sleep", "input": {"ms": 5000}, "workdir": str(tmp_path)}
    )
    time.sleep(0.2)
    t0 = time.monotonic()
    worker.call("cancel", {"job_id": "jb_c"})
    r = worker.read_until(rid)
    assert r["error"]["data"]["code"] == "E_JOB_CANCELED"
    assert time.monotonic() - t0 < 2


def test_voice_profile_checks_ref_duration(worker, tmp_path):
    from sf_worker.audio import sine, write_pcm16

    short = tmp_path / "short.wav"
    write_pcm16(short, sine(1000))
    r = worker.call(
        "run",
        {
            "job_id": "v",
            "task": "voice.profile",
            "input": {"ref_audio": str(short)},
            "workdir": str(tmp_path),
        },
    )
    assert r["error"]["data"]["code"] == "E_AUDIO_UNSUPPORTED"
    ok = tmp_path / "ok.wav"
    write_pcm16(ok, sine(5000))
    out = tmp_path / "out"
    out.mkdir()
    r = worker.call(
        "run",
        {
            "job_id": "v2",
            "task": "voice.profile",
            "input": {"ref_audio": str(ok)},
            "workdir": str(out),
        },
    )
    assert r["result"]["voice"] == "voice.pt"
    assert Path(out, "voice.pt").exists() and Path(out, "ref.wav").exists()


def test_stdin_eof_ends_the_process(tmp_path):
    w = WorkerProc("fake")
    w.p.stdin.close()
    assert w.p.wait(timeout=10) == 0


def test_requests_are_served_while_a_task_runs(worker, tmp_path):
    rid = worker.send(
        "run", {"job_id": "long", "task": "sleep", "input": {"ms": 500}, "workdir": str(tmp_path)}
    )
    assert worker.call("health")["result"]["ok"] is True
    assert worker.read_until(rid)["result"] == {"slept": True}
    assert threading.active_count() >= 1


def test_library_prints_do_not_corrupt_the_protocol(tmp_path):
    # engine fake: task "print" ghi ra stdout của Python; luồng JSON-RPC vẫn sạch
    w = WorkerProc("fake")
    try:
        r = w.call("run", {"job_id": "p", "task": "print", "input": {}, "workdir": str(tmp_path)})
        assert r["result"] == {"printed": True}
    finally:
        w.close()
