"""Content checks on the real exported tiles (T-2.5, G2 findings 1 and 2).

* content_bbox_local of every tile bounds all decoded vertices (tolerance 0.01 m).
* Flat layers: every source feature inside the processed extent appears in a tile (by layer and
  id), pieces of one feature in different tiles do not overlap, and the summed tile area per
  area layer equals the source area clipped to the processed extent (0.1%).
"""

import json
from collections import defaultdict

import numpy as np
import pyogrio
import pytest
import shapely
from milano_iso import config
from milano_iso.tiles import manifest
from shapely import affinity
from shapely.geometry import box
from tile_decode import decode_glb

TILE_DIR = config.DATA_DIR / "tiles" / "pilot"
BBOX_TOL_M = 0.01
OVERLAP_TOL_M2 = 0.01
AREA_REL_TOL = 0.001
MIN_PRESENT_M = 0.01  # a source feature needs at least this much area (m2) or length (m) inside
FLAT_AREA_LAYERS = ("landuse", "green", "water", "road_areas")
FLAT_LINE_LAYERS = ("roads", "rail")


@pytest.fixture(scope="module")
def man() -> dict:
    p = TILE_DIR / manifest.MANIFEST_NAME
    assert p.exists(), f"{p} not found; run `make tiles` first"
    return manifest.load_full(TILE_DIR)


@pytest.fixture(scope="module")
def decoded(man) -> dict:
    """{tile id: (meshes, feature tables)}."""
    out = {}
    for t in man["tiles"]:
        meshes = decode_glb(TILE_DIR / t["glb"]["file"])
        table = json.loads((TILE_DIR / t["features"]["file"]).read_text(encoding="utf-8"))
        out[t["id"]] = (meshes, table["layers"])
    return out


def test_tiles_content_bbox_bounds_every_decoded_vertex(man, decoded, report):
    overhang = 0.0
    for t in man["tiles"]:
        bb = t["content_bbox_local"]
        lo, hi = np.array(bb["min"]), np.array(bb["max"])
        pts = np.concatenate([m["positions"] for m in decoded[t["id"]][0]])
        assert (pts >= lo - BBOX_TOL_M).all(), f"tile {t['id']}: vertex below content bbox"
        assert (pts <= hi + BBOX_TOL_M).all(), f"tile {t['id']}: vertex above content bbox"
        # tight, not just sufficient
        assert np.abs(pts.min(axis=0) - lo).max() <= BBOX_TOL_M, t["id"]
        assert np.abs(pts.max(axis=0) - hi).max() <= BBOX_TOL_M, t["id"]
        x0, z0, x1, z1 = t["bbox_local"]
        overhang = max(overhang, x0 - lo[0], hi[0] - x1, z0 - lo[2], hi[2] - z1)
    report.add(
        "Tile content bounds (T-2.5)",
        f"{len(man['tiles'])} tiles; every decoded vertex inside content_bbox_local "
        f"(tolerance {BBOX_TOL_M} m); largest overhang of the content beyond the grid cell "
        f"{overhang:.2f} m.",
    )


def _source_flat(gpkg, layer):
    gdf = pyogrio.read_dataframe(gpkg, layer=layer)
    if "underground" in gdf.columns:
        gdf = gdf[~gdf["underground"].astype(bool)]
    return gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]


def _extent_local():
    x0, y0, x1, y1 = config.PILOT_AOI_BBOX
    return box(
        x0 - config.ORIGIN_E, y0 - config.ORIGIN_N, x1 - config.ORIGIN_E, y1 - config.ORIGIN_N
    )


def _tile_geometry(meshes, layer, fid_to_id):
    """{(osm_type, osm_id): polygon union} and the summed triangle area, for one tile layer."""
    polys = defaultdict(list)
    total = 0.0
    for m in meshes:
        if m["layer"] != layer:
            continue
        p, tris, fid = m["positions"], m["tris"], m["fid"]
        for t in range(len(tris)):
            v = p[tris[t]]
            ring = [(v[k, 0], -v[k, 2]) for k in (0, 1, 2, 0)]
            poly = shapely.Polygon(ring)
            total += poly.area
            polys[fid_to_id[int(fid[tris[t, 0]])]].append(poly)
    return {k: shapely.union_all(v) for k, v in polys.items()}, total


@pytest.fixture(scope="module")
def flat_pieces(man, decoded):
    """{layer: {id: [(tile, polygon)]}} and {layer: summed tile area}."""
    pieces = {ly: defaultdict(list) for ly in (*FLAT_AREA_LAYERS, *FLAT_LINE_LAYERS)}
    areas = dict.fromkeys(pieces, 0.0)
    for t in man["tiles"]:
        meshes, tables = decoded[t["id"]]
        for layer in pieces:
            if layer not in tables:
                continue
            ids = [(f["osm_type"], f["osm_id"]) for f in tables[layer]]
            geoms, total = _tile_geometry(meshes, layer, ids)
            areas[layer] += total
            for k, g in geoms.items():
                pieces[layer][k].append((t["id"], g))
    return pieces, areas


def test_flat_every_source_feature_inside_the_extent_is_in_a_tile(gpkg, flat_pieces, report):
    pieces, _ = flat_pieces
    ext = _extent_local()
    lines = []
    for layer in (*FLAT_AREA_LAYERS, *FLAT_LINE_LAYERS):
        src = _source_flat(gpkg, layer)
        required, missing = set(), []
        for row in src.itertuples(index=False):
            g = affinity.translate(row.geometry, xoff=-config.ORIGIN_E, yoff=-config.ORIGIN_N)
            if not g.is_valid:
                g = shapely.make_valid(g)
            inside = g.intersection(ext)
            size = inside.area if layer in FLAT_AREA_LAYERS else inside.length
            if size > MIN_PRESENT_M:
                key = (row.osm_type, row.osm_id)
                required.add(key)
        missing = sorted(required - set(pieces[layer]), key=str)
        lines.append(f"- {layer}: {len(required)} source features required, {len(missing)} missing")
        assert not missing, (
            f"{layer}: {len(missing)} features missing from the tiles: {missing[:10]}"
        )
    report.add("Flat-layer coverage (T-2.5)", "\n".join(lines))


def test_flat_pieces_of_one_feature_do_not_overlap_across_tiles(flat_pieces, report):
    pieces, _ = flat_pieces
    worst = 0.0
    n_multi = 0
    for layer, by_id in pieces.items():
        for key, parts in by_id.items():
            if len(parts) < 2:
                continue
            n_multi += 1
            for a in range(len(parts)):
                for b in range(a + 1, len(parts)):
                    area = parts[a][1].intersection(parts[b][1]).area
                    worst = max(worst, area)
                    assert area < OVERLAP_TOL_M2, (
                        f"{layer} {key}: tiles {parts[a][0]} and {parts[b][0]} overlap {area:.4f} m2"
                    )
    report.add(
        "Flat-layer piece overlap (T-2.5)",
        f"{n_multi} features span more than one tile; largest overlap between pieces in "
        f"different tiles {worst:.6f} m2 (limit {OVERLAP_TOL_M2}).",
    )


def test_flat_summed_tile_area_equals_clipped_source_area(gpkg, flat_pieces, report):
    _, areas = flat_pieces
    ext = _extent_local()
    lines = [
        "| layer | source area clipped m2 | tile area m2 | relative difference |",
        "|---|---:|---:|---:|",
    ]
    for layer in FLAT_AREA_LAYERS:
        total = 0.0
        for g in _source_flat(gpkg, layer).geometry:
            g = affinity.translate(g, xoff=-config.ORIGIN_E, yoff=-config.ORIGIN_N)
            if not g.is_valid:
                g = shapely.make_valid(g)
            total += g.intersection(ext).area
        rel = abs(areas[layer] - total) / total
        lines.append(f"| {layer} | {total:.2f} | {areas[layer]:.2f} | {rel:.3%} |")
        assert rel <= AREA_REL_TOL, f"{layer}: tile area {areas[layer]:.2f} vs source {total:.2f}"
    report.add("Flat-layer area (T-2.5)", "\n".join(lines))
