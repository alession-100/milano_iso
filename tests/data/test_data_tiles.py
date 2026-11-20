"""VERIFICATION section 3 tile checks on the real exported tiles (T-2.3).

Reads $MILANO_ISO_DATA/tiles/pilot (written by `make tiles`) and processed/pilot.gpkg.
Marked ``data`` through tests/data/conftest.py; run with ``pytest -m data -k tiles``.
"""

import gzip
import json
from pathlib import Path

import pyogrio
import pytest
from milano_iso import config
from milano_iso.tiles import grid, manifest, schema_check
from shapely.geometry import box
from shapely.ops import unary_union

TILE_DIR = config.DATA_DIR / "tiles" / "pilot"
GZIP_BUDGET = 256_000


@pytest.fixture(scope="module")
def man() -> dict:
    p = TILE_DIR / manifest.MANIFEST_NAME
    assert p.exists(), f"{p} not found; run `make tiles` first"
    return json.loads(p.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def rendered_keys(gpkg: Path) -> list[str]:
    df = pyogrio.read_dataframe(gpkg, layer="buildings", columns=["building_key", "rendered"])
    return sorted(df.loc[df["rendered"].astype(bool), "building_key"])


def test_tiles_manifest_validates_against_schema(man):
    schema = json.loads(manifest.SCHEMA_PATH.read_text(encoding="utf-8"))
    assert schema_check.validate(man, schema) == []


def test_tiles_manifest_file_is_canonical(man):
    raw = (TILE_DIR / manifest.MANIFEST_NAME).read_bytes()
    assert raw == manifest.manifest_bytes(man)
    assert b"\r" not in raw
    assert [t["id"] for t in man["tiles"]] == sorted(t["id"] for t in man["tiles"])


def test_tiles_manifest_header_matches_config(man):
    assert man["tile_size_m"] == config.TILE_SIZE_M
    assert man["origin"] == {"e": config.ORIGIN_E, "n": config.ORIGIN_N}


def test_tiles_bboxes_tile_the_grid_exactly(man):
    size = config.TILE_SIZE_M
    boxes = []
    for t in man["tiles"]:
        i, j = t["i"], t["j"]
        assert t["id"] == grid.tile_name(i, j)
        assert tuple(t["bbox_epsg32632"]) == grid.tile_bbox(i, j)
        e0, n0, e1, n1 = t["bbox_epsg32632"]
        assert (e1 - e0, n1 - n0) == (size, size)
        assert (e0 - config.ORIGIN_E) % size == 0
        assert (n0 - config.ORIGIN_N) % size == 0
        local = (e0 - config.ORIGIN_E, config.ORIGIN_N - n1, e1 - config.ORIGIN_E)
        assert tuple(t["bbox_local"][:3]) == local
        assert t["bbox_local"][3] == config.ORIGIN_N - n0
        boxes.append(box(e0, n0, e1, n1))
    ids = [(t["i"], t["j"]) for t in man["tiles"]]
    assert len(set(ids)) == len(ids), "duplicate tile index"
    union = unary_union(boxes)
    assert union.area == sum(b.area for b in boxes), "tiles overlap"
    assert union.covers(box(*config.PILOT_AOI_BBOX)), "gap inside the pilot AOI"


def test_tiles_counts_sum_to_totals_and_match_feature_tables(man):
    total: dict[str, int] = {}
    for t in man["tiles"]:
        table = json.loads((TILE_DIR / t["features"]["file"]).read_text(encoding="utf-8"))
        assert {k: len(v) for k, v in table["layers"].items()} == t["counts"]
        for k, v in t["counts"].items():
            total[k] = total.get(k, 0) + v
    assert total == man["totals"]["counts"]
    assert man["totals"]["tiles"] == len(man["tiles"])
    assert man["totals"]["glb_bytes"] == sum(t["glb"]["bytes"] for t in man["tiles"])
    assert man["totals"]["gzip9_bytes"] == sum(t["glb"]["gzip9_bytes"] for t in man["tiles"])
    assert man["totals"]["features_bytes"] == sum(t["features"]["bytes"] for t in man["tiles"])
    assert set(man["totals"]["counts"]) <= set(man["layers"])


def test_tiles_building_count_equals_processed_rendered_count(man, rendered_keys):
    assert man["totals"]["counts"]["buildings"] == len(rendered_keys)


def test_tiles_every_rendered_building_in_exactly_one_tile(man, rendered_keys):
    seen: list[str] = []
    for t in man["tiles"]:
        table = json.loads((TILE_DIR / t["features"]["file"]).read_text(encoding="utf-8"))
        seen += [f["key"] for f in table["layers"].get("buildings", [])]
    assert len(seen) == len(set(seen)), "a building is in two tiles"
    assert sorted(seen) == rendered_keys


def test_tiles_gzip9_within_budget(man):
    for t in man["tiles"]:
        blob = (TILE_DIR / t["glb"]["file"]).read_bytes()
        gz = len(gzip.compress(blob, 9, mtime=0))
        assert gz == t["glb"]["gzip9_bytes"]
        assert gz <= GZIP_BUDGET, f"tile {t['id']}: {gz} bytes gzip-9"


def test_tiles_sha256_and_sizes_match_files(man):
    listed = {manifest.MANIFEST_NAME}
    for key in ("index", "minimap"):  # T-5.3a
        e = man[key]
        p = TILE_DIR / e["file"]
        listed.add(e["file"])
        assert p.stat().st_size == e["bytes"], p.name
        assert manifest.sha256_file(p) == e["sha256"], p.name
    # T-6.2: the coarse levels' tiles are listed in `levels[].tiles` and checked the same way
    coarse = [t for lv in man.get("levels", []) for t in lv.get("tiles", [])]
    for t in [*man["tiles"], *coarse]:
        for key in ("glb", "features"):
            e = t[key]
            p = TILE_DIR / e["file"]
            listed.add(e["file"])
            assert p.stat().st_size == e["bytes"], p.name
            assert manifest.sha256_file(p) == e["sha256"], p.name
    assert {p.name for p in TILE_DIR.iterdir()} == listed, "files not in the manifest"
