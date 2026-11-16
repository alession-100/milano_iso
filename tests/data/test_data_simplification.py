"""VERIFICATION section 3: footprint simplification tolerance (T-1.6 check 8, real check in T-2.5).

For every exported building volume the footprint is decoded from the tile .glb (up-facing
triangles at the volume's top height, unioned) and compared with the source volume geometry in
render_volumes: symmetric region Hausdorff distance <= 0.5 m (ADR-0021; see region_hausdorff). The decoded footprint includes
the 2 cm quantisation, so this is the distance the client actually sees.
"""

import json
from collections import defaultdict

import numpy as np
import pyogrio
import shapely
from milano_iso import config
from milano_iso.tiles import geom, glb, manifest
from shapely import affinity
from tile_decode import decode_glb

TILE_DIR = config.DATA_DIR / "tiles" / "pilot"
DENSIFY_M = 0.25
Y_TOL = glb.QUANT_SCALE / 2 + 1e-6  # a top height may move by half a quantisation unit


def region_hausdorff(a, b, step=DENSIFY_M):
    """Symmetric Hausdorff distance between two polygonal regions (metres).

    Boundary points (vertices plus points every ``step`` m along the edges) of one region are
    measured to the other *region* (0 when inside it). shapely.hausdorff_distance measures to
    boundary vertices only; that overstates the distance when the decoded union of adjacent
    volumes has small internal gaps (holes between separately simplified volumes), because a
    hole vertex lies inside the source region but far from its boundary.
    """
    worst = 0.0
    for x, y in ((a, b), (b, a)):
        pts = shapely.get_coordinates(shapely.segmentize(shapely.boundary(x), step))
        worst = max(worst, float(shapely.distance(shapely.points(pts), y).max()))
    return worst


def _decoded_top_footprints(glb_path):
    """{(fid, qy): polygon} of the up-facing triangles of the building meshes of one tile."""
    groups = defaultdict(list)
    for m in decode_glb(glb_path):
        if m["layer"] != "buildings":
            continue
        q, p, tris, fid = m["q"], m["positions"], m["tris"], m["fid"]
        flat = (q[tris[:, 0], 1] == q[tris[:, 1], 1]) & (q[tris[:, 0], 1] == q[tris[:, 2], 1])
        a, b, c = (p[tris[:, k]] for k in range(3))
        # client frame (x, z) with N = -z: counter-clockwise in (E, N) is up-facing
        area2 = (b[:, 0] - a[:, 0]) * (-(c[:, 2]) + a[:, 2]) - (c[:, 0] - a[:, 0]) * (
            -(b[:, 2]) + a[:, 2]
        )
        for t in np.flatnonzero(flat & (area2 > 0)):
            ring = np.stack([a[t], b[t], c[t], a[t]])[:, [0, 2]] * np.array([1.0, -1.0])
            groups[(int(fid[tris[t, 0]]), int(q[tris[t, 0], 1]))].append(shapely.Polygon(ring))
    return {k: shapely.union_all(v) for k, v in groups.items()}


def test_simplification_tolerance(gpkg, report):
    man = json.loads((TILE_DIR / manifest.MANIFEST_NAME).read_text(encoding="utf-8"))
    vols = pyogrio.read_dataframe(
        gpkg, layer="render_volumes", columns=["building_key", "vol_key", "top_m", "rendered"]
    )
    vols = vols[vols["rendered"].astype(bool)]
    by_key = defaultdict(list)
    for v in vols.itertuples(index=False):
        by_key[v.building_key].append(v)

    worst = (0.0, "")
    n_groups = n_volumes = 0
    problems = []
    for t in man["tiles"]:
        table = json.loads((TILE_DIR / t["features"]["file"]).read_text(encoding="utf-8"))
        keys = [f["key"] for f in table["layers"].get("buildings", [])]
        decoded = _decoded_top_footprints(TILE_DIR / t["glb"]["file"])
        by_fid = defaultdict(dict)
        for (fid, qy), poly in decoded.items():
            by_fid[fid][qy] = poly
        for fid, key in enumerate(keys):
            groups = by_fid.get(fid, {})
            assigned = defaultdict(list)
            for v in by_key.get(key, []):
                n_volumes += 1
                best = min(groups, key=lambda qy: abs(qy * glb.QUANT_SCALE - v.top_m), default=None)
                if best is None or abs(best * glb.QUANT_SCALE - v.top_m) > Y_TOL:
                    problems.append(f"{key} vol {v.vol_key}: no decoded top at {v.top_m}")
                    continue
                g = affinity.translate(v.geometry, xoff=-config.ORIGIN_E, yoff=-config.ORIGIN_N)
                assigned[best].append(g)
            for qy, srcs in sorted(assigned.items()):
                n_groups += 1
                h = region_hausdorff(groups[qy], shapely.union_all(srcs))
                if h > worst[0]:
                    worst = (h, f"{key} @ {qy * glb.QUANT_SCALE:.2f} m in tile {t['id']}")
                if h > geom.MAX_HAUSDORFF_M:
                    problems.append(f"{key} @ {qy}: Hausdorff {h:.3f} m")
            extra = sorted(set(groups) - set(assigned))
            if extra:
                problems.append(f"{key}: decoded tops without a source volume: {extra}")

    report.add(
        "Simplification (T-2.5)",
        f"{n_volumes} source volumes in {n_groups} decoded footprint groups; maximum Hausdorff "
        f"{worst[0]:.4f} m ({worst[1]}); limit {geom.MAX_HAUSDORFF_M} m.",
    )
    assert n_volumes > 0 and n_groups > 0
    assert not problems, "; ".join(problems[:10]) + f" ({len(problems)} problems)"
    assert worst[0] <= geom.MAX_HAUSDORFF_M
