"""Stylised landmark details on the real pilot tiles (T-4.2, ADR-0028 decision 1).

* every detail row is flagged stylised, and its kind comes from the landmark's spec;
* in-pilot landmarks get details, out-of-pilot ones none (Phase 6);
* every detail lies within the landmark's rendered footprint union buffered by the style
  tolerance (at most 2 m); the Galleria is checked against its OSM roof footprint (ADR-0016);
* no detail's base is below the top of the volume it sits on; the Galleria vault's base is the
  lowest top_m of the adjacent rendered volumes (recomputed here, independently of the exporter).
The landmark position checks (ADR-0017/0018/0020) live in test_data_landmarks.py and are unchanged.
"""

import json
from collections import defaultdict

import numpy as np
import pytest
import shapely
from milano_iso import config, landmark_style
from milano_iso.tiles import manifest
from shapely import affinity
from shapely.geometry import Point
from tile_decode import decode_glb

TILE_DIR = config.DATA_DIR / "tiles" / "pilot"
DETAIL_LAYER = "landmark_details"
BASE_TOL_M = 0.03  # int16 quantisation is 2 cm; allow a little more
INTERIOR_M = 0.05  # a base point counts as "on" a volume when this far inside its footprint


def _local(g):
    return affinity.translate(g, xoff=-config.ORIGIN_E, yoff=-config.ORIGIN_N)


@pytest.fixture(scope="module")
def man() -> dict:
    p = TILE_DIR / manifest.MANIFEST_NAME
    assert p.exists(), f"{p} not found; run `make tiles` first"
    return json.loads(p.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def details(man) -> dict:
    """{landmark_id: [{kind, tile, xz (n, 2) local E/N, y (n,)}]} from the decoded glb files."""
    out = defaultdict(list)
    for t in man["tiles"]:
        table = json.loads((TILE_DIR / t["features"]["file"]).read_text(encoding="utf-8"))
        rows = table["layers"].get(DETAIL_LAYER)
        if not rows:
            continue
        for m in decode_glb(TILE_DIR / t["glb"]["file"]):
            if m["layer"] != DETAIL_LAYER:
                continue
            for fid, row in enumerate(rows):
                sel = m["fid"] == fid
                if not sel.any():
                    continue
                p = m["positions"][sel]
                out[row["landmark_id"]].append(
                    {
                        "kind": row["detail"],
                        "row": row,
                        "tile": t["id"],
                        "n": np.column_stack([p[:, 0], -p[:, 2]]),  # local E, N
                        "y": p[:, 1],
                    }
                )
    return out


@pytest.fixture(scope="module")
def volumes(layers):
    """{landmark_id: [(vol_key, local polygon, top_m)]} of the rendered volumes carrying the id."""
    b, v = layers["buildings"], layers["render_volumes"]
    b = b[b["rendered"].astype(bool) & b["landmark_id"].notna()]
    out = defaultdict(list)
    for r in b.itertuples(index=False):
        for x in v[(v["building_key"] == r.building_key) & v["rendered"].astype(bool)].itertuples():
            out[r.landmark_id].append((x.vol_key, _local(x.geometry), float(x.top_m)))
    return out


def test_manifest_lists_the_layer_and_counts_match(man, details):
    assert DETAIL_LAYER in man["layers"]
    assert DETAIL_LAYER not in man["instanced_layers"]
    n_rows = sum(len(v) for v in details.values())
    assert man["totals"]["counts"].get(DETAIL_LAYER, 0) == n_rows > 0


def test_every_row_is_flagged_and_kinds_come_from_the_spec(man, details):
    for t in man["tiles"]:
        table = json.loads((TILE_DIR / t["features"]["file"]).read_text(encoding="utf-8"))
        for r in table["layers"].get(DETAIL_LAYER, []):
            assert set(r) == {"landmark_id", "detail", "stylised"}
            assert r["stylised"] is True
            spec = landmark_style.SPECS[r["landmark_id"]]
            assert r["detail"] in {i.primitive.kind for i in spec.items}


def test_in_pilot_landmarks_have_details_and_out_of_pilot_none(details, report):
    for lid, spec in sorted(landmark_style.SPECS.items()):
        got = len(details.get(lid, []))
        if spec.in_pilot:
            assert got > 0, f"{lid}: no details in the pilot tiles"
        else:
            assert got == 0, f"{lid}: out of the pilot, must be placed in Phase 6"
    lines = [
        f"- {lid}: {len(d)} details {sorted({x['kind'] for x in d})}"
        for lid, d in sorted(details.items())
    ]
    report.add("Landmark details (T-4.2)", "\n".join(lines))


def test_details_lie_within_the_landmark_footprint_union(details, volumes, layers):
    tol = landmark_style.POSITION_TOLERANCE_M
    assert tol <= 2.0
    worst = {}
    for lid, items in sorted(details.items()):
        spec = landmark_style.SPECS[lid]
        if spec.roof is not None:
            osm = layers["osm_buildings"]
            sel = osm[(osm["osm_type"] == spec.roof.osm_type) & (osm["osm_id"] == spec.roof.osm_id)]
            assert len(sel) == 1
            region = _local(sel.geometry.iloc[0])
        else:
            region = shapely.union_all([g for _, g, _ in volumes[lid]])
        zone = region.buffer(tol)
        for it in items:
            pts = shapely.points(it["n"])
            out = ~shapely.contains(zone, pts)
            assert not out.any(), f"{lid} {it['kind']} in tile {it['tile']}: vertex outside"
            worst[lid] = max(worst.get(lid, 0.0), float(shapely.distance(region, pts).max()))
    assert worst


def test_no_detail_base_below_the_volume_it_sits_on(details, volumes):
    for lid, items in sorted(details.items()):
        spec = landmark_style.SPECS[lid]
        if spec.roof is not None:
            continue  # the vault has its own test
        vols = volumes[lid]
        for it in items:
            base = float(it["y"].min())
            low = it["y"] <= base + BASE_TOL_M
            prism = {
                i.primitive.kind
                for i in spec.items
                if isinstance(i.primitive, landmark_style.Prism)
            }
            pts = it["n"][low]
            if it["kind"] in prism:
                # a prism stands on its anchor point: the centre of its lowest ring
                pts = pts.mean(axis=0, keepdims=True)
            for (x, n), y in zip(pts, it["y"][low][: len(pts)], strict=False):
                p = Point(x, n)
                tops = [t for _, g, t in vols if g.buffer(-INTERIOR_M).contains(p)]
                if tops:
                    assert y >= max(tops) - BASE_TOL_M, (
                        f"{lid} {it['kind']}: base {y:.3f} below top {max(tops):.3f}"
                    )


def test_galleria_vault_base_is_the_lowest_adjacent_eave(details, layers):
    """Recomputes the rule (volumes within 1 m of the roof footprint, >= 10 m2 inside that zone,
    one building) without the exporter code and compares the vault's lowest vertex."""
    spec = landmark_style.SPECS["galleria_vittorio_emanuele_ii"]
    osm = layers["osm_buildings"]
    roof = _local(
        osm[
            (osm["osm_type"] == spec.roof.osm_type) & (osm["osm_id"] == spec.roof.osm_id)
        ].geometry.iloc[0]
    )
    zone = roof.buffer(1.0)
    v = layers["render_volumes"]
    v = v[v["rendered"].astype(bool)]
    adj = [
        (r.building_key, float(r.top_m))
        for r in v.itertuples(index=False)
        if _local(r.geometry).intersection(zone).area >= 10.0
    ]
    assert len({k for k, _ in adj}) == 1, "the adjacent volumes must belong to one building"
    eave = min(t for _, t in adj)
    vaults = details["galleria_vittorio_emanuele_ii"]
    assert len(vaults) >= 1
    for it in vaults:
        assert it["kind"] == "roof_vault"
        assert it["y"].min() == pytest.approx(eave, abs=BASE_TOL_M)
        assert it["y"].max() > eave + 1.0  # it does rise above the eave
