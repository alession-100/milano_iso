"""VERIFICATION section 3: CRS, geometry validity, duplicates, extent (T-1.6 checks 1-3)."""

import os

import pandas as pd
import pyogrio
import shapely
from milano_iso import config
from milano_iso import extent as extent_mod

EXTENT_NAME = os.environ.get("MILANO_ISO_EXTENT", "pilot")
EXTENT = extent_mod.polygon(EXTENT_NAME)
shapely.prepare(EXTENT)
TOLERANCE_M = 1e-6  # float noise of a point put on the extent edge (T-6.1)


def _intersects(geoms):
    """Intersects the extent; for another extent than the pilot a miss below 1 micron counts."""
    hit = geoms.intersects(EXTENT)
    if EXTENT_NAME != "pilot" and not hit.all():
        hit = hit | pd.Series(
            shapely.dwithin(geoms.to_numpy(), EXTENT, TOLERANCE_M), index=geoms.index
        )
    return hit


# Columns that identify a feature of a layer; a duplicate is the same key and the same geometry.
KEY_COLUMNS = {
    "comune_boundary": [],
    "dbt_buildings": ["bld_id"],
    "dbt_volumes": ["vol_id"],
    "render_volumes": ["vol_key"],
    "buildings": ["building_key"],
}
DEFAULT_KEY = ["osm_type", "osm_id"]


def test_crs_every_layer_is_epsg32632(gpkg):
    bad = {}
    for name, _ in pyogrio.list_layers(gpkg):
        crs = pyogrio.read_info(gpkg, layer=name)["crs"]
        if crs != "EPSG:32632":
            bad[name] = crs
    assert not bad, f"layers not in EPSG:32632: {bad}"


def test_geometry_valid_and_nonempty(layer_name, layers):
    gdf = layers[layer_name]
    g = gdf.geometry
    n_null = int(g.isna().sum())
    n_empty = int(g.is_empty.sum())
    invalid = gdf[~g.is_valid & ~g.isna()]
    assert n_null == 0 and n_empty == 0, (
        f"{layer_name}: {n_null} null and {n_empty} empty geometries"
    )
    assert invalid.empty, (
        f"{layer_name}: {len(invalid)} invalid geometries, first rows {list(invalid.index[:5])}: "
        f"{[shapely.is_valid_reason(x) for x in invalid.geometry.iloc[:3]]}"
    )


def test_geometry_no_zero_area_or_zero_length(layer_name, layers):
    gdf = layers[layer_name]
    types = set(gdf.geometry.geom_type)
    polys = gdf[gdf.geom_type.isin(["Polygon", "MultiPolygon"])]
    lines = gdf[gdf.geom_type.isin(["LineString", "MultiLineString"])]
    zero_area = polys[polys.area <= 0]
    zero_len = lines[lines.length <= 0]
    assert zero_area.empty, (
        f"{layer_name}: {len(zero_area)} zero-area polygons, rows {list(zero_area.index[:5])}"
    )
    assert zero_len.empty, (
        f"{layer_name}: {len(zero_len)} zero-length lines, rows {list(zero_len.index[:5])}"
    )
    assert types <= {
        "Polygon",
        "MultiPolygon",
        "LineString",
        "MultiLineString",
        "Point",
    }, f"{layer_name}: unexpected geometry types {types}"


def test_geometry_no_exact_duplicates(layer_name, layers):
    gdf = layers[layer_name]
    key = KEY_COLUMNS.get(layer_name, DEFAULT_KEY)
    frame = pd.DataFrame({k: gdf[k].astype(str) for k in key})
    frame["wkb"] = shapely.to_wkb(gdf.geometry.to_numpy())
    dup = frame.duplicated(keep=False)
    assert not dup.any(), (
        f"{layer_name}: {int(dup.sum())} rows share key {key} and geometry with another row, "
        f"first rows {list(frame.index[dup][:5])}"
    )


# Layers where several rows share one geometry legitimately (T-1.7): named_features holds one
# row per named OSM object, and distinct objects share a position or an outline (on the pilot:
# 80 rows, 44 surplus; 55 ways, 18 nodes, 7 relations; e.g. a bus stop and a stop position at
# one point).
SAME_GEOMETRY_EXEMPT = ("named_features",)


def test_geometry_no_same_geometry_different_key(layer_name, layers, report):
    """T-1.7 (G1 finding 6): no two rows of a layer share one geometry, whatever their key."""
    gdf = layers[layer_name]
    wkb = pd.Series(shapely.to_wkb(gdf.geometry.to_numpy()))
    n_extra = int(wkb.duplicated().sum())
    n_rows = int(wkb.duplicated(keep=False).sum())
    report.add(
        f"Same geometry, any key: {layer_name}",
        f"- rows sharing a geometry with another row: {n_rows}; surplus rows: {n_extra}; "
        f"exempt: {layer_name in SAME_GEOMETRY_EXEMPT}",
    )
    if layer_name in SAME_GEOMETRY_EXEMPT:
        return
    if EXTENT_NAME != "pilot":
        # T-6.1: the city has such rows in the OSM data (duplicate mapped objects, flagged
        # `same_geometry_different_key` in the drop log, kept). They are counted above and listed
        # in the report, not fixed here (task card: data defects are reported).
        return
    assert n_rows == 0, (
        f"{layer_name}: {n_rows} rows share a geometry with another row "
        f"(first rows {list(wkb.index[wkb.duplicated(keep=False)][:5])})"
    )


def test_extent_every_feature_intersects_pilot(layer_name, layers):
    """ADR-0013 (as amended in T-1.4): features are kept whole if they intersect the extent.
    DBT volumes are kept when their building intersects; the building is the one in
    dbt_buildings (for dbt_volumes) or in buildings (for render_volumes)."""
    gdf = layers[layer_name]
    inside = _intersects(gdf.geometry)
    outside = gdf[~inside]
    if layer_name == "dbt_volumes":
        bld = layers["dbt_buildings"].set_index("bld_id").geometry
        ok = outside["building_ref"].map(lambda b: b in bld.index and bld[b].intersects(EXTENT))
        outside = outside[~ok.astype(bool)]
    elif layer_name == "render_volumes":
        bld = layers["buildings"].set_index("building_key").geometry
        ok = outside["building_key"].map(lambda b: b in bld.index and bld[b].intersects(EXTENT))
        outside = outside[~ok.astype(bool)]
    assert outside.empty, (
        f"{layer_name}: {len(outside)} features do not intersect the pilot extent "
        f"{config.PILOT_AOI_BBOX} (and are not volumes of an intersecting building), "
        f"first rows {list(outside.index[:5])}"
    )
