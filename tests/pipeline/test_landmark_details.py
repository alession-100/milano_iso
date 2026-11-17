"""Landmark detail specs and primitives on synthetic volumes (T-4.2).

Nothing here is real data. The specs of the out-of-pilot landmarks are exercised on synthetic
volumes only; they are placed on real data in Phase 6 (ADR-0028 decision 2).
"""

import importlib.util
import itertools
import json
import math

import numpy as np
import pytest
import shapely
import yaml
from milano_iso import config
from milano_iso import landmark_details as ld
from milano_iso import landmark_style as ls
from shapely.geometry import Point, box

ROOT = config.REPO_ROOT


def vol(key, bb, top, bottom=0.0):
    return ld.Volume(key, box(*bb), bottom, top)


def synthetic_landmark():
    """A podium, a tall tower on it, a slender turret, and a small low annex."""
    return [
        vol("a_podium", (0, 0, 60, 40), 20.0),
        vol("b_tower", (20, 10, 40, 30), 60.0),
        vol("c_turret", (2, 2, 5, 5), 25.0),
        vol("d_annex", (60, 0, 70, 10), 8.0),
        vol("e_small_tall", (50, 30, 53, 33), 45.0),
    ]


def all_cells(details):
    pts = np.concatenate([d.tris.reshape(-1, 3) for d in details])
    return pts


# --- registry -------------------------------------------------------------------------------


def _yaml():
    p = ROOT / "tests" / "landmarks.yaml"
    return {e["id"]: e for e in yaml.safe_load(p.read_text(encoding="utf-8"))["landmarks"]}


def test_registry_covers_phase4_landmarks_and_the_galleria():
    y = _yaml()
    want = {k for k, e in y.items() if e["group"] == "phase4"} | {"galleria_vittorio_emanuele_ii"}
    assert set(ls.SPECS) == want
    for lid, spec in ls.SPECS.items():
        assert spec.in_pilot is y[lid]["in_pilot"], lid
        assert spec.landmark_id == lid


def test_galleria_spec_points_at_the_osm_roof_of_landmarks_yaml():
    e = _yaml()["galleria_vittorio_emanuele_ii"]
    roof = ls.SPECS["galleria_vittorio_emanuele_ii"].roof
    assert (roof.osm_type, roof.osm_id) == ("w", e["osm"]["id"])
    assert e["osm"]["type"] == "way"


def test_every_constant_is_listed_as_style():
    rows = ls.style_constants()
    assert len(rows) > 40
    assert all(status.startswith("style") for _, _, status in rows)
    assert ls.POSITION_TOLERANCE_M <= 2.0


# --- primitives -----------------------------------------------------------------------------


def test_prism_is_a_shaft_with_a_tip_resting_on_z():
    p = ls.Prism("spire", 4, 1.0, 2.0, 3.0)
    t = ld.prism_tris(p, 10.0, 20.0, 50.0)
    pts = t.reshape(-1, 3)
    assert pts[:, 2].min() == 50.0
    assert pts[:, 2].max() == pytest.approx(55.0)
    assert len(t) == 4 * 3  # per side: 2 wall triangles + 1 tip triangle
    ring = pts[np.isclose(pts[:, 2], 50.0)]
    assert np.allclose(np.hypot(ring[:, 0] - 10.0, ring[:, 1] - 20.0), 1.0, atol=1e-5)


def test_prism_triangles_face_outwards():
    t = ld.prism_tris(ls.Prism("p", 6, 1.0, 2.0, 1.0), 0.0, 0.0, 0.0)
    for tri in t:
        n = np.cross(tri[1] - tri[0], tri[2] - tri[0])
        c = tri.mean(axis=0)
        assert n[0] * c[0] + n[1] * c[1] + n[2] * (c[2] - 1.0) > 0  # away from the axis


def test_hip_cap_peaks_at_rise_and_stays_inside_the_polygon():
    poly = box(0, 0, 12, 8)
    t = ld.hip_tris(poly, 30.0, 3.5)
    pts = t.reshape(-1, 3)
    assert pts[:, 2].min() == pytest.approx(30.0)
    assert pts[:, 2].max() == pytest.approx(33.5, abs=0.05)
    assert shapely.contains(poly.buffer(1e-6), shapely.points(pts[:, :2])).all()
    assert (t[:, :, 2].mean(axis=1) >= 30.0).all()
    # upward facing
    nz = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])[:, 2]
    assert (nz > 0).all()


def test_hip_cap_covers_the_polygon_area():
    poly = box(0, 0, 12, 8)
    t = ld.hip_tris(poly, 0.0, 2.0)
    u, w = t[:, 1, :2] - t[:, 0, :2], t[:, 2, :2] - t[:, 0, :2]
    a = 0.5 * (u[:, 0] * w[:, 1] - u[:, 1] * w[:, 0]).sum()
    assert a == pytest.approx(poly.area, rel=1e-6)


def test_vault_rise_follows_the_half_span_of_the_footprint():
    poly = box(0, 0, 60, 14)  # a long arm: A / P is about 5.7 m
    t, rise = ld.vault_tris(poly, 25.0, 0.6)
    assert rise == pytest.approx(0.6 * poly.area / poly.length)
    z = t.reshape(-1, 3)[:, 2]
    assert z.min() == pytest.approx(25.0)
    assert 25.0 + 0.9 * rise < z.max() <= 25.0 + rise + 1e-9


def test_slab_stands_on_the_top():
    t = ld.slab_tris(box(0, 0, 10, 10), 40.0, 2.5, 1.0)
    z = t.reshape(-1, 3)[:, 2]
    assert z.min() == 40.0 and z.max() == 42.5


# --- selection and placement ---------------------------------------------------------------


def test_select_modes():
    v = synthetic_landmark()
    keys = lambda s: [x.key for x in ld.select(s, v)]
    assert keys(ls.Select(tallest_only=True)) == ["b_tower"]
    assert "b_tower" not in keys(ls.Select(skip_tallest=True))
    assert keys(ls.Select(min_top_frac=0.7)) == ["b_tower", "e_small_tall"]  # >= 60 * 0.7 = 42
    assert keys(ls.Select(min_top_frac=0.8)) == ["b_tower"]
    assert keys(ls.Select(max_area_m2=12, min_top_frac=0.3)) == ["c_turret", "e_small_tall"]
    assert keys(ls.Select(min_area_m2=500)) == ["a_podium"]


def test_exposed_part_excludes_higher_volumes():
    v = synthetic_landmark()
    parts = ld.exposed_parts(v[0], v)
    got = shapely.union_all(parts)
    assert got.area == pytest.approx(
        60 * 40 - 20 * 20 - 3 * 3 - 3 * 3
    )  # tower and both small volumes
    assert not got.intersects(Point(30, 20))


def test_rest_height_is_the_highest_covering_volume():
    v = synthetic_landmark()
    assert ld.rest_height(Point(30, 20), v) == 60.0
    assert ld.rest_height(Point(10, 10), v) == 20.0
    assert ld.rest_height(Point(-5, -5), v) is None


def test_edge_row_sits_inside_the_union_with_even_spacing():
    v = [vol("a", (0, 0, 40, 20), 12.0)]
    item = ls.Item(
        ls.Select(), "edge", ls.Prism("pinnacle", 4, 0.5, 1.0, 1.0), spacing_m=6.0, inset_m=0.6
    )
    d = ld.build_item("x", item, v)
    ring = box(0.6, 0.6, 39.4, 19.4).exterior
    assert len(d) == math.ceil(ring.length / 6.0)
    for x in d:
        assert box(0, 0, 40, 20).contains(Point(x.anchor))
        assert ring.distance(Point(x.anchor)) < 1e-6
        assert x.base_m == 12.0 and x.sits_on_m == 12.0
    # evenly spaced along the ring: never further apart than the spacing (corners cut a little)
    gaps = [Point(a.anchor).distance(Point(b.anchor)) for a, b in itertools.pairwise(d)]
    assert 4.0 < min(gaps) and max(gaps) <= 6.0


def test_edge_row_by_count():
    v = [vol("a", (0, 0, 40, 20), 12.0)]
    item = ls.Item(ls.Select(), "edge", ls.Prism("tower", 8, 1.0, 5.0, 1.0), count=8, inset_m=2.0)
    assert len(ld.build_item("x", item, v)) == 8


def test_centre_spire_rests_on_the_highest_covering_volume():
    v = synthetic_landmark()
    item = ls.Item(
        ls.Select(skip_tallest=True, max_area_m2=12), "centre", ls.Prism("s", 4, 0.5, 1, 1)
    )
    d = ld.build_item("x", item, v)
    # c_turret (top 25) stands inside the podium (top 20) and wins: base 25; e_small_tall (45) too
    assert sorted(x.base_m for x in d) == [25.0, 45.0]


# --- every spec on synthetic volumes ---------------------------------------------------------


@pytest.mark.parametrize("lid", sorted(ls.SPECS))
def test_every_spec_builds_on_synthetic_volumes_and_respects_the_placement_rules(lid):
    spec = ls.SPECS[lid]
    vols = synthetic_landmark()
    roof = adj = None
    if spec.roof is not None:
        roof = box(0, 45, 70, 59)
        adj = [vol("adj1", (0, 59, 70, 70), 30.0), vol("adj2", (0, 30, 70, 45), 26.0)]
        vols = []
    details, facts = ld.build_landmark(spec, vols, roof, adj)
    assert details, f"{lid}: no details on the synthetic landmark"
    region = roof if roof is not None else shapely.union_all([v.geom for v in vols])
    zone = region.buffer(ls.POSITION_TOLERANCE_M)
    for d in details:
        pts = d.tris.reshape(-1, 3)
        assert shapely.contains(zone, shapely.points(pts[:, :2])).all(), (lid, d.kind)
        assert d.tris[:, :, 2].min() >= d.base_m - 1e-9
        assert d.base_m == d.sits_on_m
        assert np.isfinite(pts).all()
        if roof is None:
            under = [v.top_m for v in vols if v.geom.buffer(1e-6).contains(Point(d.anchor))]
            if under:
                assert d.base_m >= max(under) - 1e-9
    if spec.roof is not None:
        assert facts["eave_m"] == 26.0
        assert {k for k, _ in facts["adjacent_volumes"]} == {"adj1", "adj2"}


@pytest.mark.parametrize("lid", sorted(ls.SPECS))
def test_building_details_is_deterministic(lid):
    spec = ls.SPECS[lid]
    if spec.roof is not None:
        args = (spec, [], box(0, 45, 70, 59), [vol("adj", (0, 59, 70, 70), 30.0)])
    else:
        args = (spec, synthetic_landmark())
    a, _ = ld.build_landmark(*args)
    b, _ = ld.build_landmark(*reversed_volumes(args))
    assert [x.kind for x in a] == [x.kind for x in b]
    for x, y in zip(a, b, strict=True):
        assert x.tris.tobytes() == y.tris.tobytes()


def reversed_volumes(args):
    """Same input with the volume list in the opposite order (sorting makes the output equal)."""
    if len(args) == 2:
        return (args[0], list(reversed(args[1])))
    return args


# --- the Galleria eave rule ------------------------------------------------------------------


def test_adjacent_volumes_ignore_slivers_and_far_volumes():
    roof = box(0, 0, 100, 14)
    src = ls.RoofSource("w", 1, eave_buffer_m=1.0, eave_min_overlap_m2=10.0)
    near = vol("near", (0, 14, 100, 30), 26.0)
    sliver = vol("sliver", (0, 15, 3, 25), 36.0)  # 3 x 1 m inside the zone: a sliver
    far = vol("far", (0, 20, 100, 40), 40.0)
    got = [v.key for v in ld.adjacent_volumes(roof, [near, sliver, far], src)]
    assert got == ["near"]
    assert ld.eave_height([near]) == 26.0


def test_eave_needs_an_adjacent_volume():
    with pytest.raises(ValueError):
        ld.eave_height([])


def test_vault_without_a_roof_footprint_fails_loudly():
    with pytest.raises(ValueError):
        ld.build_landmark(ls.SPECS["galleria_vittorio_emanuele_ii"], [])


# --- the exporter: buildings are untouched ---------------------------------------------------


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_buildings_layer_is_identical_with_and_without_details(tmp_path):
    fx = _load(ROOT / "pipeline" / "scripts" / "make_fixture_tiles.py", "make_fixture_tiles")
    cmp_mod = _load(ROOT / "tests" / "data" / "compare_buildings.py", "compare_buildings")
    from milano_iso.tiles import export

    with_dir, without_dir = tmp_path / "with", tmp_path / "without"
    with_dir.mkdir()
    without_dir.mkdir()
    fx.build(with_dir)
    fx.build(without_dir, specs={})
    assert cmp_mod.compare(without_dir, with_dir) == []
    man = json.loads((with_dir / "tiles.json").read_text(encoding="utf-8"))
    assert export.DETAIL_LAYER in man["layers"]
    assert man["totals"]["counts"][export.DETAIL_LAYER] > 0
    man0 = json.loads((without_dir / "tiles.json").read_text(encoding="utf-8"))
    assert export.DETAIL_LAYER not in man0["totals"]["counts"]
    # every detail row is flagged
    rows = []
    for p in sorted(with_dir.glob("*_*.json")):
        rows += json.loads(p.read_text(encoding="utf-8"))["layers"].get(export.DETAIL_LAYER, [])
    assert rows and all(r["stylised"] is True for r in rows)
    assert {r["landmark_id"] for r in rows} == {"fixture_landmark"}
