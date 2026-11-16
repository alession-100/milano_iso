"""Landmark positions (T-1.6 check 7, T-1.6a, ADR-0017; VERIFICATION section 3).

(a) pipeline integrity: the processed OSM footprint with the landmark's OSM type and id has its
    centroid within ``tolerance_m`` of the reference position.
(b) rendered landmark (ADR-0020, replaces ADR-0018 point 1): the translation of the OSM footprint
    that best fits the union of the rendered footprints within 60 m (interior rings filled) has
    magnitude <= ``tolerance_m`` (``best_offset_m``, the only asserted value; see
    landmark_offset.py). The overlap ratio and the plateau width are reported. The ADR-0018
    filled-union distance, the primary-only distance, the inside flag and the IoU are reported,
    not asserted. A deferred landmark (own OSM element not rendered, ADR-0018 point 2) must have
    no building carrying its id.
(c) registration (ADR-0017 point 3): over OSM/DBT building pairs with IoU >= 0.8 the magnitude
    of the mean centroid offset is <= 1.0 m, with at least 20 pairs.
All numbers go to landmarks_check.csv and validate_summary.md. Nothing is loosened.
"""

import csv
import math

import numpy as np
import pytest
import shapely
import yaml
from conftest import OUT_DIR
from landmark_offset import best_offset, fill_rings
from milano_iso import config

LANDMARKS = config.REPO_ROOT / "tests" / "landmarks.yaml"
OSM_CODE = {"way": "w", "relation": "r", "node": "n"}
OSM_LAYERS = ["osm_buildings", "osm_building_parts", "landuse", "green", "water", "road_areas"]
FIELDS = [
    "id",
    "tolerance_m",
    "ref_e",
    "ref_n",
    "osm_footprint_layer",
    "dist_a_osm_footprint_m",
    "status_a",
    "rendered_building_keys",
    "primary_building_key",
    "dist_b_to_primary_m",
    "ref_inside_primary",
    "iou_osm_vs_rendered",
    "dist_filled_union_m",
    "best_offset_e",
    "best_offset_n",
    "best_offset_m",
    "best_overlap_ratio",
    "plateau_width_m",
    "status_b",
    "note",
]


def _entries():
    data = yaml.safe_load(LANDMARKS.read_text(encoding="utf-8"))["landmarks"]
    return [e for e in data if e["in_pilot"]]


def _centroid(geom):
    """Centroid computed relative to the origin (coordinates are about 5e6 m)."""
    off = (config.ORIGIN_E, config.ORIGIN_N)
    g = shapely.transform(geom, lambda c: c - off)
    c = g.centroid
    return c.x + off[0], c.y + off[1]


def _dist(c, e):
    return math.hypot(c[0] - e["position"]["e"], c[1] - e["position"]["n"])


def filled_union_distance(geoms, ref):
    """Distance from ``ref`` to the union of ``geoms`` with interior rings removed.

    The union is taken first, so a courtyard enclosed by several buildings is also filled.
    """
    union = shapely.union_all(list(geoms))
    exteriors = [shapely.Polygon(poly.exterior) for poly in shapely.get_parts(union)]
    return float(shapely.union_all(exteriors).distance(ref))


SEARCH_RADIUS_M = 60.0


def _num(x: float) -> str:
    """Fixed-point text; never '-0.000'."""
    text = f"{x:.3f}"
    return "0.000" if text == "-0.000" else text


def _check(e, layers):
    code = OSM_CODE[e["osm"]["type"]]
    oid = int(e["osm"]["id"])
    row = {
        "id": e["id"],
        "tolerance_m": e["tolerance_m"],
        "ref_e": e["position"]["e"],
        "ref_n": e["position"]["n"],
        "osm_footprint_layer": "",
        "dist_a_osm_footprint_m": "",
        "status_a": "",
        "rendered_building_keys": "",
        "primary_building_key": "",
        "dist_b_to_primary_m": "",
        "ref_inside_primary": "",
        "iou_osm_vs_rendered": "",
        "dist_filled_union_m": "",
        "best_offset_e": "",
        "best_offset_n": "",
        "best_offset_m": "",
        "best_overlap_ratio": "",
        "plateau_width_m": "",
        "status_b": "",
        "note": "",
    }
    tol = e["tolerance_m"]
    # (a)
    hit = None
    for name in OSM_LAYERS:
        df = layers.get(name)
        if df is None:
            continue
        sel = df[(df["osm_type"] == code) & (df["osm_id"] == oid)]
        if len(sel):
            hit = (name, sel)
            break
    if hit is None:
        row["status_a"] = "fail_no_osm_footprint"
    else:
        row["osm_footprint_layer"] = hit[0]
        geom = shapely.union_all(hit[1].geometry.to_numpy())
        d = _dist(_centroid(geom), e)
        row["dist_a_osm_footprint_m"] = f"{d:.3f}"
        row["status_a"] = "pass" if d <= tol else "fail"
    # (b)
    b = layers["buildings"]
    own = b[(b["osm_type"] == code) & (b["osm_id"] == oid)]
    if len(own) and not own["rendered"].any():
        # ADR-0016/0018: own OSM element not rendered -> deferred; no building may carry the id.
        reasons = sorted(set(own["render_reason"].dropna()))
        carrying = b[b["landmark_id"] == e["id"]]
        row["primary_building_key"] = ";".join(carrying["building_key"])
        row["status_b"] = "deferred_phase4" if carrying.empty else "fail_deferred_has_building"
        row["note"] = f"ADR-0016: not rendered ({', '.join(reasons)}); modelled in Phase 4"
        return row
    bl = b[(b["landmark_id"] == e["id"]) & b["rendered"]]
    prim = bl[bl["landmark_primary"]] if len(bl) else bl
    if prim.empty:
        row["status_b"] = "fail_no_rendered_building"
        row["note"] = "no rendered building with landmark_primary for this landmark_id"
        return row
    if len(prim) > 1:
        row["status_b"] = "fail_multiple_primary"
        row["primary_building_key"] = ";".join(prim["building_key"])
        return row
    p = prim.iloc[0]
    row["primary_building_key"] = p["building_key"]
    row["rendered_building_keys"] = ";".join(bl["building_key"])
    ref = shapely.Point(e["position"]["e"], e["position"]["n"])
    row["dist_b_to_primary_m"] = f"{float(p.geometry.distance(ref)):.3f}"
    row["ref_inside_primary"] = str(bool(p.geometry.covers(ref)))
    if hit is not None:
        rendered = shapely.union_all(bl.geometry.to_numpy())
        osm_g = shapely.union_all(hit[1].geometry.to_numpy())
        union = shapely.area(shapely.union(osm_g, rendered))
        inter = shapely.area(shapely.intersection(osm_g, rendered))
        row["iou_osm_vs_rendered"] = f"{inter / union:.3f}"
    d = filled_union_distance(bl.geometry.to_numpy(), ref)
    row["dist_filled_union_m"] = f"{d:.3f}"
    if hit is None:
        row["status_b"] = "fail_no_osm_footprint"
        return row
    # ADR-0020: every rendered building within 60 m of the OSM footprint, courtyards filled.
    near = b[b["rendered"] & (b.geometry.distance(osm_g) <= SEARCH_RADIUS_M)]
    fit = best_offset(osm_g, fill_rings(shapely.union_all(near.geometry.to_numpy())))
    row["best_offset_e"] = _num(fit.e)
    row["best_offset_n"] = _num(fit.n)
    row["best_offset_m"] = _num(fit.magnitude_m)
    row["best_overlap_ratio"] = f"{fit.overlap_ratio:.3f}"
    row["plateau_width_m"] = _num(fit.plateau_width_m)
    if fit.overlap_ratio <= 0:
        row["status_b"] = "fail_no_overlap"
    else:
        row["status_b"] = "pass" if fit.magnitude_m <= tol else "fail"
    return row


@pytest.fixture(scope="module")
def rows(layers):
    result = [_check(e, layers) for e in _entries()]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with (OUT_DIR / "landmarks_check.csv").open("w", newline="\n", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        w.writeheader()
        w.writerows(result)
    return {r["id"]: r for r in result}


def test_filled_union_distance_courtyard_synthetic():
    ring = shapely.Polygon(
        [(0, 0), (40, 0), (40, 40), (0, 40)], holes=[[(10, 10), (30, 10), (30, 30), (10, 30)]]
    )
    assert filled_union_distance([ring], shapely.Point(20, 20)) == 0.0  # in the courtyard
    assert ring.distance(shapely.Point(20, 20)) == 10.0  # the unfilled shape would be 10 m away
    d = filled_union_distance([ring], shapely.Point(46, 20))  # 6 m outside the outer wall
    assert d == pytest.approx(6.0) and d > 5.0


def test_landmark_entries_present():
    assert _entries(), "no in_pilot landmarks in tests/landmarks.yaml"


@pytest.mark.parametrize("lid", [e["id"] for e in _entries()])
def test_landmark_a_osm_footprint_position(lid, rows):
    r = rows[lid]
    assert r["status_a"] == "pass", (
        f"{lid}: processed OSM footprint centroid is {r['dist_a_osm_footprint_m'] or 'n/a'} m "
        f"from the reference (tolerance {r['tolerance_m']} m), status {r['status_a']}"
    )


@pytest.mark.parametrize("lid", [e["id"] for e in _entries()])
def test_landmark_b_rendered_position(lid, rows):
    r = rows[lid]
    if r["status_b"] == "deferred_phase4":
        pytest.skip(f"deferred_phase4: {r['note']}")
    assert r["status_b"] == "pass", (
        f"{lid}: best-fit offset of the OSM footprint onto the rendered buildings is "
        f"{r['best_offset_m'] or 'n/a'} m (dE {r['best_offset_e'] or 'n/a'}, dN "
        f"{r['best_offset_n'] or 'n/a'}; tolerance {r['tolerance_m']} m), overlap ratio "
        f"{r['best_overlap_ratio'] or 'n/a'}, status {r['status_b']}. {r['note']}"
    )


REG_IOU = 0.8
REG_MIN_PAIRS = 20
REG_MAX_MAGNITUDE_M = 1.0


def test_landmark_c_osm_dbt_registration(layers, report):
    """ADR-0017 point 3: no CRS or datum shift between the OSM and DBT footprints."""
    osm = layers["osm_buildings"]
    b = layers["buildings"]
    dbt = b[b["source"] == "dbt"].reset_index(drop=True)
    tree = shapely.STRtree(dbt.geometry.to_numpy())
    og = osm.geometry.to_numpy()
    dg = dbt.geometry.to_numpy()
    vecs = []
    for g in og:
        best, best_iou = None, 0.0
        for j in tree.query(g, predicate="intersects"):
            u = shapely.area(shapely.union(g, dg[j]))
            iou = shapely.area(shapely.intersection(g, dg[j])) / u if u > 0 else 0.0
            if iou > best_iou:
                best, best_iou = int(j), float(iou)
        if best is not None and best_iou >= REG_IOU:
            co, cd = _centroid(g), _centroid(dg[best])
            vecs.append((cd[0] - co[0], cd[1] - co[1]))
    n = len(vecs)
    assert n > 0, "no OSM/DBT pairs with IoU >= 0.8"
    v = np.array(vecs)
    mean = v.mean(axis=0)
    mag = float(np.hypot(*mean))
    dist = np.hypot(v[:, 0], v[:, 1])
    report.add(
        "Registration OSM vs DBT (ADR-0017 point 3)",
        f"Pairs: OSM building with its best-IoU DBT building, IoU >= {REG_IOU}. "
        "Offset = DBT centroid minus OSM centroid.\n\n"
        f"- n pairs: {n}\n"
        f"- mean vector (dE, dN): ({mean[0]:+.3f} m, {mean[1]:+.3f} m)\n"
        f"- magnitude of the mean vector: {mag:.3f} m (limit {REG_MAX_MAGNITUDE_M} m)\n"
        f"- median pair distance: {float(np.median(dist)):.3f} m\n"
        f"- p95 pair distance: {float(np.percentile(dist, 95)):.3f} m",
    )
    assert n >= REG_MIN_PAIRS, f"only {n} pairs with IoU >= {REG_IOU}, need {REG_MIN_PAIRS}"
    assert mag <= REG_MAX_MAGNITUDE_M, (
        f"mean OSM/DBT centroid offset is {mag:.3f} m (dE {mean[0]:+.3f}, dN {mean[1]:+.3f}), "
        f"limit {REG_MAX_MAGNITUDE_M} m"
    )
