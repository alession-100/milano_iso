"""The committed e2e fixture tileset regenerates byte-identically (T-3.2)."""

import importlib.util
import json
from collections import Counter
from pathlib import Path

from milano_iso import config
from milano_iso.tiles import manifest as _manifest

SCRIPT = config.REPO_ROOT / "pipeline" / "scripts" / "make_fixture_tiles.py"
COMMITTED = config.REPO_ROOT / "web" / "e2e" / "fixtures" / "tiles"


def _load():
    spec = importlib.util.spec_from_file_location("make_fixture_tiles", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _files(d: Path) -> dict[str, bytes]:
    return {
        p.relative_to(d).as_posix(): p.read_bytes() for p in sorted(d.rglob("*")) if p.is_file()
    }


def test_fixture_regenerates_byte_identically(tmp_path):
    _load().build(tmp_path)
    fresh, committed = _files(tmp_path), _files(COMMITTED)
    assert sorted(fresh) == sorted(committed)
    # 4 tiles x (glb + json) + tiles.json + index + minimap + 4 shards (one per tile, T-6.3)
    assert len(fresh) == 15
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
    manifest = _manifest.load_full(COMMITTED)
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
    manifest = _manifest.load_full(COMMITTED)
    assert "landmark_details" in manifest["layers"]
    assert manifest["totals"]["counts"]["landmark_details"] == sum(kinds.values())


def test_fixture_has_names_in_index_and_a_minimap():
    """T-5.3a: a 2-way street, a named park, the landmark, named buildings; water is unnamed."""
    manifest = _manifest.load_full(COMMITTED)
    for key, file in (("index", "index.json"), ("minimap", "minimap.svg")):
        assert manifest[key]["file"] == file
        assert manifest[key]["bytes"] == (COMMITTED / file).stat().st_size
    idx = json.loads((COMMITTED / "index.json").read_text(encoding="utf-8"))
    by_kind: dict[str, list] = {}
    for e in idx["entries"]:
        by_kind.setdefault(e["kind"], []).append(e)
    assert [e["name"] for e in by_kind["street"]] == ["Via Fixture"]
    assert by_kind["street"][0]["ref"] == {"osm_ids": {"w": [3001, 3003]}}
    assert [e["name"] for e in by_kind["green"]] == ["Parco Fixture"]
    assert [e["name"] for e in by_kind["landmark"]] == ["Fixture Landmark"]
    assert "water" not in by_kind
    # the landmark building is not also listed under its building name
    assert len(by_kind["building"]) == 5
    assert "Fixture B6" not in [e["name"] for e in idx["entries"]]
