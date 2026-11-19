"""Normalise the OSM and DBT pilot extracts into validated layers in EPSG:32632 (T-1.3).

Reads ``interim/osm_pilot.gpkg`` (EPSG:4326), ``interim/dbt_pilot.gpkg`` (EPSG:7791) and the
comune boundary, and writes ``processed/pilot.gpkg`` (every layer EPSG:32632), plus the drop
log and the validation report. No simplification, no heights, no OSM/DBT matching here. DBT volumes outside the extent are
kept when their building intersects it (T-1.4).

Run: ``python -m milano_iso.normalise --extent pilot``
"""

import argparse
import csv
import json
import logging
import shutil
import sys
from collections import Counter
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely
from pyproj import CRS, Transformer
from pyproj.transformer import TransformerGroup
from shapely.geometry import box

from milano_iso import classify, config, fetch
from milano_iso import extent as extent_mod
from milano_iso.dbt_extract import natural_key
from milano_iso.geo import canonical_dump_sha256
from milano_iso.measure import report_counts

log = logging.getLogger("milano_iso.normalise")

METRIC_CRS = "EPSG:32632"
OSM_CRS = "EPSG:4326"
DBT_CRS = "EPSG:7791"
ARTIFACT_DIR = config.REPO_ROOT / "reports" / "artifacts" / "T-1.3"
COMPLETENESS_TARGET = 0.99
DROP_LOG_COLUMNS = ["layer", "source", "id", "action", "reason"]

OSM_KINDS = {"points": classify.POINT, "lines": classify.LINE, "areas": classify.AREA}

# Spec labels (Regione Lombardia DBGT content specification, manifest dbt_spec).
# EDIFC_TY: pp.135-137. EDIFC_STAT: p.141. EDI_MIN_TY: pp.151-152. EDI_MIN_ST: p.152.
# EDIFC_USO (multi-valued, domain on pp.136-141) is kept as codes only: the PDF table layout
# does not extract reliably, so no labels are guessed.
EDIFC_TY_LABELS = {
    "01": "generica",
    "02": "palazzo a torre, grattacielo",
    "03": "edificio tipico",
    "0301": "nuraghe",
    "0302": "damuso",
    "0303": "tabià",
    "0304": "masseria",
    "0305": "trullo",
    "0306": "barchessa",
    "04": "villa",
    "0401": "villa veneta",
    "05": "villetta a schiera",
    "06": "battistero",
    "07": "campanile",
    "08": "capannone",
    "09": "edificio rurale",
    "10": "castello",
    "11": "chiesa",
    "12": "anfiteatro",
    "13": "faro",
    "14": "hangar",
    "15": "minareto, moschea",
    "16": "tempio",
    "17": "mulino",
    "18": "osservatorio",
    "19": "palazzetto dello sport",
    "20": "sinagoga",
    "21": "stadio",
    "22": "cattedrale",
    "95": "altro",
}
STATUS_LABELS = {"01": "in costruzione", "02": "diruto, rudere", "03": "costruito"}
EDI_MIN_TY_LABELS = {
    "01": "baracca",
    "02": "chiosco",
    "03": "tomba cimiteriale",
    "04": "edicola funeraria",
    "05": "torre, porta",
    "06": "manufatto di insediamento archeologico",
    "07": "garage, box auto",
    "08": "casello autostradale",
    "09": "ingresso, portineria",
    "10": "servizi alle attrezzature sportive",
    "11": "attrezzature turistiche, balneari",
    "12": "servizi alle strutture produttive",
    "13": "edificio cimiteriale di servizio",
    "14": "tendone pressurizzato",
    "15": "spogliatoio",
    "16": "edifici minori ricreativo/sportivi",
    "17": "loggiato",
    "18": "cappella",
    "19": "cavana",
    "20": "container, prefabbricato",
    "95": "altro",
}
# UN_VOL_POR (spec p.133-134): 08 "sotterranea" identifies underground volumes.
UNDERGROUND_POR = ("08",)


# ----------------------------------------------------------------------------- drop log


class DropLog:
    """Every dropped, repaired or deduplicated feature, with a reason."""

    def __init__(self):
        self.rows: list[tuple[str, str, str, str, str]] = []

    def add(self, layer, source, fid, action, reason):
        if not reason:
            raise ValueError("every drop log row needs a reason")
        self.rows.append((layer, source, str(fid), action, reason))

    def frame(self) -> pd.DataFrame:
        return pd.DataFrame(sorted(self.rows), columns=DROP_LOG_COLUMNS)

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="\n", encoding="utf-8") as f:
            w = csv.writer(f, lineterminator="\n")
            w.writerow(DROP_LOG_COLUMNS)
            w.writerows(sorted(self.rows))


# ----------------------------------------------------------------------------- geometry


def reproject(geoms, src_crs: str, dst_crs: str = METRIC_CRS) -> np.ndarray:
    """2D coordinates through ``Transformer(always_xy=True)``. Z, if any, is dropped."""
    t = Transformer.from_crs(src_crs, dst_crs, always_xy=True)
    flat = shapely.force_2d(np.asarray(geoms, dtype=object))
    return shapely.transform(flat, lambda c: np.column_stack(t.transform(c[:, 0], c[:, 1])))


def _parts_of(geom, families: tuple) -> list:
    return [p for p in shapely.get_parts(geom) if p.geom_type in families]


def _combine(parts):
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    if parts[0].geom_type == "Polygon":
        return shapely.MultiPolygon(parts)
    return shapely.MultiLineString(parts)


def clean_geometry(geom):
    """Returns (geometry or None, repair_reason or None, drop_reason or None).

    Invalid geometries are repaired with ``make_valid`` keeping only parts of the original
    family (polygons for polygons, lines for lines). Zero-area polygons and zero-length lines
    are dropped.
    """
    if geom is None or shapely.is_empty(geom):
        return None, None, "empty_geometry"
    gtype = geom.geom_type
    if gtype in ("Point", "MultiPoint"):
        return geom, None, None
    families = ("Polygon",) if gtype in ("Polygon", "MultiPolygon") else ("LineString",)
    repair = None
    if not shapely.is_valid(geom):
        repair = shapely.is_valid_reason(geom)
        geom = _combine(_parts_of(shapely.make_valid(geom), families))
        if geom is None:
            return None, None, "invalid_no_usable_part_after_repair"
    if families == ("Polygon",):
        if shapely.area(geom) <= 0:
            return None, None, "zero_area"
    elif shapely.length(geom) <= 0:
        return None, None, "zero_length"
    return geom, repair, None


def clean_layer(gdf: gpd.GeoDataFrame, layer: str, source: str, ids, log: DropLog):
    """Repair / drop invalid geometries. Returns (frame, stats). ``ids`` aligns with rows."""
    keep, geoms = [], []
    repaired = 0
    dropped: Counter = Counter()
    for i, geom in enumerate(gdf.geometry.to_numpy()):
        g, repair, drop = clean_geometry(geom)
        if drop:
            log.add(layer, source, ids[i], "dropped", drop)
            dropped[drop] += 1
            continue
        if repair:
            log.add(layer, source, ids[i], "repaired", repair)
            repaired += 1
        keep.append(i)
        geoms.append(g)
    out = gdf.iloc[keep].copy()
    out["geometry"] = geoms
    out = gpd.GeoDataFrame(out, geometry="geometry", crs=gdf.crs)
    return out.reset_index(drop=True), {
        "repaired": repaired,
        "dropped": dict(sorted(dropped.items())),
    }


def drop_duplicates(gdf: gpd.GeoDataFrame, key_cols, ids, layer: str, source: str, log: DropLog):
    """Remove rows with the same key columns and the same geometry. Returns (frame, count)."""
    wkb = shapely.to_wkb(gdf.geometry.to_numpy(), byte_order=1)
    seen, keep = set(), []
    n_dup = 0
    for i in range(len(gdf)):
        k = (tuple(gdf[c].iloc[i] for c in key_cols), bytes(wkb[i]))
        if k in seen:
            log.add(layer, source, ids[i], "dropped", "duplicate")
            n_dup += 1
            continue
        seen.add(k)
        keep.append(i)
    return gdf.iloc[keep].reset_index(drop=True), n_dup


# Layers where several rows legitimately share one geometry (admin relations, T-1.7).
SAME_GEOMETRY_EXEMPT_LAYERS = ("named_features",)


def flag_same_geometry(gdf: gpd.GeoDataFrame, ids, layer: str, source: str, log: DropLog) -> int:
    """Log (action ``flagged``) every row whose geometry equals that of an earlier row.

    Exact duplicates are removed before this runs, so such rows have a different key. Rows are
    only flagged, never dropped. Exempt layers are skipped. Returns the number of rows flagged.
    """
    if layer in SAME_GEOMETRY_EXEMPT_LAYERS:
        return 0
    wkb = shapely.to_wkb(gdf.geometry.to_numpy(), byte_order=1)
    seen, n = set(), 0
    for i in range(len(gdf)):
        k = bytes(wkb[i])
        if k in seen:
            log.add(layer, source, ids[i], "flagged", "same_geometry_different_key")
            n += 1
        seen.add(k)
    return n


def _finish(gdf, layer, source, key_cols, id_fn, log):
    """clean -> deduplicate -> flag -> sort. Returns (frame, stats)."""
    n_in = len(gdf)
    gdf, stats = clean_layer(gdf, layer, source, [id_fn(r) for r in gdf.itertuples()], log)
    gdf, n_dup = drop_duplicates(
        gdf, key_cols, [id_fn(r) for r in gdf.itertuples()], layer, source, log
    )
    stats["duplicates"] = n_dup
    stats["same_geometry_different_key"] = flag_same_geometry(
        gdf, [id_fn(r) for r in gdf.itertuples()], layer, source, log
    )
    stats["input"] = n_in
    return gdf, stats


# ----------------------------------------------------------------------------- OSM


def read_osm(gpkg: Path) -> dict[str, gpd.GeoDataFrame]:
    out = {}
    for layer in OSM_KINDS:
        gdf = pyogrio.read_dataframe(gpkg, layer=layer)
        gdf["tags"] = gdf["tags"].map(json.loads)
        out[layer] = gdf
    return out


def _tag(tags, key):
    v = tags.get(key)
    return v if v not in ("", None) else None


def _building_row(tags, value):
    return {
        "building": value,
        "name": _tag(tags, "name"),
        "height_raw": _tag(tags, "height"),
        "levels_raw": _tag(tags, "building:levels"),
        "min_height_raw": _tag(tags, "min_height"),
        "min_level_raw": _tag(tags, "building:min_level"),
        "location": _tag(tags, "location"),
        "layer": _tag(tags, "layer"),
        "underground": classify.is_underground(tags),
    }


def _layer_attrs(layer, assigned, tags):
    if layer in ("osm_buildings", "osm_building_parts"):
        return _building_row(tags, assigned)
    if layer == "roads":
        return {
            "class": classify.highway_class(assigned),
            "width_raw": _tag(tags, "width"),
            "lanes_raw": _tag(tags, "lanes"),
            "tunnel": _tag(tags, "tunnel"),
            "bridge": _tag(tags, "bridge"),
            "layer": _tag(tags, "layer"),
            "underground": classify.is_underground(tags),
            "is_platform": classify.is_platform(tags),
        }
    if layer == "road_areas":
        return {
            "class": classify.highway_class(assigned),
            "underground": classify.is_underground(tags),
        }
    if layer == "rail":
        return {
            "class": assigned,
            "tunnel": _tag(tags, "tunnel"),
            "bridge": _tag(tags, "bridge"),
            "layer": _tag(tags, "layer"),
            "underground": classify.is_underground(tags),
        }
    if layer == "water":
        return {"kind": assigned, "underground": classify.is_underground(tags)}
    if layer in ("green", "landuse"):
        return {"kind": assigned}
    if layer == "named_features":
        return {
            "name": _tag(tags, "name"),
            "name_en": _tag(tags, "name:en"),
            "category": classify.named_category(tags),
        }
    raise KeyError(layer)


LAYER_COLUMNS = {
    "osm_buildings": [
        "osm_type",
        "osm_id",
        "building",
        "name",
        "height_raw",
        "levels_raw",
        "min_height_raw",
        "min_level_raw",
        "location",
        "layer",
        "underground",
    ],
    "roads": [
        "osm_type",
        "osm_id",
        "class",
        "width_raw",
        "lanes_raw",
        "tunnel",
        "bridge",
        "layer",
        "underground",
        "is_platform",
    ],
    "road_areas": ["osm_type", "osm_id", "class", "underground"],
    "rail": ["osm_type", "osm_id", "class", "tunnel", "bridge", "layer", "underground"],
    "water": ["osm_type", "osm_id", "kind", "underground"],
    "green": ["osm_type", "osm_id", "kind"],
    "landuse": ["osm_type", "osm_id", "kind"],
    "named_features": ["osm_type", "osm_id", "name", "name_en", "category"],
}
LAYER_COLUMNS["osm_building_parts"] = LAYER_COLUMNS["osm_buildings"]


def osm_id_str(row) -> str:
    return f"{row.osm_type}{row.osm_id}"


def normalise_osm(osm: dict[str, gpd.GeoDataFrame], extent, log: DropLog):
    """Classify every OSM object and build the OSM layers. Returns (layers, stats, report)."""
    records: dict[str, list] = {name: [] for name in LAYER_COLUMNS}
    unassigned_any: Counter = Counter()
    unassigned_thematic: Counter = Counter()
    seen: Counter = Counter()
    for src_layer, kind in OSM_KINDS.items():
        gdf = osm[src_layer]
        geoms = reproject(gdf.geometry.to_numpy(), OSM_CRS)
        for osm_type, osm_id, tags, geom in zip(
            gdf["osm_type"], gdf["osm_id"], gdf["tags"], geoms, strict=True
        ):
            seen[src_layer] += 1
            assigned = classify.classify(kind, tags)
            if not assigned:
                unassigned_any[f"{src_layer}:{classify.top_tag_key(tags)}"] += 1
            if not set(assigned) - {"named_features"}:
                unassigned_thematic[f"{src_layer}:{classify.top_tag_key(tags)}"] += 1
            for layer, value in assigned.items():
                g = geom
                if layer == "roads" and kind == classify.AREA:
                    g = shapely.boundary(geom)  # closed highway way -> its boundary line
                elif layer == "named_features" and kind != classify.POINT:
                    clipped = shapely.intersection(geom, extent)
                    g = shapely.point_on_surface(geom if shapely.is_empty(clipped) else clipped)
                row = {"osm_type": osm_type, "osm_id": int(osm_id)}
                row.update(_layer_attrs(layer, value, tags))
                row["geometry"] = g
                records[layer].append(row)

    layers, stats = {}, {}
    for layer, cols in LAYER_COLUMNS.items():
        rows = records[layer]
        df = pd.DataFrame(rows, columns=[*cols, "geometry"])
        df["osm_id"] = df["osm_id"].astype("int64")
        gdf = gpd.GeoDataFrame(df, geometry="geometry", crs=METRIC_CRS)
        gdf = gdf.sort_values(["osm_type", "osm_id"], kind="stable").reset_index(drop=True)
        gdf, st = _finish(gdf, layer, "osm", ["osm_type", "osm_id"], osm_id_str, log)
        layers[layer] = gdf.sort_values(["osm_type", "osm_id"], kind="stable").reset_index(
            drop=True
        )
        stats[layer] = st
    return (
        layers,
        stats,
        {
            "source_objects": dict(seen),
            "unassigned_to_any_layer_by_top_tag_key": dict(sorted(unassigned_any.items())),
            "unassigned_to_any_thematic_layer_by_top_tag_key": dict(
                sorted(unassigned_thematic.items())
            ),
        },
    )


# ----------------------------------------------------------------------------- DBT


def exterior_z_range(geom) -> tuple[float | None, float | None]:
    """(min, max) Z over the exterior ring(s) of a (Multi)Polygon Z; (None, None) without Z."""
    if not shapely.has_z(geom):
        return None, None
    zs = [
        shapely.get_coordinates(shapely.get_exterior_ring(p), include_z=True)[:, 2]
        for p in shapely.get_parts(geom)
        if p.geom_type == "Polygon"
    ]
    if not zs:
        return None, None
    z = np.concatenate(zs)
    return float(z.min()), float(z.max())


def _label(code, table):
    return table.get(code) if code is not None else None


def _opt(v):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else v


def building_class_of(building_ref, edifc_ids: set, edi_min_ids: set):
    if building_ref in edifc_ids:
        return "EDIFC"
    if building_ref in edi_min_ids:
        return "EDI_MIN"
    return None


def read_dbt(gpkg: Path) -> dict:
    out = {}
    for name in (
        "un_vol",
        "edifc",
        "edifc_me",
        "edi_min",
        "edi_min_me",
        "edifc_attr",
        "edifc_uso",
        "edi_min_attr",
    ):
        out[name] = pyogrio.read_dataframe(gpkg, layer=name)
    return out


def _natural_sorted(df: pd.DataFrame, col: str) -> pd.DataFrame:
    return df.sort_values(col, key=lambda s: s.map(natural_key), kind="stable")


def normalise_dbt(dbt: dict, log: DropLog):
    """Build dbt_volumes and dbt_buildings. Returns (layers, stats, extra)."""
    attr = dbt["edifc_attr"]
    mini = dbt["edi_min_attr"]
    edifc_ids, edi_min_ids = set(attr["CLASSID"]), set(mini["CLASSID"])

    # --- volumes
    uv = _natural_sorted(dbt["un_vol"], "CLASSID").reset_index(drop=True)
    z = [exterior_z_range(g) for g in uv.geometry.to_numpy()]
    rows = pd.DataFrame(
        {
            "vol_id": uv["CLASSID"],
            "building_ref": uv["CEDIUV"],
            "building_class": [building_class_of(r, edifc_ids, edi_min_ids) for r in uv["CEDIUV"]],
            "por": uv["UN_VOL_POR"],
            "av_m": uv["UN_VOL_AV"],
            "qe_m": uv["UN_VOL_QE"],
            "base_z_min_m": [a for a, _ in z],
            "base_z_max_m": [b for _, b in z],
            "underground": uv["UN_VOL_POR"].isin(UNDERGROUND_POR),
            "geometry": reproject(uv.geometry.to_numpy(), DBT_CRS),
        }
    )
    vols = gpd.GeoDataFrame(rows, geometry="geometry", crs=METRIC_CRS)
    vols, vstats = _finish(vols, "dbt_volumes", "dbt", ["vol_id"], lambda r: r.vol_id, log)

    # --- building footprints (EDIFC_CR_EDF_IS + EDI_MIN_CR_EDF_IS)
    uso = dbt["edifc_uso"].groupby("CLASSREF")["EDIFC_USO"].agg(lambda s: ";".join(sorted(s)))
    uso = uso.to_dict()
    a = attr.set_index("CLASSID")
    m = mini.set_index("CLASSID")
    brow = []
    entries = []  # (class, ref, geometry in metres, footprint_source)
    for cls, src in (("EDIFC", dbt["edifc"]), ("EDI_MIN", dbt["edi_min"])):
        geoms = reproject(src.geometry.to_numpy(), DBT_CRS)
        entries += [(cls, ref, g, "is") for ref, g in zip(src["CLASSREF"], geoms, strict=True)]
    # A building with volumes but no IS footprint: ME footprint, else the union of its volumes
    # (T-1.7). Logged as `substituted`.
    have = {e[1] for e in entries}
    me = {}
    for cls, key in (("EDIFC", "edifc_me"), ("EDI_MIN", "edi_min_me")):
        if key in dbt:
            geoms = reproject(dbt[key].geometry.to_numpy(), DBT_CRS)
            for ref, g in zip(dbt[key]["CLASSREF"], geoms, strict=True):
                me.setdefault(ref, g)
    for ref in sorted(set(vols["building_ref"]) - have, key=natural_key):
        cls = building_class_of(ref, edifc_ids, edi_min_ids)
        if cls is None:
            continue  # volume of an unknown building: reported as volumes_unmatched
        if ref in me:
            entries.append((cls, ref, me[ref], "me"))
            log.add("dbt_buildings", "dbt", ref, "substituted", "no_is_footprint_used_me")
        else:
            g = shapely.union_all(vols.loc[vols["building_ref"] == ref, "geometry"].to_numpy())
            entries.append((cls, ref, g, "volumes"))
            log.add("dbt_buildings", "dbt", ref, "substituted", "no_is_footprint_used_volumes")
    for cls, ref, geom, fsrc in entries:
        row = {
            "bld_id": ref,
            "building_class": cls,
            "use_codes": uso.get(ref),
            "footprint_source": fsrc,
        }
        if cls == "EDIFC" and ref in a.index:
            r = a.loc[ref]
            row |= {
                "type_code": _opt(r["EDIFC_TY"]),
                "status_code": _opt(r["EDIFC_STAT"]),
                "monumental": _opt(r["EDIFC_MON"]),
                "name": _opt(r["NOME"]),
            }
            row["type_label"] = _label(row["type_code"], EDIFC_TY_LABELS)
        elif cls == "EDI_MIN" and ref in m.index:
            r = m.loc[ref]
            row |= {
                "type_code": _opt(r["EDI_MIN_TY"]),
                "status_code": _opt(r["EDI_MIN_ST"]),
                "precarious": _opt(r["EDI_MIN_PR"]),
            }
            row["type_label"] = _label(row["type_code"], EDI_MIN_TY_LABELS)
        row["status_label"] = _label(row.get("status_code"), STATUS_LABELS)
        row["geometry"] = geom
        brow.append(row)
    cols = [
        "bld_id",
        "building_class",
        "type_code",
        "type_label",
        "use_codes",
        "status_code",
        "status_label",
        "monumental",
        "precarious",
        "name",
        "footprint_source",
        "geometry",
    ]
    bdf = pd.DataFrame(brow, columns=cols)
    for c in ("monumental", "precarious"):
        bdf[c] = bdf[c].astype("Int64")
    bdf = _natural_sorted(bdf, "bld_id").reset_index(drop=True)
    blds = gpd.GeoDataFrame(bdf, geometry="geometry", crs=METRIC_CRS)
    blds, bstats = _finish(blds, "dbt_buildings", "dbt", ["bld_id"], lambda r: r.bld_id, log)

    by_class = vols["building_class"].fillna("null").value_counts().sort_index()
    extra = {
        "volumes_by_building_class": {str(k): int(v) for k, v in by_class.items()},
        "volumes_unmatched": int(vols["building_class"].isna().sum()),
        "volumes_underground_por_08": int(vols["underground"].sum()),
    }
    layers = {"dbt_volumes": vols, "dbt_buildings": blds}
    return layers, {"dbt_volumes": vstats, "dbt_buildings": bstats}, extra


# ----------------------------------------------------------------------------- boundary


def normalise_boundary(path: Path, log: DropLog):
    gdf = gpd.read_file(path)
    src = gdf.crs.to_string() if gdf.crs is not None else OSM_CRS
    gdf = gdf.copy()
    gdf["geometry"] = reproject(gdf.geometry.to_numpy(), src)
    gdf = gpd.GeoDataFrame(gdf, geometry="geometry", crs=METRIC_CRS)
    n = len(gdf)
    gdf, st = clean_layer(gdf, "comune_boundary", "boundary", [str(i) for i in range(n)], log)
    st.update(input=n, duplicates=0)
    return gdf, st


# ----------------------------------------------------------------------------- run


def write_layers(layers: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    for name in sorted(layers):
        pyogrio.write_dataframe(layers[name], out, layer=name, driver="GPKG")


def volumes_outside_extent(vols: pd.DataFrame, buildings: pd.DataFrame, extent) -> tuple[int, int]:
    """(violations, kept_with_building) for DBT volumes.

    A volume outside the extent is allowed only when its building intersects the extent
    (ADR-0013, T-1.4: all volumes of a building are kept). A building intersects the extent
    when one of its volumes or its footprint does. Returns the number of outside volumes
    whose building does not intersect (violations) and the number allowed (kept).
    """
    inside = shapely.intersects(vols.geometry.to_numpy(), extent)
    touching = set(vols.loc[inside, "building_ref"])
    touching |= set(
        buildings.loc[shapely.intersects(buildings.geometry.to_numpy(), extent), "bld_id"]
    )
    outside = vols.loc[~inside]
    ok = outside["building_ref"].isin(touching)
    return int((~ok).sum()), int(ok.sum())


BOUNDARY_TOLERANCE_M = 1e-6  # floating-point noise of a point put on the extent edge (T-6.1)


def _count_outside(geoms, extent) -> int:
    """Geometries that do not intersect ``extent``, within ``BOUNDARY_TOLERANCE_M``.

    A named line clipped to the comune polygon is reduced to a point on its surface that can land
    on the boundary and miss ``intersects`` by about 1e-10 m (T-6.1: 38 of 68426 named features).
    """
    miss = ~shapely.intersects(geoms, extent)
    if not miss.any():
        return 0
    return int((~shapely.dwithin(geoms[miss], extent, BOUNDARY_TOLERANCE_M)).sum())


def check_output(gpkg: Path, extent) -> dict:
    """Read the written file back: CRS, geometry validity and extent intersection per layer."""
    res = {}
    frames = {}
    for name in sorted(n for n, _ in pyogrio.list_layers(gpkg)):
        info = pyogrio.read_info(gpkg, layer=name)
        frames[name] = pyogrio.read_dataframe(gpkg, layer=name)
        g = frames[name].geometry.to_numpy()
        res[name] = {
            "crs": info["crs"],
            "features": len(g),
            "invalid": int((~shapely.is_valid(g)).sum()),
            "outside_extent": _count_outside(g, extent),
        }
    violations, kept = volumes_outside_extent(
        frames["dbt_volumes"], frames["dbt_buildings"], extent
    )
    res["dbt_volumes"]["outside_extent"] = violations
    res["dbt_volumes"]["outside_extent_kept_with_building"] = kept
    return res


def _ratio(out_n: int, in_n: int, denominator: str) -> dict:
    return {
        "in": in_n,
        "out": out_n,
        "ratio": (out_n / in_n) if in_n else None,
        "target": COMPLETENESS_TARGET,
        "denominator": denominator,
    }


def run(
    osm_gpkg: Path,
    dbt_gpkg: Path,
    boundary: Path,
    out_gpkg: Path,
    bbox,
    extent_geom=None,
    name: str = "pilot",
) -> dict:
    """``bbox`` is the extent's bounding box; ``extent_geom`` (default: the box) its shape."""
    extent = box(*bbox) if extent_geom is None else extent_geom
    shapely.prepare(extent)
    log_ = DropLog()
    osm = read_osm(osm_gpkg)
    layers, stats, osm_report = normalise_osm(osm, extent, log_)
    dbt = read_dbt(dbt_gpkg)
    dbt_layers, dbt_stats, dbt_extra = normalise_dbt(dbt, log_)
    layers.update(dbt_layers)
    stats.update(dbt_stats)
    layers["comune_boundary"], stats["comune_boundary"] = normalise_boundary(boundary, log_)
    write_layers(layers, out_gpkg)

    for lname, st in stats.items():
        st["output"] = len(layers[lname])
        if "underground" in layers[lname].columns:
            st["underground"] = int(layers[lname]["underground"].sum())
    checks = check_output(out_gpkg, extent)
    tags = osm["areas"]["tags"]
    n_bld_in = int(sum("building" in t for t in tags))
    n_bld_no = int(sum(t.get("building") == "no" for t in tags))
    comp = {
        "dbt_volumes": _ratio(
            stats["dbt_volumes"]["output"],
            len(dbt["un_vol"]),
            f"UN_VOL features in dbt_{name}.gpkg",
        ),
        "osm_buildings": _ratio(
            stats["osm_buildings"]["output"],
            n_bld_in,
            f"areas with a building=* tag in osm_{name}.gpkg",
        ),
    }
    comp["osm_buildings"]["excluded_building_no"] = n_bld_no
    class_counts = {}
    for layer in ("roads", "road_areas", "rail"):
        vc = layers[layer]["class"].value_counts().sort_index()
        class_counts[layer] = {str(k): int(v) for k, v in vc.items()}
    per_layer = {}
    for lname in sorted(stats):
        per_layer[lname] = {**stats[lname]}
        for k in ("crs", "invalid", "outside_extent", "outside_extent_kept_with_building"):
            if k in checks[lname]:
                per_layer[lname][k] = checks[lname][k]
    report = {
        "extent": {"name": name, "bbox_epsg32632": list(bbox)},
        f"canonical_dump_sha256_{name}_gpkg": canonical_dump_sha256(out_gpkg),
        "layers": per_layer,
        "completeness": comp,
        "assertions": {
            "crs_all_layers_epsg32632": all(c["crs"] == METRIC_CRS for c in checks.values()),
            "invalid_geometries_total": sum(c["invalid"] for c in checks.values()),
            "features_outside_extent_total": sum(c["outside_extent"] for c in checks.values()),
            "all_features_intersect_extent": all(c["outside_extent"] == 0 for c in checks.values()),
            "completeness_dbt_volumes_ge_99pct": comp["dbt_volumes"]["ratio"]
            >= COMPLETENESS_TARGET,
            "completeness_osm_buildings_ge_99pct": comp["osm_buildings"]["ratio"]
            >= COMPLETENESS_TARGET,
        },
        "osm": {**osm_report, "class_counts": class_counts},
        "dbt": dbt_extra,
    }
    return {"report": report, "log": log_}


# ----------------------------------------------------------------------------- reports


def transform_ops(src: str, dst: str = METRIC_CRS) -> dict:
    g = TransformerGroup(src, dst, always_xy=True)
    best = Transformer.from_crs(src, dst, always_xy=True)

    def acc(t):
        return None if t.accuracy < 0 else t.accuracy

    return {
        "source": CRS.from_user_input(src).name,
        "target": CRS.from_user_input(dst).name,
        "selected": best.description,
        "selected_accuracy_m": acc(best),
        "selected_definition": best.definition,
        "available": [{"name": t.description, "accuracy_m": acc(t)} for t in g.transformers],
        "unavailable": [{"name": t.name, "accuracy_m": acc(t)} for t in g.unavailable_operations],
    }


def _acc_text(v) -> str:
    return "not stated" if v is None else f"{v} m"


def write_transform_md(path: Path) -> None:
    lines = [
        "# Reprojection used by T-1.3",
        "",
        "Generated by `milano_iso.normalise`; do not edit by hand. Every transform uses",
        "`pyproj.Transformer.from_crs(src, dst, always_xy=True)` (x = easting/longitude first) on",
        "2D coordinates. Z values of DBT volumes are not transformed: `base_z_min_m` and",
        "`base_z_max_m` are read from the source Z of the base ring and stored as attributes;",
        "geometries are 2D. The vertical datum of DBT Z is NOT IN SPEC (see T-1.2",
        "`height_semantics.md`).",
        "",
        "pyproj reports accuracy -1 when an operation has no stated accuracy; shown as 'not stated'.",
    ]
    for src in (OSM_CRS, DBT_CRS):
        t = transform_ops(src)
        lines += [
            "",
            f"## {src} to {METRIC_CRS}",
            "",
            f"- Source CRS: {t['source']}; target CRS: {t['target']}.",
            f"- Operation used (pyproj default): {t['selected']}",
            f"- Stated accuracy: {_acc_text(t['selected_accuracy_m'])}.",
            f"- PROJ definition: `{t['selected_definition']}`",
            "- Operations considered by pyproj:",
        ]
        for op in t["available"]:
            lines.append(f"  - available: {op['name']} (accuracy {_acc_text(op['accuracy_m'])})")
        for op in t["unavailable"]:
            lines.append(
                f"  - unavailable (grid missing): {op['name']} "
                f"(accuracy {_acc_text(op['accuracy_m'])})"
            )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def _mark(ok: bool) -> str:
    return "PASS" if ok else "FAIL"


def write_validation_md(report: dict, path: Path) -> None:
    a, c = report["assertions"], report["completeness"]
    name = report["extent"]["name"]
    lines = [
        "# Validation report (T-1.3)",
        "",
        "Generated by `milano_iso.normalise`; do not edit by hand.",
        f"Extent: {name}, bbox (EPSG:32632) {report['extent']['bbox_epsg32632']}.",
        f"Canonical dump sha256 of `processed/{name}.gpkg`: `{report[f'canonical_dump_sha256_{name}_gpkg']}`",
        "",
        "## Assertions",
        "",
        f"- CRS EPSG:32632 on every layer: {_mark(a['crs_all_layers_epsg32632'])}",
        f"- Invalid geometries: {a['invalid_geometries_total']} ({_mark(a['invalid_geometries_total'] == 0)})",
        f"- Features outside the extent: {a['features_outside_extent_total']} ({_mark(a['all_features_intersect_extent'])})",
        "  (a DBT volume outside the extent is allowed only when its building intersects it;",
        f"  allowed volumes: {report['layers']['dbt_volumes'].get('outside_extent_kept_with_building', 0)})",
        "",
        "## Completeness (target >= 99%)",
        "",
        "| Source | In | Out | Ratio | Result | In = |",
        "|---|---|---|---|---|---|",
    ]
    for name, v in c.items():
        ok = v["ratio"] is not None and v["ratio"] >= v["target"]
        lines.append(
            f"| {name} | {v['in']} | {v['out']} | {v['ratio']:.4%} | {_mark(ok)} "
            f"| {v['denominator']} |"
        )
    lines += [
        "",
        "## Per layer",
        "",
        "| Layer | In | Out | Repaired | Dropped (reason: n) | Duplicates | Same geometry, other key (flagged) | Underground | Invalid | Outside extent | CRS |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for name, s in report["layers"].items():
        dropped = ", ".join(f"{k}: {v}" for k, v in s["dropped"].items()) or "0"
        lines.append(
            f"| {name} | {s['input']} | {s['output']} | {s['repaired']} | {dropped} "
            f"| {s['duplicates']} | {s.get('same_geometry_different_key', 0)} "
            f"| {s.get('underground', 'n/a')} | {s['invalid']} "
            f"| {s['outside_extent']} | {s['crs']} |"
        )
    osm = report["osm"]
    lines += ["", "## OSM objects assigned to no layer, by source layer and top tag key", ""]
    lines += [f"Source objects: {osm['source_objects']}", ""]
    for title, key in (
        ("No layer at all", "unassigned_to_any_layer_by_top_tag_key"),
        (
            "No thematic layer (named_features not counted)",
            "unassigned_to_any_thematic_layer_by_top_tag_key",
        ),
    ):
        lines += [f"### {title}", "", "| Source layer : top tag key | Objects |", "|---|---|"]
        rows = sorted(osm[key].items(), key=lambda kv: (-kv[1], kv[0]))
        lines += [f"| {k} | {v} |" for k, v in rows]
        lines.append("")
    lines += ["## Classes in output", ""]
    for layer, counts in osm["class_counts"].items():
        lines.append(f"- {layer}: {counts}")
    lines += ["", "## DBT volumes", "", f"- {report['dbt']}"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--extent", choices=list(extent_mod.EXTENTS), required=True)
    ap.add_argument("--artifacts", type=Path, default=None)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ext = args.extent
    artifacts = args.artifacts or extent_mod.artifact_dir(ext, ARTIFACT_DIR)

    boundary = config.RAW_DIR / "comune_boundary" / fetch.BOUNDARY_FILE
    inputs = {
        "osm": extent_mod.interim_osm(ext),
        "dbt": extent_mod.interim_dbt(ext),
        "boundary": boundary,
    }
    for k, p in inputs.items():
        if not p.exists():
            sys.exit(f"missing {k} input {p}; run the earlier data steps first")
    out = extent_mod.processed_gpkg(ext)
    res = run(
        inputs["osm"],
        inputs["dbt"],
        boundary,
        out,
        extent_mod.bbox(ext),
        extent_geom=extent_mod.polygon(ext),
        name=ext,
    )
    report, droplog = res["report"], res["log"]

    log_path = extent_mod.drop_log(ext)
    droplog.write(log_path)
    artifacts.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(log_path, artifacts / "drop_log.csv")
    (artifacts / "validation.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    write_validation_md(report, artifacts / "validation.md")
    write_transform_md(artifacts / "transform.md")
    layer_stats = report["layers"].values()
    report_counts(
        **{"in": sum(s["input"] for s in layer_stats), "out": sum(s["output"] for s in layer_stats)}
    )
    print(f"canonical dump sha256 of {out.name}: {report[f'canonical_dump_sha256_{ext}_gpkg']}")
    a = report["assertions"]
    print(json.dumps(a, sort_keys=True))
    failed = [k for k, v in a.items() if v is False or (k.endswith("_total") and v)]
    if failed:
        print(f"validation FAILED: {failed}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
