"""Coarse levels of detail (T-6.2, ADR-0037): error bound, counts, determinism, kept feature keys."""

import copy
import dataclasses
import importlib.util
import json
import math

import numpy as np
import pytest
import shapely
from milano_iso import config
from milano_iso.tiles import export, glb, grid, lod, manifest, schema_check
from shapely.geometry import Polygon, box

SCRIPT = config.REPO_ROOT / "pipeline" / "scripts" / "make_fixture_tiles.py"
SCHEMA = json.loads(manifest.SCHEMA_PATH.read_text(encoding="utf-8"))


def _fixture_module():
    spec = importlib.util.spec_from_file_location("make_fixture_tiles", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def lod_tiles(tmp_path_factory):
    out = tmp_path_factory.mktemp("lod_fixture")
    _fixture_module().build(out, levels=None)
    return out


@pytest.fixture(scope="module")
def man(lod_tiles):
    return json.loads((lod_tiles / manifest.MANIFEST_NAME).read_text(encoding="utf-8"))


def _blob(rng, n=60, radius=40.0, hole=True) -> Polygon:
    """An irregular footprint with many vertices (and a courtyard), seeded."""
    ang = np.sort(rng.uniform(0, 2 * math.pi, n))
    r = radius * (1 + 0.04 * rng.standard_normal(n))
    ext = [(float(a), float(b)) for a, b in zip(r * np.cos(ang), r * np.sin(ang), strict=True)]
    holes = [list(box(-8, -8, 8, 8).exterior.coords)] if hole else []
    return Polygon(ext, holes).buffer(0)


# --- the level table ---------------------------------------------------------------------------


def test_levels_are_ordered_nested_and_fit_the_quantisation_range():
    prev = None
    for lv in lod.LEVELS:
        assert lv.tolerance_m > (prev.tolerance_m if prev else lod.BASE_TOLERANCE_M)
        assert lv.block_m % (prev.block_m if prev else config.TILE_SIZE_M) == 0, "cells nest"
        assert lv.block_m > (prev.block_m if prev else config.TILE_SIZE_M)
        assert lv.level == (prev.level + 1 if prev else 1)
        # the half block plus 100 m of overhang must fit the int16 range of the level's unit
        assert lv.block_m / 2 + 100 < glb.INT16_MAX * lv.unit_m
        assert lv.unit_m < lv.tolerance_m / 10, "snapping slack is small against the tolerance"
        prev = lv


# --- error bound -------------------------------------------------------------------------------


@pytest.mark.parametrize("level", lod.LEVELS, ids=lambda lv: f"L{lv.level}")
def test_every_kept_polygon_is_within_the_recorded_tolerance(level):
    """Hausdorff per building (planimetric): union of the volumes vs union of the coarse parts."""
    rng = np.random.default_rng(7)
    worst = 0.0
    for k in range(25):
        a = _blob(rng, radius=40 + 3 * k)
        b = a.buffer(-6).buffer(0)
        vols = [(a, 0.0, 12.0)] + ([(b, 0.0, 12.0 + 7 * (k % 3))] if not b.is_empty else [])
        prisms, _, bound = lod.prisms_of_building(vols, level)
        assert prisms
        assert bound <= level.tolerance_m
        coarse = shapely.union_all([p for parts, _, _ in prisms for p in parts])
        orig = shapely.union_all([v[0] for v in vols])
        h = shapely.hausdorff_distance(orig.boundary, coarse.boundary, densify=0.02)
        worst = max(worst, h)
        assert h <= level.tolerance_m, f"building {k}: {h:.3f} m > {level.tolerance_m} m"
    assert worst > 0, "the polygons really were simplified"


def test_heights_move_by_at_most_half_a_step():
    level = lod.LEVELS[0]
    poly = box(0, 0, 30, 30)
    for top in (3.2, 9.9, 10.4, 17.01):
        prisms, _, _ = lod.prisms_of_building([(poly, 0.0, top)], level)
        ((_, bottom, qtop),) = prisms
        assert bottom == 0.0
        assert abs(qtop - top) <= level.height_step_m / 2 + 1e-9


def test_volumes_in_the_same_step_merge_and_other_heights_stay_apart():
    level = dataclasses.replace(lod.LEVELS[0], height_step_m=2.0)
    a, b, c = box(0, 0, 20, 20), box(20, 0, 40, 20), box(40, 0, 60, 20)
    prisms, dropped, _ = lod.prisms_of_building(
        [(a, 0.0, 10.2), (b, 0.0, 10.9), (c, 0.0, 16.0)], level
    )
    assert dropped == 0
    assert [(bt, tp) for _, bt, tp in prisms] == [(0.0, 10.0), (0.0, 16.0)]
    merged = prisms[0][0]
    assert len(merged) == 1 and merged[0].area == pytest.approx(800.0)


def test_below_ground_and_sub_pixel_volumes_are_not_drawn_and_counted():
    level = lod.LEVELS[0]
    big = box(0, 0, 30, 30)
    tiny = box(100, 100, 100.5, 100.5)
    prisms, dropped, _ = lod.prisms_of_building(
        [(big, 0.0, 8.0), (box(0, 0, 10, 10), -6.0, -2.0), (tiny, 0.0, 15.0)], level
    )
    assert [(bt, tp) for _, bt, tp in prisms] == [(0.0, 8.0)]
    assert dropped == 2


# --- determinism -------------------------------------------------------------------------------


def test_canonical_polygon_does_not_depend_on_ring_start_or_orientation():
    unit = 0.02
    rng = np.random.default_rng(3)
    base = lod.snap(_blob(rng), unit)
    ref = lod.canonical(base, unit)
    ext = list(base.exterior.coords)[:-1]
    for shift in (0, 5, 17):
        for flip in (False, True):
            ring = ext[shift:] + ext[:shift]
            ring = ring[::-1] if flip else ring
            twin = Polygon(ring, [list(r.coords) for r in base.interiors])
            assert lod.canonical(twin, unit).wkb == ref.wkb


def test_coarse_geometry_sits_on_the_level_grid():
    for level in lod.LEVELS:
        rng = np.random.default_rng(11)
        prisms, _, _ = lod.prisms_of_building([(_blob(rng), 0.0, 10.0)], level)
        for parts, _, _ in prisms:
            for p in parts:
                xy = np.asarray(p.exterior.coords) / level.unit_m
                assert np.allclose(xy, np.rint(xy), atol=1e-6)


def test_fixture_with_levels_regenerates_byte_identically(lod_tiles, tmp_path):
    _fixture_module().build(tmp_path, levels=None)
    a = {p.name: p.read_bytes() for p in sorted(lod_tiles.iterdir())}
    b = {p.name: p.read_bytes() for p in sorted(tmp_path.iterdir())}
    assert a == b


def test_committed_lod_fixture_is_current(lod_tiles):
    committed = config.REPO_ROOT / "web" / "e2e" / "fixtures" / "tiles-lod"
    a = {p.name: p.read_bytes() for p in sorted(lod_tiles.iterdir())}
    b = {p.name: p.read_bytes() for p in sorted(committed.iterdir())}
    assert a == b


# --- the fixture tileset with levels -----------------------------------------------------------


def test_manifest_lists_every_level_and_validates(man):
    assert schema_check.validate(man, SCHEMA) == []
    levels = man["levels"]
    assert [lv["level"] for lv in levels] == [0, *[lv.level for lv in lod.LEVELS]]
    assert levels[0] == lod.base_level()
    for rec, lv in zip(levels[1:], lod.LEVELS, strict=True):
        assert rec["tolerance_m"] == lv.tolerance_m
        assert rec["block_m"] == lv.block_m
        assert rec["unit_m"] == lv.unit_m
        assert rec["totals"]["tiles"] == len(rec["tiles"])
        assert all(t["id"].startswith(f"L{lv.level}_") for t in rec["tiles"])
        assert [t["id"] for t in rec["tiles"]] == sorted(t["id"] for t in rec["tiles"])


def test_base_tiles_and_files_of_the_base_level_are_unchanged(man, lod_tiles, tmp_path):
    _fixture_module().build(tmp_path, levels=())
    plain = json.loads((tmp_path / manifest.MANIFEST_NAME).read_text(encoding="utf-8"))
    assert man["tiles"] == plain["tiles"]
    assert "levels" not in plain
    for t in man["tiles"]:
        for key in ("glb", "features"):
            f = t[key]["file"]
            assert (lod_tiles / f).read_bytes() == (tmp_path / f).read_bytes()


def test_coarse_tiles_cells_nest_in_each_other(man):
    for rec in man["levels"][1:]:
        s = rec["block_m"]
        for t in rec["tiles"]:
            x0, z0, x1, z1 = t["bbox_local"]
            assert (x1 - x0, z1 - z0) == (s, s)
            assert x0 % s == 0 and z0 % s == 0
            assert t["bbox_epsg32632"][0] == config.ORIGIN_E + x0


def test_every_base_building_key_is_in_a_coarse_tile_or_logged_as_dropped(lod_tiles, man, tmp_path):
    base_keys = set()
    for t in man["tiles"]:
        rows = json.loads((lod_tiles / t["features"]["file"]).read_text(encoding="utf-8"))
        base_keys |= {r["key"] for r in rows["layers"].get("buildings", [])}
    assert base_keys
    for rec in man["levels"][1:]:
        kept = set()
        for t in rec["tiles"]:
            rows = json.loads((lod_tiles / t["features"]["file"]).read_text(encoding="utf-8"))
            kept |= {r["key"] for r in rows["layers"].get("buildings", [])}
        assert kept <= base_keys, "a coarse tile never invents a building"
        assert len(kept) == rec["totals"]["counts"].get("buildings", 0)
        # the drop log lists exactly the rest
    drop_lines = _drop_log(tmp_path)
    for rec in man["levels"][1:]:
        kept = set()
        for t in rec["tiles"]:
            rows = json.loads((lod_tiles / t["features"]["file"]).read_text(encoding="utf-8"))
            kept |= {r["key"] for r in rows["layers"].get("buildings", [])}
        logged = {k for lv, k, _ in drop_lines if lv == rec["level"]}
        assert kept | logged == base_keys
        assert not (kept & logged)


def _drop_log(tmp_path):
    """Rebuild the fixture with its summary directory kept, return the drop log rows."""
    import tempfile

    mod = _fixture_module()
    saved = config.PROCESSED_DIR
    with tempfile.TemporaryDirectory(prefix="milano_lodtest_") as tmp:
        from pathlib import Path

        tmp_path2 = Path(tmp)
        proc = tmp_path2 / "processed"
        proc.mkdir()
        mod.write_gpkg(proc / export.GPKG_NAME)
        config.PROCESSED_DIR = proc
        try:
            export.build(
                "pilot",
                out_dir=tmp_path2 / "t",
                summary_dir=tmp_path2 / "s",
                specs={},
                landmark_names=mod.FIXTURE_LANDMARK_NAMES,
            )
        finally:
            config.PROCESSED_DIR = saved
        text = (tmp_path2 / "s" / "lod_dropped_buildings.csv").read_text(encoding="utf-8")
    rows = []
    for line in text.splitlines()[1:]:
        lv, key, reason = line.split(",", 2)
        rows.append((int(lv), key, reason))
    return rows


def test_a_small_unnamed_building_is_dropped_and_logged_but_landmarks_and_tall_stay():
    level = dataclasses.replace(lod.LEVELS[1], building_min_area_m2=100.0, keep_height_m=40.0)

    class Row:
        def __init__(self, name=None, landmark_id=None, height_m=10.0):
            self.name, self.landmark_id, self.height_m = name, landmark_id, height_m

    assert lod.keep_building(level, Row(), 99.0) == (False, "footprint 99.0 m2 < 100 m2")
    assert lod.keep_building(level, Row(), 100.0) == (True, "area")
    assert lod.keep_building(level, Row(landmark_id="duomo"), 1.0) == (True, "landmark")
    assert lod.keep_building(level, Row(name="Torre"), 1.0) == (True, "named")
    assert lod.keep_building(level, Row(height_m=60.0), 1.0) == (True, "tall")
    assert lod.keep_building(level, Row(landmark_id=float("nan")), 1.0)[0] is False


def test_coarse_tile_rows_equal_the_base_rows_for_the_same_building(lod_tiles, man):
    """The card shows the same data at any zoom: a building's row is identical at every level."""
    base = {}
    for t in man["tiles"]:
        rows = json.loads((lod_tiles / t["features"]["file"]).read_text(encoding="utf-8"))
        for r in rows["layers"].get("buildings", []):
            base[r["key"]] = r
    seen = 0
    for rec in man["levels"][1:]:
        for t in rec["tiles"]:
            rows = json.loads((lod_tiles / t["features"]["file"]).read_text(encoding="utf-8"))
            for r in rows["layers"].get("buildings", []):
                assert r == base[r["key"]]
                seen += 1
    assert seen > 0


def test_coarse_glb_decodes_inside_its_cell_and_the_content_bbox_is_right(lod_tiles, man):
    import struct

    for rec in man["levels"][1:]:
        s = rec["block_m"]
        for t in rec["tiles"]:
            blob = (lod_tiles / t["glb"]["file"]).read_bytes()
            assert blob[:4] == b"glTF"
            (jlen,) = struct.unpack_from("<I", blob, 12)
            doc = json.loads(blob[20 : 20 + jlen])
            for node in doc["nodes"]:
                assert node["scale"] == [rec["unit_m"]] * 3
                assert node["translation"][0] == pytest.approx(t["bbox_local"][0] + s / 2)
            lo, hi = t["content_bbox_local"]["min"], t["content_bbox_local"]["max"]
            assert lo[0] >= t["bbox_local"][0] - 200 and hi[0] <= t["bbox_local"][2] + 200


def test_manifest_bytes_are_canonical_and_deterministic(man):
    assert manifest.manifest_bytes(man) == manifest.manifest_bytes(copy.deepcopy(man))


def test_grid_helpers_with_a_block_size():
    assert grid.tile_ij(config.ORIGIN_E + 1499, config.ORIGIN_N - 1, size=1000) == (1, -1)
    assert grid.tile_bbox_local(-1, 2, 1000) == (-1000.0, 2000.0, 0.0, 3000.0)
    assert grid.tile_bbox(1, 0, size=500)[0] == config.ORIGIN_E + 500
    # default size is the base tile (unchanged behaviour)
    assert grid.tile_bbox_local(1, 1) == (250.0, 250.0, 500.0, 500.0)


def test_quantise_with_a_coarser_unit_round_trips_within_half_a_unit():
    pts = np.array([[1500.0, 3.0, -1300.0], [-1999.9, 80.0, 1999.9]])
    centre = (0.0, 0.0)
    for unit in (0.02, 0.04):
        if np.abs(pts).max() / unit > glb.INT16_MAX:
            with pytest.raises(ValueError):
                glb.quantise(pts, centre, unit)
            continue
        q = glb.quantise(pts, centre, unit)
        assert np.abs(glb.dequantise(q, centre, unit) - pts).max() <= unit / 2 + 1e-9
    with pytest.raises(ValueError):
        glb.quantise(np.array([[700.0, 0.0, 0.0]]), centre)  # outside the 2 cm range
