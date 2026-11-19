"""Coarse levels on the real pilot (T-6.2): error bound per building, kept keys, files.

Reads processed/pilot.gpkg and $MILANO_ISO_DATA/tiles/pilot (written by `make tiles`). Marked ``data``
through tests/data/conftest.py; run with ``pytest -m data tests/data/test_data_lod.py``.
"""

import json
from pathlib import Path

import pyogrio
import pytest
import shapely
from milano_iso import config
from milano_iso.tiles import export, geom, lod, manifest, schema_check

TILE_DIR = config.DATA_DIR / "tiles" / "pilot"


@pytest.fixture(scope="module")
def man() -> dict:
    return json.loads((TILE_DIR / manifest.MANIFEST_NAME).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def volumes_by_building(gpkg: Path) -> dict[str, list]:
    v = pyogrio.read_dataframe(gpkg, layer="render_volumes")
    v = v[v["rendered"].astype(bool)].sort_values("vol_key")
    out: dict[str, list] = {}
    for r in v.itertuples(index=False):
        for p in geom.polygons_of(export._to_local(r.geometry)):
            out.setdefault(r.building_key, []).append((p, float(r.bottom_m), float(r.top_m)))
    return out


def test_manifest_lists_the_levels_and_validates(man):
    schema = json.loads(manifest.SCHEMA_PATH.read_text(encoding="utf-8"))
    assert schema_check.validate(man, schema) == []
    assert [lv["level"] for lv in man["levels"]] == [0, *[lv.level for lv in lod.LEVELS]]
    for rec, lv in zip(man["levels"][1:], lod.LEVELS, strict=True):
        assert (rec["tolerance_m"], rec["block_m"], rec["unit_m"]) == (
            lv.tolerance_m,
            lv.block_m,
            lv.unit_m,
        )


@pytest.mark.parametrize("level", lod.LEVELS, ids=lambda lv: f"L{lv.level}")
def test_every_building_is_within_the_tolerance_of_its_volumes(level, volumes_by_building):
    """Distance between the footprint of a building's volumes and of its coarse prisms, measured here
    independently of the build's own check. Pieces whose bounding box is not larger than the
    tolerance are left out of the reference (the level drops them, under one pixel)."""
    worst = 0.0
    n = 0
    for key, vols in sorted(volumes_by_building.items()):
        prisms, n_dropped, bound = lod.prisms_of_building(vols, level)
        assert bound <= level.tolerance_m
        if not prisms:
            continue
        coarse = shapely.union_all([p for parts, _, _ in prisms for p in parts])
        ref = shapely.union_all([p for p, _, top in vols if top > 0])
        big = [
            q
            for q in geom.polygons_of(ref)
            if max(q.bounds[2] - q.bounds[0], q.bounds[3] - q.bounds[1]) > level.tolerance_m
        ]
        if not big:
            continue
        # region distance, both ways: nothing of the coarse footprint lies farther than the
        # tolerance from the original footprint, and nothing of the original lies farther from
        # the coarse one (a boundary Hausdorff would count the joins between volumes)
        tol = level.tolerance_m
        over = coarse.difference(ref.buffer(tol, quad_segs=64)).area
        under = shapely.union_all(big).difference(coarse.buffer(tol, quad_segs=64)).area
        worst = max(worst, over, under)
        n += 1
        assert over < 0.05, f"{key}: {over:.3f} m2 of the coarse footprint is over {tol} m away"
        # what lies farther away is only what the level dropped: each dropped piece (bounding box
        # not larger than the tolerance) has an area of at most tolerance squared
        assert under <= n_dropped * tol**2 + 0.05, (
            f"{key}: {under:.3f} m2 of the original is over {tol} m away, {n_dropped} pieces dropped"
        )
    assert n > 100, "the real pilot buildings were checked"


def test_every_rendered_building_is_kept_or_logged_at_every_level(man):
    base = set()
    for t in man["tiles"]:
        rows = json.loads((TILE_DIR / t["features"]["file"]).read_text(encoding="utf-8"))
        base |= {r["key"] for r in rows["layers"].get("buildings", [])}
    log = [
        ln.split(",", 2)
        for ln in (
            config.REPO_ROOT / "reports" / "artifacts" / "T-2.3" / "lod_dropped_buildings.csv"
        )
        .read_text(encoding="utf-8")
        .splitlines()[1:]
    ]
    for rec in man["levels"][1:]:
        kept = set()
        for t in rec["tiles"]:
            rows = json.loads((TILE_DIR / t["features"]["file"]).read_text(encoding="utf-8"))
            kept |= {r["key"] for r in rows["layers"].get("buildings", [])}
        dropped = {k for lv, k, _ in log if int(lv) == rec["level"]}
        assert kept | dropped == base
        assert not kept & dropped
        assert all(r for _, _, r in [x for x in log if int(x[0]) == rec["level"]])
