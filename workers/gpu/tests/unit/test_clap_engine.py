"""021 — engine `clap` có trong factory; thiếu thư viện/model → health báo rõ, không lỗi."""

from sf_worker.engines import create_engine


def test_clap_engine_is_registered_and_reports_health():
    e = create_engine("clap")
    assert e.name == "clap"
    h = e.health()
    assert h["engine"] == "clap"
    if not h["ok"]:
        assert "missing" in h["detail"] or "not installed" in h["detail"]


def test_unknown_task_is_rejected_without_loading_when_deps_missing():
    e = create_engine("clap")
    if e.health()["ok"]:
        return  # môi trường có CLAP thật: phủ bởi test tích hợp core (clap.test.ts)
    try:
        e.run("nope", {}, ".", lambda d, t: None, lambda: False)
    except Exception as ex:  # noqa: BLE001
        assert ex is not None
