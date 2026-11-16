"""Extract DBT 2020 building footprints and volume units for the pilot extent.

Reads the Shapefiles straight from the ZIP (GDAL /vsizip/), keeps every feature that
intersects the extent whole (volumes: all volumes of every building that intersects it), in the source CRS (EPSG:7791), sorted by a stable source key,
and writes data/interim/dbt_pilot.gpkg. Also writes the T-1.2 report artefacts
(schema.md, summary.json). Run: python -m milano_iso.dbt_extract --extent pilot
"""

import argparse
import json
import re
import statistics
import sys
import warnings
from collections import Counter
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely
from pyproj import CRS, Transformer
from pyproj.transformer import TransformerGroup
from shapely.geometry import Polygon, box

from milano_iso import config
from milano_iso.dbt_fetch import target_path
from milano_iso.geo import canonical_dump_sha256

ZIP_PREFIX = "DBT 2020 - SHAPE/"
SOURCE_CRS = "EPSG:7791"
METRIC_CRS = "EPSG:32632"
DENSIFY_STEP_M = 10.0
ARTIFACT_DIR = config.REPO_ROOT / "reports" / "artifacts" / "T-1.2"

# gpkg layer name -> (shapefile stem in the ZIP, stable source key column)
# EDIFC is stored in the ZIP as three layers (one per spatial component of CR_EDF).
LAYERS = {
    "edifc": ("EDIFC_CR_EDF_IS", "CLASSREF"),
    "edifc_me": ("EDIFC_CR_EDF_ME", "CLASSREF"),
    "edifc_me_sr": ("EDIFC_CR_EDF_ME_SR", "SUBREGID"),
    "un_vol": ("UN_VOL", "CLASSID"),
    # EDI_MIN ("edificio minore", T-1.3): same three-way split; only IS and ME are extracted.
    "edi_min": ("EDI_MIN_CR_EDF_IS", "CLASSREF"),
    "edi_min_me": ("EDI_MIN_CR_EDF_ME", "CLASSREF"),
}
# Non-spatial attribute tables (.dbf only) -> (stem, building key column). Kept for the
# buildings that appear in the extracted layers or are referenced by an extracted UN_VOL.
# EDIFC_EDIFC_USO is multi-valued (spec: EDIFC_USO [1..*]), so its key is not unique.
TABLES = {
    "edifc_attr": ("EDIFC", "CLASSID"),
    "edifc_uso": ("EDIFC_EDIFC_USO", "CLASSREF"),
    "edi_min_attr": ("EDI_MIN", "CLASSID"),
}
STATS_LAYERS = {
    "EDIFC_CR_EDF_IS": "edifc",
    "EDIFC_CR_EDF_ME": "edifc_me",
    "EDIFC_CR_EDF_ME_SR": "edifc_me_sr",
    "UN_VOL": "un_vol",
}


def vsizip(zip_path: Path, stem: str) -> str:
    return f"/vsizip/{Path(zip_path).as_posix()}/{ZIP_PREFIX}{stem}.shp"


def extent_polygon(bbox, src_crs=METRIC_CRS, dst_crs=SOURCE_CRS, step=DENSIFY_STEP_M) -> Polygon:
    """Rectangle `bbox` (in src_crs) with edges densified to `step`, transformed to dst_crs."""
    dense = shapely.segmentize(box(*bbox), step)
    t = Transformer.from_crs(src_crs, dst_crs, always_xy=True)
    return shapely.transform(dense, lambda c: np.column_stack(t.transform(c[:, 0], c[:, 1])))


def natural_key(value: str) -> tuple:
    """Sort key for ids like 'UN_VOL_12': (text part, integer part)."""
    m = re.fullmatch(r"(.*?)(\d+)", value)
    if not m:
        return (value, -1)
    return (m.group(1), int(m.group(2)))


def sort_by_key(gdf: gpd.GeoDataFrame, key: str) -> gpd.GeoDataFrame:
    if gdf[key].isna().any() or gdf[key].duplicated().any():
        raise ValueError(f"sort key {key} is not unique and complete")
    order = sorted(range(len(gdf)), key=lambda i: natural_key(gdf[key].iloc[i]))
    return gdf.iloc[order].reset_index(drop=True)


def read_intersecting(path: str, poly: Polygon) -> gpd.GeoDataFrame:
    """Features intersecting `poly` (envelope prefilter, then exact test), kept whole."""
    gdf = pyogrio.read_dataframe(path, bbox=tuple(poly.bounds))
    keep = gdf.geometry.intersects(poly)
    return gdf[keep.to_numpy()].reset_index(drop=True)


def column_stats(df: pd.DataFrame) -> list[dict]:
    out = []
    for col in df.columns:
        if col == "geometry":
            continue
        s = df[col]
        d = {"field": col, "dtype": str(s.dtype), "nulls": int(s.isna().sum())}
        if pd.api.types.is_numeric_dtype(s):
            v = s.dropna()
            if len(v):
                d.update(min=float(v.min()), median=float(v.median()), max=float(v.max()))
        else:
            v = s.dropna()
            d["empty_strings"] = int((v.astype(str).str.strip() == "").sum())
            d["distinct"] = int(v.nunique())
        out.append(d)
    return out


def join_stats(un_vol: pd.DataFrame, buildings: pd.DataFrame, building_key="CLASSREF") -> dict:
    """UN_VOL.CEDIUV -> building key. Match rate and volumes-per-building distribution."""
    ids = set(buildings[building_key])
    matched = un_vol["CEDIUV"].isin(ids)
    per_b = un_vol.loc[matched, "CEDIUV"].value_counts()
    dist = Counter(per_b.tolist())
    return {
        "un_vol": len(un_vol),
        "un_vol_matched": int(matched.sum()),
        "match_rate": float(matched.mean()) if len(un_vol) else None,
        "buildings": len(ids),
        "buildings_with_volume": int(per_b.size),
        "buildings_without_volume": len(ids) - int(per_b.size),
        "volumes_per_building_min": int(per_b.min()) if per_b.size else None,
        "volumes_per_building_median": float(per_b.median()) if per_b.size else None,
        "volumes_per_building_max": int(per_b.max()) if per_b.size else None,
        "volumes_per_building_histogram": {str(k): dist[k] for k in sorted(dist)},
    }


def base_z(geom) -> float:
    """Minimum Z over the exterior ring of a (Multi)Polygon Z."""
    polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    return min(c[2] for p in polys for c in p.exterior.coords)


def height_vs_extrusion(un_vol: gpd.GeoDataFrame) -> dict:
    """Empirical check of UN_VOL_AV against UN_VOL_QE minus the base elevation (Z of the
    base ring), per UN_VOL_POR code."""
    out = {}
    z = un_vol.geometry.map(base_z)
    diff = un_vol["UN_VOL_QE"] - z - un_vol["UN_VOL_AV"]
    for por in sorted(un_vol["UN_VOL_POR"].dropna().unique()):
        d = diff[un_vol["UN_VOL_POR"] == por]
        out[por] = {
            "n": int(d.size),
            "qe_minus_basez_minus_av_median": float(d.median()),
            "share_abs_le_0.05": float((d.abs() <= 0.05).mean()),
            "share_abs_le_0.5": float((d.abs() <= 0.5).mean()),
            "min": float(d.min()),
            "max": float(d.max()),
        }
    return out


def transform_report(bbox) -> dict:
    g = TransformerGroup(SOURCE_CRS, METRIC_CRS, always_xy=True)
    ops = [
        {"name": t.name, "accuracy_m": None if t.accuracy < 0 else t.accuracy, "available": True}
        for t in g.transformers
    ] + [
        {"name": t.name, "accuracy_m": None if t.accuracy < 0 else t.accuracy, "available": False}
        for t in g.unavailable_operations
    ]
    best = Transformer.from_crs(SOURCE_CRS, METRIC_CRS, always_xy=True)
    cx, cy = config.ORIGIN_E, config.ORIGIN_N
    # Numbers for the pilot centre, read as if they were EPSG:7791 coordinates.
    ox, oy = best.transform(cx, cy)
    return {
        "operations": ops,
        "selected_by_default": best.description,
        "selected_accuracy_m": None if best.accuracy < 0 else best.accuracy,
        "source_crs": CRS.from_user_input(SOURCE_CRS).name,
        "target_crs": CRS.from_user_input(METRIC_CRS).name,
        "shift_at_pilot_centre_m": {"dE": ox - cx, "dN": oy - cy},
    }


def layer_inventory(zip_path: Path) -> list[dict]:
    import zipfile

    with zipfile.ZipFile(zip_path) as z:
        stems = sorted(
            Path(i.filename).stem
            for i in z.infolist()
            if i.filename.startswith(ZIP_PREFIX) and i.filename.lower().endswith(".shp")
        )
    rows = []
    for stem in stems:
        with warnings.catch_warnings():
            # GDAL reports 'Measured 3D X' (M values); pyogrio converts to 'X Z'.
            warnings.simplefilter("ignore", UserWarning)
            info = pyogrio.read_info(vsizip(zip_path, stem))
        rows.append(
            {
                "layer": stem,
                "geometry_type": info["geometry_type"],
                "crs": info["crs"],
                "features": int(info["features"]),
            }
        )
    return rows


def write_schema_md(inventory, full_stats, path: Path) -> None:
    lines = [
        "# DBT 2020 schema (T-1.2)",
        "",
        "Source: `DBT_2020.zip` (manifest `pipeline/manifests/dbt2020.json`). One Shapefile per",
        f"layer under `{ZIP_PREFIX}`. Generated by `milano_iso.dbt_extract`;",
        "do not edit by hand. Geometry types are as reported by pyogrio: GDAL 'Measured 3D X'",
        "layers (with M values) are shown as 'X Z'.",
        "",
        f"## All layers ({len(inventory)} Shapefiles)",
        "",
        "| Layer | Geometry type | CRS | Features |",
        "|---|---|---|---|",
    ]
    for r in inventory:
        lines.append(f"| {r['layer']} | {r['geometry_type']} | {r['crs']} | {r['features']} |")
    lines += [
        "",
        "## Field statistics (whole comune, all features)",
        "",
        "Note: the ZIP has no single `EDIFC` Shapefile. The building class `EDIFC` is split over",
        "`EDIFC_CR_EDF_IS` (ground footprint), `EDIFC_CR_EDF_ME` (maximum extent) and",
        "`EDIFC_CR_EDF_ME_SR` (sub-areas of the maximum extent). All three are listed.",
    ]
    for stem, (n, stats) in full_stats.items():
        lines += ["", f"### {stem} ({n} features)", ""]
        lines += ["| Field | Type | Nulls | Empty strings | Distinct | Min | Median | Max |"]
        lines += ["|---|---|---|---|---|---|---|---|"]
        for s in stats:
            lines.append(
                f"| {s['field']} | {s['dtype']} | {s['nulls']} | {s.get('empty_strings', '')} "
                f"| {s.get('distinct', '')} | {s.get('min', '')} | {s.get('median', '')} "
                f"| {s.get('max', '')} |"
            )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def code_counts(df: pd.DataFrame, col: str) -> dict:
    return {str(k): int(v) for k, v in sorted(df[col].value_counts(dropna=False).items())}


def vsizip_table(zip_path: Path, stem: str) -> str:
    return f"/vsizip/{Path(zip_path).as_posix()}/{ZIP_PREFIX}{stem}.dbf"


def read_building_table(path: str, key: str, keep: set) -> pd.DataFrame:
    """Rows of an attribute table whose building key is in `keep`, sorted by (key, other cols)."""
    df = pyogrio.read_dataframe(path, read_geometry=False)
    df = df[df[key].isin(keep)]
    cols = [key] + [c for c in df.columns if c != key]
    order = sorted(
        range(len(df)),
        key=lambda i: (natural_key(df[key].iloc[i]), *(str(df[c].iloc[i]) for c in cols[1:])),
    )
    return df.iloc[order][cols].reset_index(drop=True)


def selected_building_ids(layers: dict, touching_volumes: pd.DataFrame) -> set:
    """Building ids (EDIFC_<n> / EDI_MIN_<n>) of every building that intersects the extent:
    the CLASSREF of the extracted footprint layers plus the CEDIUV of volumes that touch it."""
    ids = set(touching_volumes["CEDIUV"])
    for lname in ("edifc", "edifc_me", "edi_min", "edi_min_me"):
        ids |= set(layers[lname]["CLASSREF"])
    return ids


def read_building_volumes(path: str, building_ids: set) -> gpd.GeoDataFrame:
    """All UN_VOL features whose CEDIUV is in `building_ids`, wherever they lie."""
    gdf = pyogrio.read_dataframe(path)
    keep = gdf["CEDIUV"].isin(building_ids)
    return gdf[keep.to_numpy()].reset_index(drop=True)


def extract_pilot(zip_path: Path, out_gpkg: Path) -> dict:
    poly = extent_polygon(config.PILOT_AOI_BBOX)
    out_gpkg.parent.mkdir(parents=True, exist_ok=True)
    if out_gpkg.exists():
        out_gpkg.unlink()
    layers = {}
    for name, (stem, key) in LAYERS.items():
        if name == "un_vol":
            continue  # selected by building below
        gdf = sort_by_key(read_intersecting(vsizip(zip_path, stem), poly), key)
        if str(gdf.crs) != SOURCE_CRS and gdf.crs.to_string() != SOURCE_CRS:
            raise SystemExit(f"{stem}: unexpected CRS {gdf.crs}")
        pyogrio.write_dataframe(gdf, out_gpkg, layer=name, driver="GPKG")
        layers[name] = gdf
    # Volumes are selected per building (ADR-0013: keep features whole): every EDIFC / EDI_MIN
    # building that intersects the extent, by footprint (IS or ME) or by one of its volumes,
    # contributes ALL its volumes, wherever they lie.
    stem, key = LAYERS["un_vol"]
    touching = read_intersecting(vsizip(zip_path, stem), poly)
    layers["un_vol"] = sort_by_key(
        read_building_volumes(vsizip(zip_path, stem), selected_building_ids(layers, touching)),
        key,
    )
    pyogrio.write_dataframe(layers["un_vol"], out_gpkg, layer="un_vol", driver="GPKG")
    # Attribute tables for every building the extract knows about (footprint layers plus the
    # CEDIUV of every extracted volume, so a volume whose footprint is outside is still typed).
    keep = set(layers["un_vol"]["CEDIUV"])
    for lname in ("edifc", "edifc_me", "edi_min", "edi_min_me"):
        keep |= set(layers[lname]["CLASSREF"])
    for name, (stem, key) in TABLES.items():
        table = read_building_table(vsizip_table(zip_path, stem), key, keep)
        pyogrio.write_dataframe(table, out_gpkg, layer=name, driver="GPKG")
        layers[name] = table
    return layers


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--extent", choices=["pilot"], required=True)
    ap.parse_args(argv)

    zip_path = target_path("dbt2020")
    if not zip_path.exists():
        sys.exit(f"missing {zip_path}; run milano_iso.dbt_fetch first")
    out_gpkg = config.INTERIM_DIR / "dbt_pilot.gpkg"
    layers = extract_pilot(zip_path, out_gpkg)
    digest = canonical_dump_sha256(out_gpkg)
    print(f"canonical dump sha256 of {out_gpkg.name}: {digest}")

    # Whole-comune attribute statistics (no geometry) and layer inventory.
    full = {}
    full_attrs = {}
    for stem in STATS_LAYERS:
        df = pyogrio.read_dataframe(vsizip(zip_path, stem), read_geometry=False)
        full_attrs[stem] = df
        full[stem] = (len(df), column_stats(df))
    inventory = layer_inventory(zip_path)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    tr = transform_report(config.PILOT_AOI_BBOX)
    write_schema_md(inventory, full, ARTIFACT_DIR / "schema.md")

    uv = layers["un_vol"]
    e_is, e_me = layers["edifc"], layers["edifc_me"]
    all_me_ids = set(full_attrs["EDIFC_CR_EDF_ME"]["CLASSREF"])
    min_ids = set(
        pyogrio.read_dataframe(vsizip(zip_path, "EDI_MIN_CR_EDF_ME"), read_geometry=False)[
            "CLASSREF"
        ]
    )
    cw_cediuv = full_attrs["UN_VOL"]["CEDIUV"]
    unmatched = uv.loc[~uv["CEDIUV"].isin(set(e_me["CLASSREF"])), "CEDIUV"]
    av = uv["UN_VOL_AV"]
    summary = {
        "extent": {"name": "pilot", "bbox_epsg32632": list(config.PILOT_AOI_BBOX)},
        "canonical_dump_sha256_dbt_pilot_gpkg": digest,
        "sort_keys": {k: v[1] for k, v in LAYERS.items()},
        "counts": {k: len(v) for k, v in layers.items()},
        "join_un_vol_to_edifc_me": join_stats(uv, e_me),
        "join_un_vol_to_edifc_is": join_stats(uv, e_is),
        "unmatched_un_vol_in_pilot": {
            "count": len(unmatched),
            "cediuv_prefixes": dict(
                sorted(Counter(re.sub(r"\d+$", "", s) for s in unmatched).items())
            ),
            "present_in_citywide_edifc_me": int(unmatched.isin(all_me_ids).sum()),
            "present_in_citywide_edi_min_cr_edf_me": int(unmatched.isin(min_ids).sum()),
        },
        "un_vol_por_counts": code_counts(uv, "UN_VOL_POR"),
        "un_vol_ex_counts": code_counts(uv, "UN_VOL_EX"),
        "un_vol_por_counts_citywide": code_counts(full_attrs["UN_VOL"], "UN_VOL_POR"),
        "un_vol_ex_counts_citywide": code_counts(full_attrs["UN_VOL"], "UN_VOL_EX"),
        "un_vol_av_citywide_negative_values": sorted(
            float(v)
            for v in full_attrs["UN_VOL"]["UN_VOL_AV"][full_attrs["UN_VOL"]["UN_VOL_AV"] < 0]
        ),
        "edifc_me_sr_por_counts": code_counts(layers["edifc_me_sr"], "CR_EDF_POR"),
        "un_vol_av": {
            "min": float(av.min()),
            "median": float(av.median()),
            "max": float(av.max()),
            "zero_count": int((av == 0).sum()),
            "negative_count": int((av < 0).sum()),
            "null_count": int(av.isna().sum()),
        },
        "un_vol_av_by_por": {
            p: {
                "n": int((uv["UN_VOL_POR"] == p).sum()),
                "median": float(av[uv["UN_VOL_POR"] == p].median()),
                "zero_count": int(((uv["UN_VOL_POR"] == p) & (av == 0)).sum()),
                "negative_count": int(((uv["UN_VOL_POR"] == p) & (av < 0)).sum()),
            }
            for p in sorted(uv["UN_VOL_POR"].dropna().unique())
        },
        "un_vol_av_citywide_zero_or_negative": {
            "zero_count": int((full_attrs["UN_VOL"]["UN_VOL_AV"] == 0).sum()),
            "negative_count": int((full_attrs["UN_VOL"]["UN_VOL_AV"] < 0).sum()),
            "por_of_zero_or_negative": code_counts(
                full_attrs["UN_VOL"][full_attrs["UN_VOL"]["UN_VOL_AV"] <= 0], "UN_VOL_POR"
            ),
            "por_of_zero_or_negative_note": "records with UN_VOL_AV <= 0",
        },
        "un_vol_qe": {
            "min": float(uv["UN_VOL_QE"].min()),
            "median": float(statistics.median(uv["UN_VOL_QE"])),
            "max": float(uv["UN_VOL_QE"].max()),
        },
        "av_vs_qe_minus_base_z": height_vs_extrusion(uv),
        "citywide_cediuv_match_rate": {
            "to_edifc_me": float(cw_cediuv.isin(all_me_ids).mean()),
            "to_edi_min_cr_edf_me": float(cw_cediuv.isin(min_ids).mean()),
            "to_either": float(cw_cediuv.isin(all_me_ids | min_ids).mean()),
        },
        "crs_transform": tr,
    }
    (ARTIFACT_DIR / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    print(
        json.dumps(summary["counts"]),
        "match_rate",
        summary["join_un_vol_to_edifc_me"]["match_rate"],
    )


if __name__ == "__main__":
    main()
