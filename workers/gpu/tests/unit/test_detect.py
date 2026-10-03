"""001 US3 AC3 — phát hiện GPU chịu lỗi."""

from sf_worker.selftest import detect_gpu


def test_missing_binary_is_unavailable():
    assert detect_gpu("Z:/does/not/exist/nvidia-smi.exe") == {"available": False}
