"""The committed e2e fixture tileset regenerates byte-identically (T-3.2)."""

import importlib.util
import json
from collections import Counter
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


def test_fixture_has_mapped_row_and_fill_trees_and_markings():
    """T-4.1: the fixture carries every kind of tree and marking, produced by the real code."""
    trees: Counter = Counter()
    markings: Counter = Counter()
    for p in sorted(COMMITTED.glob("*_*.json")):
        layers = json.loads(p.read_text(encoding="utf-8"))["layers"]
        for r in layers.get("trees", []):
            trees[r["source"]] += 1
            assert r["decorative"] is (r["source"] == "fill")
            assert (r["osm_id"] is None) is (r["source"] == "fill")
        for r in layers.get("markings", []):
            markings[r["kind"]] += 1
            assert r["stylised"] is True
    assert trees == {"osm_tree": 3, "osm_tree_row": 11, "fill": 76}
    # a marking feature is counted once per tile it falls in (the zebras cross tile borders)
    assert markings == {"centre_line": 8, "zebra": 4}
    manifest = json.loads((COMMITTED / "tiles.json").read_text(encoding="utf-8"))
    assert manifest["instanced_layers"] == ["trees"]
    assert manifest["totals"]["counts"]["trees"] == 90


def test_fixture_has_stylised_landmark_details():
    """T-4.2: the fixture landmark carries a flagged spire and a pinnacle row (real exporter)."""
    kinds: Counter = Counter()
    for p in sorted(COMMITTED.glob("*_*.json")):
        layers = json.loads(p.read_text(encoding="utf-8"))["layers"]
        for r in layers.get("landmark_details", []):
            kinds[r["detail"]] += 1
            assert r["stylised"] is True
            assert r["landmark_id"] == "fixture_landmark"
    assert kinds["spire"] == 1
    assert kinds["pinnacle"] > 4
    manifest = json.loads((COMMITTED / "tiles.json").read_text(encoding="utf-8"))
    assert "landmark_details" in manifest["layers"]
    assert manifest["totals"]["counts"]["landmark_details"] == sum(kinds.values())
