"""Landmark positions (T-1.6 check 7, VERIFICATION section 3 positional accuracy).

(a) pipeline integrity: the processed OSM footprint with the landmark's OSM type and id.
(b) rendered position: the rendered building carrying the landmark id (union of its rendered
    volumes' footprints, or its OSM footprint when it is OSM-only).
Both distances go to landmarks_check.csv. A failure in (b) is a finding; it is not loosened.
"""

import csv
import math

import pytest
import shapely
import yaml
from conftest import OUT_DIR
from milano_iso import config

LANDMARKS = config.REPO_ROOT / "tests" / "landmarks.yaml"
OSM_CODE = {"way": "w", "relation": "r", "node": "n"}
GALLERIA = "galleria_vittorio_emanuele_ii"
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
    "dist_b_rendered_m",
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
        "dist_b_rendered_m": "",
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
    bl = b[b["landmark_id"] == e["id"]]
    if bl.empty:
        row["status_b"] = "fail_no_rendered_building"
        row["note"] = "no buildings row with this landmark_id"
    elif not bl["rendered"].any():
        reasons = sorted(set(bl["render_reason"].dropna()))
        row["rendered_building_keys"] = ";".join(bl["building_key"])
        if e["id"] == GALLERIA:
            row["status_b"] = "deferred_phase4"
            row["note"] = f"ADR-0016: roof not rendered ({', '.join(reasons)}); modelled in Phase 4"
        else:
            row["status_b"] = "fail_not_rendered"
            row["note"] = f"rendered=false, render_reason {reasons}"
    else:
        bl = bl[bl["rendered"]]
        row["rendered_building_keys"] = ";".join(bl["building_key"])
        rv = layers["render_volumes"]
        geoms = []
        for _, r in bl.iterrows():
            if r["source"] == "dbt":
                v = rv[(rv["building_key"] == r["building_key"]) & rv["rendered"]]
                geoms += list(v.geometry)
            else:
                geoms.append(r.geometry)
        d = _dist(_centroid(shapely.union_all(geoms)), e)
        row["dist_b_rendered_m"] = f"{d:.3f}"
        row["status_b"] = "pass" if d <= tol else "fail"
    return row


@pytest.fixture(scope="module")
def rows(layers):
    result = [_check(e, layers) for e in _entries()]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with (OUT_DIR / "landmarks_check.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        w.writeheader()
        w.writerows(result)
    return {r["id"]: r for r in result}


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
        f"{lid}: rendered building centroid is {r['dist_b_rendered_m'] or 'n/a'} m from the "
        f"reference (tolerance {r['tolerance_m']} m), status {r['status_b']}. {r['note']}"
    )
