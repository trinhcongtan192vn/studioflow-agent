"""001 FR-013 — mẫu test nhãn gpu."""

import pytest

from sf_worker.selftest import detect_gpu


@pytest.mark.gpu
def test_gpu_detected_on_reference_machine():
    assert detect_gpu()["available"] is True
