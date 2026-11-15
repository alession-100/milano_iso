import hashlib
import json

import pytest
from milano_iso import config, fetch


@pytest.fixture
def env(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    monkeypatch.setattr(config, "RAW_DIR", raw)
    src = tmp_path / "served"
    src.mkdir()
    return src, raw, tmp_path / "manifests"


def _serve(src, name, data: bytes):
    p = src / name
    p.write_bytes(data)
    return p.as_uri()


def test_download_writes_manifest_with_md5(env):
    src, raw, mdir = env
    data = b"hello milano"
    url = _serve(src, "f.bin", data)
    md5_url = _serve(src, "f.bin.md5", f"{hashlib.md5(data).hexdigest()}  f.bin\n".encode())
    m = fetch.fetch("s", url, "f.bin", md5_url=md5_url, manifest_dir=mdir)
    assert (raw / "s" / "f.bin").read_bytes() == data
    assert m["sha256"] == hashlib.sha256(data).hexdigest()
    assert m["bytes"] == len(data) and m["md5_verified"] is True and m["url"] == url
    assert json.loads((mdir / "s.json").read_text()) == m
    assert "retrieved_utc" in m


def test_second_run_skips(env, caplog):
    src, _raw, mdir = env
    url = _serve(src, "f.bin", b"abc")
    first = fetch.fetch("s", url, "f.bin", manifest_dir=mdir)
    (src / "f.bin").unlink()  # a download would now fail
    with caplog.at_level("INFO", logger="milano_iso.fetch"):
        second = fetch.fetch("s", url, "f.bin", manifest_dir=mdir)
    assert second == first
    assert "skip" in caplog.text and "sha256 ok" in caplog.text


def test_existing_file_mismatching_manifest_fails(env):
    src, raw, mdir = env
    url = _serve(src, "f.bin", b"abc")
    fetch.fetch("s", url, "f.bin", manifest_dir=mdir)
    (raw / "s" / "f.bin").write_bytes(b"tampered")
    with pytest.raises(fetch.FetchError, match="sha256 mismatch"):
        fetch.fetch("s", url, "f.bin", manifest_dir=mdir)


def test_upstream_change_detected_on_redownload(env):
    src, raw, mdir = env
    url = _serve(src, "f.bin", b"abc")
    fetch.fetch("s", url, "f.bin", manifest_dir=mdir)
    (raw / "s" / "f.bin").unlink()
    (src / "f.bin").write_bytes(b"changed upstream")
    with pytest.raises(fetch.FetchError, match="sha256 mismatch"):
        fetch.fetch("s", url, "f.bin", manifest_dir=mdir)


def test_md5_mismatch_fails_and_writes_no_manifest(env):
    src, _raw, mdir = env
    url = _serve(src, "f.bin", b"abc")
    md5_url = _serve(src, "f.bin.md5", b"0" * 32 + b"  f.bin\n")
    with pytest.raises(fetch.FetchError, match="md5 mismatch"):
        fetch.fetch("s", url, "f.bin", md5_url=md5_url, manifest_dir=mdir)
    assert not (mdir / "s.json").exists()


def test_user_agent_is_generic():
    assert fetch.USER_AGENT == "milano-iso-pipeline/0.1"
