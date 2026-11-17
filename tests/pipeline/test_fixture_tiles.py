"""The committed e2e fixture tileset regenerates byte-identically (T-3.2)."""

import importlib.util
from pathlib import Path

from milano_iso import config

SCRIPT = config.REPO_ROOT / "pipeline" / "scripts" / "make_fixture_tiles.py"
COMMITTED = config.REPO_ROOT / "web" / "e2e" / "fixtures" / "tiles"


def _load():
    spec = importlib.util.spec_from_file_location("make_fixture_tiles", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _files(d: Path) -> dict[str, bytes]:
    return {p.name: p.read_bytes() for p in sorted(d.iterdir())}


def test_fixture_regenerates_byte_identically(tmp_path):
    _load().build(tmp_path)
    fresh, committed = _files(tmp_path), _files(COMMITTED)
    assert sorted(fresh) == sorted(committed)
    assert len(fresh) == 9  # 4 tiles x (glb + json) + tiles.json
    for name in fresh:
        assert fresh[name] == committed[name], name
