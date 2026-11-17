"""Search index and minimap on the real exported pilot tiles (T-5.3a).

Reads $MILANO_ISO_DATA/tiles/pilot (written by `make tiles`). Marked ``data`` through
tests/data/conftest.py; run with ``pytest -m data -k index``.
"""

import collections
import gzip
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
import yaml
from milano_iso import config

TILE_DIR = config.DATA_DIR / "tiles" / "pilot"
LANDMARKS = config.REPO_ROOT / "tests" / "landmarks.yaml"
KINDS = ["building", "street", "green", "water", "landmark"]
MINIMAP_GZIP_BUDGET = 100_000


@pytest.fixture(scope="module")
def tiles_json() -> dict:
    p = TILE_DIR / "tiles.json"
    assert p.exists(), f"{p} not found; run `make tiles` first"
    return json.loads(p.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def entries(tiles_json) -> list[dict]:
    p = TILE_DIR / tiles_json["index"]["file"]
    return json.loads(p.read_text(encoding="utf-8"))["entries"]


@pytest.fixture(scope="module")
def landmarks() -> list[dict]:
    return yaml.safe_load(LANDMARKS.read_text(encoding="utf-8"))["landmarks"]


def test_index_entry_counts_by_kind(entries, report):
    counts = collections.Counter(e["kind"] for e in entries)
    assert set(counts) <= set(KINDS)
    assert counts["building"] > 0 and counts["street"] > 0 and counts["green"] > 0
    report.add(
        "Search index entries by kind (T-5.3a)",
        ", ".join(f"{k}: {counts.get(k, 0)}" for k in KINDS) + f"; total {len(entries)}",
    )


def test_index_entries_are_well_formed_sorted_and_named(entries, tiles_json):
    tile_ids = {t["id"] for t in tiles_json["tiles"]}
    keys = []
    for e in entries:
        assert e["kind"] in KINDS
        assert isinstance(e["name"], str) and e["name"].strip() != ""
        assert len(e["bbox"]) == 4 and e["bbox"][0] <= e["bbox"][2] and e["bbox"][1] <= e["bbox"][3]
        assert len(e["centre"]) == 2
        for v in [*e["bbox"], *e["centre"]]:
            assert abs(v * 10 - round(v * 10)) < 1e-6, e
        assert e["tiles"] and set(e["tiles"]) <= tile_ids
        keys.append((KINDS.index(e["kind"]), e["name"], json.dumps(e["ref"], sort_keys=True)))
    assert keys == sorted(keys)


def test_index_has_no_decorative_or_unnamed_features(entries):
    """Fill trees, markings and landmark details carry no name and never appear as entries."""
    assert all(e["kind"] != "tree" and "detail" not in e["ref"] for e in entries)
    streets = [e["name"] for e in entries if e["kind"] == "street"]
    assert len(streets) == len(set(streets)), "one street entry per name"


def test_every_in_pilot_landmark_has_an_entry_named_from_the_yaml(entries, landmarks):
    by_id = {e["ref"]["landmark_id"]: e for e in entries if e["kind"] == "landmark"}
    in_pilot = [lm for lm in landmarks if lm["in_pilot"]]
    assert in_pilot
    missing = [lm["id"] for lm in in_pilot if lm["id"] not in by_id]
    assert not missing, f"in-pilot landmarks without an index entry: {missing}"
    for lm in in_pilot:
        assert by_id[lm["id"]]["name"] == lm["name"]
    # out-of-pilot landmarks have no rendered building: they must not be listed
    assert set(by_id) <= {lm["id"] for lm in in_pilot}


def test_duomo_entry_is_within_5_m_of_its_reference_position(entries, landmarks):
    duomo = next(lm for lm in landmarks if lm["id"] == "duomo")
    x = duomo["position"]["e"] - config.ORIGIN_E
    z = -(duomo["position"]["n"] - config.ORIGIN_N)
    entry = next(
        e for e in entries if e["kind"] == "landmark" and e["ref"]["landmark_id"] == "duomo"
    )
    d = math.hypot(entry["centre"][0] - x, entry["centre"][1] - z)
    assert d <= 5.0, f"Duomo centre {entry['centre']} is {d:.2f} m from ({x:.2f}, {z:.2f})"


def test_landmark_name_wins_over_the_transferred_building_name(entries):
    """G1 carry-over: the Generali palace carries OSM name 'Palazzo Carminati' on its building."""
    names = {e["name"] for e in entries if e["kind"] == "landmark"}
    assert "Palazzo delle Assicurazioni Generali (Piazza Cordusio)" in names
    assert "Palazzo Carminati" not in {e["name"] for e in entries if e["kind"] == "building"}


def test_minimap_is_a_well_formed_svg_covering_the_tile_extent(tiles_json, report):
    p = TILE_DIR / tiles_json["minimap"]["file"]
    blob = p.read_bytes()
    gz = len(gzip.compress(blob, 9, mtime=0))
    assert gz <= MINIMAP_GZIP_BUDGET, f"minimap {gz} bytes gzip-9"
    root = ET.fromstring(blob)
    x, z, w, h = (float(v) for v in root.get("viewBox").split())
    for t in tiles_json["tiles"]:
        lo, hi = t["content_bbox_local"]["min"], t["content_bbox_local"]["max"]
        assert x <= lo[0] and x + w >= hi[0], t["id"]
        assert z <= lo[2] and z + h >= hi[2], t["id"]
    classes = {el.get("class") for el in root.iter("{http://www.w3.org/2000/svg}path")}
    assert {"mm-building", "mm-road-major", "mm-water", "mm-green"} <= classes
    assert all(el.get("fill") is None for el in root.iter())  # colours only from CSS classes
    report.add(
        "Minimap (T-5.3a)",
        f"viewBox {root.get('viewBox')}; {len(blob)} bytes, {gz} bytes gzip-9; "
        f"index.json {(TILE_DIR / tiles_json['index']['file']).stat().st_size} bytes",
    )


def test_tile_files_listed_in_manifest_match_their_hashes(tiles_json):
    for key in ("index", "minimap"):
        e = tiles_json[key]
        blob = Path(TILE_DIR / e["file"]).read_bytes()
        assert len(blob) == e["bytes"]
        assert len(gzip.compress(blob, 9, mtime=0)) == e["gzip9_bytes"]
