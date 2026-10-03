import os

import pytest


def pytest_collection_modifyitems(config, items):
    """Test nhãn `gpu` bị skip (báo skipped) khi SF_GPU=0 (D12 mục 2)."""
    if os.environ.get("SF_GPU") != "0":
        return
    skip = pytest.mark.skip(reason="SF_GPU=0")
    for item in items:
        if item.get_closest_marker("gpu"):
            item.add_marker(skip)
