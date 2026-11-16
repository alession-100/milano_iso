"""Building heights, OSM/DBT merge and the render-ready building layers (T-1.4).

Reads ``processed/pilot.gpkg`` (written by ``milano_iso.normalise``) and appends two layers:

- ``render_volumes``: one row per extrudable prism (DBT volumes, plus OSM footprints of
  buildings that DBT does not cover), with ``bottom_m``, ``top_m``, ``height_m`` and
  ``height_source``.
- ``buildings``: one row per building (DBT building or unmatched OSM building).

Rules: ADR-0014 (DBT volumes first, OSM for attributes and gaps), ADR-0015 (height rules)
and ADR-0016 (default height, non-rendered roofs and construction sites).
No height or default constant is typed here: every height is a DBT value, an OSM tag, or a
median computed from the data. The only constants are the 3.0 m per level of
``DATA_SOURCES.md`` and the 0.3048 m per foot used for unit conversion.

Run: ``python -m milano_iso.heights --extent pilot``
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely
import yaml
from shapely import STRtree

from milano_iso import config
from milano_iso.geo import canonical_dump_sha256

ARTIFACT_DIR = config.REPO_ROOT / "reports" / "artifacts" / "T-1.4"
METRIC_CRS = "EPSG:32632"
LANDMARKS_FILE = config.REPO_ROOT / "tests" / "landmarks.yaml"
OSM_TYPE_CODE = {"way": "w", "relation": "r", "node": "n"}

# Provisional (task card T-1.4, rule 2): coverage at or above this value means "matched".
MATCH_THRESHOLD = 0.5
BAND_LOW, BAND_HIGH = 0.3, 0.7  # reported, to let the orchestrator revisit the threshold
METRES_PER_LEVEL = 3.0  # DATA_SOURCES.md, "Height fallback chain" step 3
METRES_PER_FOOT = 0.3048  # unit conversion, not a modelling constant
DEFAULT_CLASS = "EDI_MIN"  # ADR-0016: default height = median of minor DBT buildings
NOT_RENDERED_REASONS = {"roof": "no_walls_roof", "construction": "under_construction"}
OUTLIER_HIGH_M, OUTLIER_LOW_M = 250.0, 2.0  # VERIFICATION.md section 3
BOTTOM_TOLERANCE_M = 0.01  # card rule 1: report bottom_m < -0.01
GROUND_POR = "01"
HEIGHT_SOURCES = ("dbt", "osm_height", "osm_levels", "default")

_NUM = r"(\d+(?:\.\d+)?)"
_PLAIN = re.compile(rf"^{_NUM}$")
_METRES = re.compile(rf"^{_NUM}\s*m$")
_FEET_WORD = re.compile(rf"^{_NUM}\s*ft$")
_FEET_MARK = re.compile(rf"^{_NUM}\s*'$")


# ----------------------------------------------------------------------------- parsing


def _missing(raw) -> bool:
    """None, NaN or pd.NA (how absent tags arrive from the gpkg)."""
    return raw is None or bool(pd.isna(raw))


def parse_height(raw) -> tuple[float | None, str]:
    """Parse an OSM ``height`` / ``min_height`` value to metres.

    Accepts a plain number, ``N m``, ``Nm``, ``N ft`` and ``N'`` (feet, converted).
    Everything else is rejected. Returns ``(metres or None, reason)``; ``reason`` is
    ``"plain"``, ``"metres"``, ``"feet"`` for accepted values and a short code for rejected
    ones (``"empty"``, ``"unrecognised_format"``, ``"non_positive"``).
    A parsed value of zero is returned as 0.0 (used for ``min_height``); callers that need a
    positive value check it themselves.
    """
    if _missing(raw):
        return None, "empty"
    text = str(raw).strip()
    if not text:
        return None, "empty"
    for pattern, kind, factor in (
        (_PLAIN, "plain", 1.0),
        (_METRES, "metres", 1.0),
        (_FEET_WORD, "feet", METRES_PER_FOOT),
        (_FEET_MARK, "feet", METRES_PER_FOOT),
    ):
        m = pattern.match(text)
        if m:
            return float(m.group(1)) * factor, kind
    return None, "unrecognised_format"


def parse_levels(raw) -> tuple[float | None, str]:
    """Parse ``building:levels`` / ``building:min_level`` (a plain non-negative number)."""
    if _missing(raw):
        return None, "empty"
    text = str(raw).strip()
    if not text:
        return None, "empty"
    if _PLAIN.match(text):
        return float(text), "plain"
    return None, "unrecognised_format"


def osm_bottom_m(min_height_raw, min_level_raw) -> tuple[float, list[tuple[str, str, str, str]]]:
    """Base of an OSM prism: ``min_height``, else ``min_level`` x 3.0, else 0.

    Returns ``(bottom_m, log rows)`` where each log row is (field, raw, status, reason).
    """
    rows = []
    h, why = parse_height(min_height_raw)
    if not _missing(min_height_raw):
        rows.append(
            ("min_height", str(min_height_raw), "accepted" if h is not None else "rejected", why)
        )
    if h is not None:
        return h, rows
    lv, why = parse_levels(min_level_raw)
    if not _missing(min_level_raw):
        rows.append(
            ("min_level", str(min_level_raw), "accepted" if lv is not None else "rejected", why)
        )
    if lv is not None:
        return lv * METRES_PER_LEVEL, rows
    return 0.0, rows


def osm_top_m(height_raw, levels_raw, default_m: float | None):
    """First applicable rule of the fallback chain (card rule 4, ADR-0015).

    Returns ``(top_m, height_source, log rows)``. ``top_m`` is None only when no rule applies
    and ``default_m`` is None. Overture (step 4 of DATA_SOURCES.md) is skipped (ADR-0015).
    """
    rows = []
    h, why = parse_height(height_raw)
    if not _missing(height_raw):
        ok = h is not None and h > 0
        rows.append(
            (
                "height",
                str(height_raw),
                "accepted" if ok else "rejected",
                why if h is None or h > 0 else "non_positive",
            )
        )
        if ok:
            return h, "osm_height", rows
    lv, why = parse_levels(levels_raw)
    if not _missing(levels_raw):
        ok = lv is not None and lv > 0
        rows.append(
            (
                "levels",
                str(levels_raw),
                "accepted" if ok else "rejected",
                why if lv is None or lv > 0 else "non_positive",
            )
        )
        if ok:
            return lv * METRES_PER_LEVEL, "osm_levels", rows
    return default_m, "default", rows


# ----------------------------------------------------------------------------- DBT heights


NEIGHBOUR_RADII_M = (50.0, 100.0)
NEIGHBOUR_MIN_VOLUMES = 5


def neighbour_ground_z(footprint, pool_geoms, pool_z, building_ref: str) -> tuple[float, int]:
    """Median base Z of the POR 01 volumes near ``footprint`` (ADR-0015 as amended by T-1.7).

    Looks within 50 m, then 100 m, for at least 5 volumes; fails loudly otherwise.
    Returns (median, number of volumes used).
    """
    tree = STRtree(pool_geoms)
    for radius in NEIGHBOUR_RADII_M:
        idx = np.sort(tree.query(footprint, predicate="dwithin", distance=radius))
        if len(idx) >= NEIGHBOUR_MIN_VOLUMES:
            return float(np.median(pool_z[idx])), len(idx)
    raise ValueError(
        f"building {building_ref} has no POR 01 volume and fewer than {NEIGHBOUR_MIN_VOLUMES} "
        f"POR 01 volumes of other buildings within {NEIGHBOUR_RADII_M[-1]:.0f} m"
    )


def no_negative_zero(df: pd.DataFrame) -> pd.DataFrame:
    """Return ``df`` with -0.0 replaced by 0.0 in every float column (x + 0.0 does it)."""
    out = df.copy()
    for c in out.columns:
        if pd.api.types.is_float_dtype(out[c]):
            out[c] = out[c] + 0.0
    return out


def dbt_volume_heights(vols: pd.DataFrame) -> pd.DataFrame:
    """Add ``ground_z_m``, ``ground_flag``, ``ground_neighbours``, ``bottom_m``, ``top_m``.

    Needs columns ``building_ref``, ``por``, ``av_m``, ``qe_m``, ``base_z_min_m``, ``geometry``.
    ``ground_z`` of a building is the minimum ``base_z_min_m`` of its POR 01 volumes. A building
    without any (raised-only) takes the median ``base_z_min_m`` of the POR 01 volumes of other
    buildings within 50 m of its footprint (100 m if fewer than 5; fails if still fewer than 5),
    flagged ``neighbour_median`` with the number of volumes in ``ground_neighbours``. Then
    ``bottom = (qe - av) - ground_z`` and ``top = qe - ground_z``. No clamping.
    """
    out = vols.copy()
    por01 = out[out["por"] == GROUND_POR]
    ground = por01.groupby("building_ref")["base_z_min_m"].min()
    z = out["building_ref"].map(ground)
    flag = z.isna()
    n_nb = pd.Series(np.nan, index=out.index)
    if flag.any():
        pool_geoms = por01["geometry"].to_numpy()
        pool_z = por01["base_z_min_m"].to_numpy(dtype=float)
        for ref in sorted(out.loc[flag, "building_ref"].unique()):
            rows = (out["building_ref"] == ref).to_numpy()
            fp = shapely.union_all(out.loc[rows, "geometry"].to_numpy())
            val, n = neighbour_ground_z(fp, pool_geoms, pool_z, ref)
            z[rows] = val
            n_nb[rows] = n
    out["ground_z_m"] = z
    out["ground_flag"] = np.where(flag, "neighbour_median", None)
    out["ground_neighbours"] = n_nb.astype("Int64")
    out["bottom_m"] = (out["qe_m"] - out["av_m"]) - z
    out["top_m"] = out["qe_m"] - z
    return no_negative_zero(out)


# ----------------------------------------------------------------------------- matching


def coverage_ratios(osm_geoms, dbt_union) -> np.ndarray:
    """area(OSM footprint intersected with the union of all DBT volumes) / area(footprint)."""
    g = np.asarray(osm_geoms, dtype=object)
    cov = shapely.area(shapely.intersection(g, dbt_union)) / shapely.area(g)
    return np.clip(cov, 0.0, 1.0)


def is_matched(cov, threshold: float = MATCH_THRESHOLD) -> np.ndarray:
    return np.asarray(cov) >= threshold


def transfer_attributes(bld_geoms: pd.Series, osm: gpd.GeoDataFrame) -> pd.DataFrame:
    """For each DBT building, the matched OSM building with the largest overlap area.

    ``bld_geoms``: Series indexed by building key, values are the building geometry (union of
    its volumes). ``osm``: matched OSM buildings with ``osm_type``, ``osm_id``, ``building``,
    ``name`` and geometry. Ties (areas equal to 1e-6 m2) go to the lower ``osm_id``, then the
    lower ``osm_type``. Returns a frame indexed by building key with ``osm_type``, ``osm_id``,
    ``name``, ``building_type``, ``overlap_m2``; buildings with no overlap are absent.
    """
    osm = osm.reset_index(drop=True)
    tree = STRtree(osm.geometry.to_numpy())
    osm_geoms = osm.geometry.to_numpy()
    rows = {}
    for key, geom in bld_geoms.items():
        best = None
        for j in tree.query(geom, predicate="intersects"):
            area = round(float(shapely.area(shapely.intersection(geom, osm_geoms[j]))), 6)
            if area <= 0:
                continue
            cand = (-area, int(osm.at[j, "osm_id"]), str(osm.at[j, "osm_type"]), int(j))
            if best is None or cand < best:
                best = cand
        if best is not None:
            j = best[3]
            rows[key] = {
                "osm_type": osm.at[j, "osm_type"],
                "osm_id": int(osm.at[j, "osm_id"]),
                "name": osm.at[j, "name"],
                "building_type": osm.at[j, "building"],
                "overlap_m2": -best[0],
            }
    cols = ["osm_type", "osm_id", "name", "building_type", "overlap_m2"]
    return pd.DataFrame.from_dict(rows, orient="index", columns=cols)


def derive_default(dbt_blds: pd.DataFrame) -> dict:
    """Default height (ADR-0016): median ``height_m`` of DBT buildings of class ``EDI_MIN``.

    ``dbt_blds``: DBT buildings with ``building_class`` and ``height_m``. Raises ``ValueError``
    when there is no such building (no silent fallback). Returns ``{"value", "n", "method"}``.
    """
    if "building_class" not in dbt_blds.columns:
        raise ValueError("cannot derive the default height: no building_class column")
    sub = dbt_blds.loc[dbt_blds["building_class"] == DEFAULT_CLASS, "height_m"].dropna()
    if len(sub) == 0:
        raise ValueError(
            f"cannot derive the default height: no DBT buildings of class {DEFAULT_CLASS} "
            "in the processed extent"
        )
    return {
        "value": float(sub.median()),
        "n": len(sub),
        "method": "median_edi_min_dbt_buildings",
    }


def render_status(building_type, src: str) -> tuple[bool, str | None]:
    """ADR-0016: unmatched roofs and construction sites are kept but not rendered."""
    reason = NOT_RENDERED_REASONS.get(building_type)
    if reason is None:
        return True, None
    return False, reason


# ----------------------------------------------------------------------------- build


def assign_landmarks(buildings: pd.DataFrame, footprints: dict) -> tuple[dict, list]:
    """Landmark-first assignment of ``landmark_id`` (ADR-0017 point 1).

    ``buildings``: rendered candidate buildings with ``building_key`` and ``geometry``.
    ``footprints``: {landmark id: OSM footprint geometry}. For each landmark the building with
    the largest overlap area is primary; any other building with more than 50% of its own area
    inside the footprint is secondary. Ties on the overlap (to 1e-6 m2) go to the lower
    ``building_key``. A building keeps one id: a primary assignment beats a secondary one, and
    among equals the landmark that comes first in sorted id order wins.
    Returns ``({building_key: (landmark id, primary)}, [landmark ids with no overlap])``.
    """
    keys = buildings["building_key"].to_numpy()
    geoms = np.asarray(buildings["geometry"].to_numpy(), dtype=object)
    tree = STRtree(geoms) if len(geoms) else None
    primary: dict[str, str] = {}
    secondary: dict[str, str] = {}
    unassigned = []
    for lid in sorted(footprints):
        fp = footprints[lid]
        cands = []
        hits = tree.query(fp, predicate="intersects") if tree is not None else []
        for j in hits:
            area = round(float(shapely.area(shapely.intersection(geoms[j], fp))), 6)
            if area > 0:
                cands.append((-area, str(keys[j]), int(j)))
        if not cands:
            unassigned.append(lid)
            continue
        cands.sort()
        primary.setdefault(cands[0][1], lid)
        for neg_area, key, j in cands[1:]:
            if -neg_area / float(shapely.area(geoms[j])) > 0.5:
                secondary.setdefault(key, lid)
    out = {k: (v, False) for k, v in secondary.items()}
    out.update({k: (v, True) for k, v in primary.items()})
    return out, unassigned


def load_landmarks(path: Path = LANDMARKS_FILE) -> dict:
    """{(osm_type, osm_id): landmark id} from tests/landmarks.yaml.

    The pipeline stores OSM types as one letter (``w``, ``r``, ``n``); the YAML spells them out.
    """
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return {
        (OSM_TYPE_CODE[e["osm"]["type"]], int(e["osm"]["id"])): e["id"] for e in data["landmarks"]
    }


def _clean(v):
    return None if _missing(v) else v


def osm_key(osm_type, osm_id) -> str:
    return f"osm:{osm_type}{int(osm_id)}"


def build(vols: gpd.GeoDataFrame, osm: gpd.GeoDataFrame, parts: gpd.GeoDataFrame, landmarks: dict):
    """Compute both layers and all report material. Pure function of its inputs."""
    vols = dbt_volumes_sorted(vols)
    vh = dbt_volume_heights(vols)
    vh["vol_key"] = "dbt:" + vh["vol_id"]
    vh["building_key"] = "dbt:" + vh["building_ref"]

    # DBT buildings: union of volume footprints, height = max top.
    dbt_rows = []
    for ref, grp in vh.groupby("building_ref", sort=True):
        dbt_rows.append(
            {
                "building_key": "dbt:" + ref,
                "geometry": shapely.union_all(grp.geometry.to_numpy()),
                "height_m": float(grp["top_m"].max()),
                "n_volumes": len(grp),
                "ground_flag": "neighbour_median"
                if (grp["ground_flag"] == "neighbour_median").any()
                else None,
                "ground_neighbours": grp["ground_neighbours"].max(),
                "building_class": grp["building_class"].iloc[0]
                if "building_class" in grp.columns
                else None,
            }
        )
    dbt_b = gpd.GeoDataFrame(dbt_rows, geometry="geometry", crs=METRIC_CRS)

    # Matching.
    osm = osm.sort_values(["osm_type", "osm_id"], kind="stable").reset_index(drop=True)
    dbt_union = shapely.union_all(vh.geometry.to_numpy())
    cov = coverage_ratios(osm.geometry.to_numpy(), dbt_union)
    matched = is_matched(cov)
    osm = osm.assign(coverage=cov, matched=matched)

    xfer = transfer_attributes(dbt_b.set_index("building_key").geometry, osm[osm["matched"]])
    dbt_b = dbt_b.join(xfer, on="building_key")
    # Default height (ADR-0016): fails loudly when there is no EDI_MIN building.
    default = derive_default(dbt_b)
    unmatched = osm[~osm["matched"]].copy()
    parse_log, osm_rows, unmatched_report = [], [], []

    parts_tree = STRtree(parts.geometry.to_numpy()) if len(parts) else None
    n_with_parts = 0
    for r in unmatched.itertuples():
        key = osm_key(r.osm_type, r.osm_id)
        top, src, rows = osm_top_m(r.height_raw, r.levels_raw, default["value"])
        rendered, reason = render_status(r.building, src)
        bottom, brows = osm_bottom_m(r.min_height_raw, r.min_level_raw)
        for field, raw, status, why in rows + brows:
            parse_log.append((key, field, raw, status, why))
        if parts_tree is not None:
            hits = parts_tree.query(r.geometry, predicate="intersects")
            has_parts = any(
                shapely.area(shapely.intersection(r.geometry, parts.geometry.iloc[j])) > 0
                for j in hits
            )
        else:
            has_parts = False
        n_with_parts += int(has_parts)
        osm_rows.append(
            {
                "key": key,
                "osm_type": r.osm_type,
                "osm_id": int(r.osm_id),
                "name": _clean(r.name),
                "building_type": r.building,
                "geometry": r.geometry,
                "bottom_m": bottom,
                "top_m": top,
                "height_source": src,
                "coverage": float(r.coverage),
                "has_parts": has_parts,
                "rendered": rendered,
                "render_reason": reason,
            }
        )
        unmatched_report.append(
            {
                "key": key,
                "name": _clean(r.name),
                "building_type": r.building,
                "coverage": float(r.coverage),
                "rule": src,
                "height_m": top,
                "bottom_m": bottom,
                "has_parts": has_parts,
                "rendered": rendered,
                "render_reason": reason,
            }
        )

    # --- landmark-first assignment (ADR-0017 point 1) over the rendered buildings
    cand = pd.concat(
        [
            pd.DataFrame({"building_key": dbt_b["building_key"], "geometry": dbt_b["geometry"]}),
            pd.DataFrame(
                {
                    "building_key": [x["key"] for x in osm_rows if x["rendered"]],
                    "geometry": [x["geometry"] for x in osm_rows if x["rendered"]],
                }
            ),
        ],
        ignore_index=True,
    )
    lm_osm = osm.set_index(["osm_type", "osm_id"]).geometry
    footprints, lm_missing = {}, []
    # ADR-0018 point 2: a landmark whose own OSM element is not rendered gets no assignment.
    not_rendered = {(x["osm_type"], x["osm_id"]) for x in osm_rows if not x["rendered"]}
    for (t, i), lid in sorted(landmarks.items(), key=lambda kv: kv[1]):
        if (t, int(i)) in not_rendered:
            continue
        if (t, i) in lm_osm.index:
            footprints[lid] = lm_osm.loc[(t, i)]
        else:
            lm_missing.append(lid)
    assigned, lm_no_overlap = assign_landmarks(cand, footprints)
    dbt_b["landmark_id"] = [assigned.get(k, (None, False))[0] for k in dbt_b["building_key"]]
    dbt_b["landmark_primary"] = [assigned.get(k, (None, False))[1] for k in dbt_b["building_key"]]

    # --- render_volumes
    dbt_v = vh.assign(source="dbt", height_source="dbt", rendered=True, render_reason=None)
    dbt_v["height_m"] = dbt_v["top_m"] - dbt_v["bottom_m"]
    rv_dbt = dbt_v[
        [
            "vol_key",
            "building_key",
            "source",
            "bottom_m",
            "top_m",
            "height_m",
            "height_source",
            "ground_flag",
            "ground_neighbours",
            "rendered",
            "render_reason",
            "geometry",
        ]
    ]
    rv_osm = pd.DataFrame(
        {
            "vol_key": [x["key"] for x in osm_rows],
            "building_key": [x["key"] for x in osm_rows],
            "source": "osm",
            "bottom_m": [x["bottom_m"] for x in osm_rows],
            "top_m": [x["top_m"] for x in osm_rows],
            "height_m": [x["top_m"] - x["bottom_m"] for x in osm_rows],
            "height_source": [x["height_source"] for x in osm_rows],
            "ground_flag": None,
            "ground_neighbours": pd.array([pd.NA] * len(osm_rows), dtype="Int64"),
            "rendered": [x["rendered"] for x in osm_rows],
            "render_reason": [x["render_reason"] for x in osm_rows],
            "geometry": [x["geometry"] for x in osm_rows],
        }
    )
    frames = [f for f in (rv_dbt, rv_osm) if len(f)]
    rv = pd.concat(frames, ignore_index=True)
    rv = gpd.GeoDataFrame(rv, geometry="geometry", crs=METRIC_CRS)
    rv = no_negative_zero(rv).sort_values("vol_key", kind="stable").reset_index(drop=True)

    # --- buildings
    b_dbt = pd.DataFrame(
        {
            "building_key": dbt_b["building_key"],
            "source": "dbt",
            "height_m": dbt_b["height_m"],
            "height_source": "dbt",
            "osm_type": dbt_b["osm_type"],
            "osm_id": dbt_b["osm_id"],
            "name": dbt_b["name"],
            "building_type": dbt_b["building_type"],
            "landmark_id": dbt_b["landmark_id"],
            "landmark_primary": dbt_b["landmark_primary"],
            "n_volumes": dbt_b["n_volumes"],
            "rendered": True,
            "render_reason": None,
            "geometry": dbt_b["geometry"],
        }
    )
    b_osm = pd.DataFrame(
        {
            "building_key": [x["key"] for x in osm_rows],
            "source": "osm",
            "height_m": [x["top_m"] for x in osm_rows],
            "height_source": [x["height_source"] for x in osm_rows],
            "osm_type": [x["osm_type"] for x in osm_rows],
            "osm_id": [x["osm_id"] for x in osm_rows],
            "name": [x["name"] for x in osm_rows],
            "building_type": [x["building_type"] for x in osm_rows],
            "landmark_id": [assigned.get(x["key"], (None, False))[0] for x in osm_rows],
            "landmark_primary": [assigned.get(x["key"], (None, False))[1] for x in osm_rows],
            "n_volumes": 1,
            "rendered": [x["rendered"] for x in osm_rows],
            "render_reason": [x["render_reason"] for x in osm_rows],
            "geometry": [x["geometry"] for x in osm_rows],
        }
    )
    bl = pd.concat([f for f in (b_dbt, b_osm) if len(f)], ignore_index=True)
    bl["osm_id"] = bl["osm_id"].astype("Int64")
    bl["n_volumes"] = bl["n_volumes"].astype("int64")
    bl = gpd.GeoDataFrame(bl, geometry="geometry", crs=METRIC_CRS)
    bl = no_negative_zero(bl).sort_values("building_key", kind="stable").reset_index(drop=True)

    return {
        "render_volumes": rv,
        "buildings": bl,
        "osm": osm,
        "dbt_volumes": vh,
        "dbt_buildings": dbt_b,
        "defaults": default,
        "parse_log": parse_log,
        "unmatched_report": unmatched_report,
        "n_unmatched_with_parts": n_with_parts,
        "landmarks_no_osm_footprint": lm_missing,
        "landmarks_no_rendered_overlap": lm_no_overlap,
    }


def dbt_volumes_sorted(vols: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return vols.sort_values("vol_id", kind="stable").reset_index(drop=True)


# ----------------------------------------------------------------------------- report


def coverage_histogram(cov) -> list[dict]:
    cov = np.asarray(cov)
    out = []
    for i in range(10):
        lo, hi = i / 10, (i + 1) / 10
        n = int(((cov >= lo) & ((cov < hi) if i < 9 else (cov <= hi))).sum())
        out.append({"bin": f"{lo:.1f}-{hi:.1f}", "n": n})
    return out


def distribution(values) -> dict:
    v = np.asarray(values, dtype=float)
    q = np.percentile(v, [5, 25, 50, 75, 95])
    return {
        "min": float(v.min()),
        "p5": float(q[0]),
        "p25": float(q[1]),
        "median": float(q[2]),
        "p75": float(q[3]),
        "p95": float(q[4]),
        "max": float(v.max()),
    }


def make_report(res: dict) -> dict:
    bl, rv, osm = res["buildings"], res["render_volumes"], res["osm"]
    vh = res["dbt_volumes"]
    area = shapely.area(bl.geometry.to_numpy())
    total_area = float(area.sum())
    by_src = {}
    for s in HEIGHT_SOURCES:
        m = (bl["height_source"] == s).to_numpy()
        by_src[s] = {
            "buildings": int(m.sum()),
            "share_of_buildings": float(m.mean()),
            "footprint_area_m2": float(area[m].sum()),
            "share_of_footprint_area": float(area[m].sum() / total_area),
        }
    vol_by_src = {s: int((rv["height_source"] == s).sum()) for s in HEIGHT_SOURCES}

    h = bl["height_m"]
    outl = bl[(h > OUTLIER_HIGH_M) | (h < OUTLIER_LOW_M)]
    outliers = [
        {
            "kind": "building_height",
            "key": r.building_key,
            "name": _clean(r.name),
            "value_m": float(r.height_m),
            "note": f">{OUTLIER_HIGH_M:g} m"
            if r.height_m > OUTLIER_HIGH_M
            else f"<{OUTLIER_LOW_M:g} m",
        }
        for r in outl.itertuples()
    ]
    names = bl.set_index("building_key")["name"]
    for r in vh.itertuples():
        if r.bottom_m < -BOTTOM_TOLERANCE_M:
            outliers.append(
                {
                    "kind": "dbt_volume_bottom_below_ground",
                    "key": r.vol_key,
                    "name": _clean(names.get(r.building_key)),
                    "value_m": float(r.bottom_m),
                    "note": f"bottom_m < -{BOTTOM_TOLERANCE_M:g}",
                }
            )
        if r.top_m <= r.bottom_m:
            outliers.append(
                {
                    "kind": "dbt_volume_top_not_above_bottom",
                    "key": r.vol_key,
                    "name": _clean(names.get(r.building_key)),
                    "value_m": float(r.top_m - r.bottom_m),
                    "note": "top_m <= bottom_m",
                }
            )
    tall = bl.sort_values(["height_m", "building_key"], ascending=[False, True]).head(5)
    cov = osm["coverage"].to_numpy()
    n_osm = len(osm)
    n_unmatched = int((~osm["matched"]).sum())
    dbt_b = res["dbt_buildings"]
    return {
        "counts": {
            "buildings": len(bl),
            "render_volumes": len(rv),
            "dbt_buildings": int((bl["source"] == "dbt").sum()),
            "osm_only_buildings": int((bl["source"] == "osm").sum()),
            "dbt_volumes": int((rv["source"] == "dbt").sum()),
        },
        "height_source_buildings_and_area": by_src,
        "height_source_volumes": vol_by_src,
        "height_m_distribution": distribution(h),
        "outliers": outliers,
        "tallest_five": [
            {"key": r.building_key, "name": _clean(r.name), "height_m": float(r.height_m)}
            for r in tall.itertuples()
        ],
        "matching": {
            "threshold": MATCH_THRESHOLD,
            "osm_buildings": n_osm,
            "matched": n_osm - n_unmatched,
            "unmatched": n_unmatched,
            "unmatched_share": n_unmatched / n_osm if n_osm else None,
            "coverage_below_0.5": int((cov < 0.5).sum()),
            "coverage_below_0.2": int((cov < 0.2).sum()),
            "coverage_histogram": coverage_histogram(cov),
            "band": [BAND_LOW, BAND_HIGH],
            "in_band_inclusive": int(((cov >= BAND_LOW) & (cov <= BAND_HIGH)).sum()),
            "unmatched_with_building_parts": res["n_unmatched_with_parts"],
        },
        "attribute_transfer": {
            "dbt_buildings_with_osm_attributes": int(dbt_b["osm_id"].notna().sum()),
            "dbt_buildings_without_osm_attributes": int(dbt_b["osm_id"].isna().sum()),
            "dbt_buildings_with_landmark_id": int(dbt_b["landmark_id"].notna().sum()),
        },
        "landmark_assignment": {
            "buildings_with_landmark_id": int(bl["landmark_id"].notna().sum()),
            "primary_buildings": int(bl["landmark_primary"].sum()),
            "no_osm_footprint": res["landmarks_no_osm_footprint"],
            "no_rendered_overlap": res["landmarks_no_rendered_overlap"],
        },
        "unmatched_rule_counts": {
            s: sum(1 for x in res["unmatched_report"] if x["rule"] == s)
            for s in HEIGHT_SOURCES
            if s != "dbt"
        },
        "render_status": {
            "rendered": int(bl["rendered"].sum()),
            "not_rendered": int((~bl["rendered"]).sum()),
            "reasons": {
                str(k): int(v)
                for k, v in bl.loc[~bl["rendered"], "render_reason"]
                .value_counts()
                .sort_index()
                .items()
            },
        },
        "dbt_ground_flag_neighbour_median_buildings": int(
            (dbt_b["ground_flag"] == "neighbour_median").sum()
        ),
    }


def write_csv(path: Path, header, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="\n", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)


def _fmt(v) -> str:
    if v is None:
        return ""
    text = f"{v:.3f}" if isinstance(v, float) else str(v)
    return "0.000" if text == "-0.000" else text


def write_heights_md(rep: dict, sha: str, path: Path) -> None:
    c, m, d = rep["counts"], rep["matching"], rep["height_m_distribution"]
    L = [
        "# Building heights (T-1.4)",
        "",
        "Generated by `milano_iso.heights`; do not edit by hand.",
        f"Canonical dump sha256 of `processed/pilot.gpkg` (all layers): `{sha}`",
        "",
        f"- `buildings`: {c['buildings']} ({c['dbt_buildings']} DBT, {c['osm_only_buildings']} OSM only)",
        (
            f"- `render_volumes`: {c['render_volumes']} ({c['dbt_volumes']} DBT volumes, "
            f"{c['render_volumes'] - c['dbt_volumes']} OSM prisms)"
        ),
        (
            f"- Rendered buildings: {rep['render_status']['rendered']}; not rendered: "
            f"{rep['render_status']['not_rendered']}, by reason: {rep['render_status']['reasons']} "
            "(ADR-0016: unmatched `building=roof` / `building=construction`)."
        ),
        (
            f"- Default height (ADR-0016): {rep['default']['value']:.3f} m, n = "
            f"{rep['default']['n']}, method `{rep['default']['method']}`."
        ),
        "",
        "## Share by height_source",
        "",
        "| height_source | Buildings | Share | Footprint area m2 | Share of area | Volumes |",
        "|---|---|---|---|---|---|",
    ]
    for s, v in rep["height_source_buildings_and_area"].items():
        L.append(
            f"| {s} | {v['buildings']} | {v['share_of_buildings']:.2%} | {v['footprint_area_m2']:.0f} "
            f"| {v['share_of_footprint_area']:.2%} | {rep['height_source_volumes'][s]} |"
        )
    L += [
        "",
        "## Distribution of buildings.height_m (m, linear-interpolated percentiles)",
        "",
        "| min | p5 | p25 | median | p75 | p95 | max |",
        "|---|---|---|---|---|---|---|",
        "| "
        + " | ".join(f"{d[k]:.2f}" for k in ("min", "p5", "p25", "median", "p75", "p95", "max"))
        + " |",
        "",
        f"## Outliers (> {OUTLIER_HIGH_M:g} m or < {OUTLIER_LOW_M:g} m) and volume anomalies",
        "",
    ]
    if rep["outliers"]:
        L += ["| Kind | Key | Name | Value m | Note |", "|---|---|---|---|---|"]
        for o in rep["outliers"]:
            L.append(
                f"| {o['kind']} | {o['key']} | {_fmt(o['name'])} | {o['value_m']:.3f} | {o['note']} |"
            )
    else:
        L.append("None. (`outliers.csv` is empty.)")
    L += ["", "## Tallest five buildings", "", "| Key | Name | height_m |", "|---|---|---|"]
    for t in rep["tallest_five"]:
        L.append(f"| {t['key']} | {_fmt(t['name'])} | {t['height_m']:.2f} |")
    L += [
        "",
        "## OSM / DBT matching",
        "",
        f"- Threshold (provisional): coverage >= {m['threshold']}.",
        (
            f"- OSM buildings: {m['osm_buildings']}; matched {m['matched']}; "
            f"unmatched (rendered from OSM) {m['unmatched']} ({m['unmatched_share']:.2%})."
        ),
        f"- Coverage < 0.5: {m['coverage_below_0.5']}; coverage < 0.2: {m['coverage_below_0.2']}.",
        (
            f"- Buildings with coverage between {m['band'][0]} and {m['band'][1]} (inclusive): "
            f"{m['in_band_inclusive']}."
        ),
        (
            f"- Unmatched OSM buildings that overlap a `building:part`: {m['unmatched_with_building_parts']} "
            "(parts are not rendered in v1)."
        ),
        f"- Unmatched OSM buildings by rule: {rep['unmatched_rule_counts']}.",
        "",
        "| Coverage bin | OSM buildings |",
        "|---|---|",
    ]
    L += [f"| {b['bin']} | {b['n']} |" for b in m["coverage_histogram"]]
    a = rep["attribute_transfer"]
    L += [
        "",
        "## Attribute transfer (OSM to DBT)",
        "",
        f"- DBT buildings with OSM attributes: {a['dbt_buildings_with_osm_attributes']}.",
        f"- DBT buildings with no OSM attributes: {a['dbt_buildings_without_osm_attributes']}.",
        f"- DBT buildings with a landmark_id: {a['dbt_buildings_with_landmark_id']}.",
        (
            f"- DBT buildings using the `neighbour_median` ground fallback: "
            f"{rep['dbt_ground_flag_neighbour_median_buildings']}."
        ),
        "",
        (
            "Unmatched OSM buildings: `unmatched_osm.csv`; defaults: `defaults.json`; "
            "parse log: `height_parse_log.csv`; outliers: `outliers.csv`."
        ),
    ]
    path.write_text("\n".join(L) + "\n", encoding="utf-8", newline="\n")


def write_outputs(res: dict, rep: dict, defaults: dict, sha: str, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "heights.json").write_text(
        json.dumps({**rep, "canonical_dump_sha256_pilot_gpkg": sha}, indent=2, sort_keys=True)
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    (out_dir / "defaults.json").write_text(
        json.dumps(defaults, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    write_heights_md(rep, sha, out_dir / "heights.md")
    write_csv(
        out_dir / "unmatched_osm.csv",
        [
            "key",
            "name",
            "building_type",
            "coverage",
            "rule",
            "height_m",
            "bottom_m",
            "has_parts",
            "rendered",
            "render_reason",
        ],
        [
            (
                x["key"],
                x["name"] or "",
                x["building_type"],
                f"{x['coverage']:.4f}",
                x["rule"],
                "" if x["height_m"] is None else f"{x['height_m']:.3f}",
                f"{x['bottom_m']:.3f}",
                x["has_parts"],
                x["rendered"],
                x["render_reason"] or "",
            )
            for x in sorted(res["unmatched_report"], key=lambda x: x["key"])
        ],
    )
    write_csv(
        out_dir / "outliers.csv",
        ["kind", "key", "name", "value_m", "note"],
        [
            (o["kind"], o["key"], o["name"] or "", f"{o['value_m']:.3f}", o["note"])
            for o in rep["outliers"]
        ],
    )
    write_csv(
        out_dir / "height_parse_log.csv",
        ["osm_key", "field", "raw", "status", "reason"],
        sorted(res["parse_log"]),
    )


def check_layers(rv: pd.DataFrame, bl: pd.DataFrame) -> dict:
    """Acceptance criterion 2: every row has height_m > 0 and a known height_source."""

    def ok(df):
        h = df["height_m"]
        return bool(
            h.notna().all() and (h > 0).all() and df["height_source"].isin(HEIGHT_SOURCES).all()
        )

    return {"render_volumes_ok": ok(rv), "buildings_ok": ok(bl)}


def run(gpkg: Path, out_dir: Path = ARTIFACT_DIR, landmarks_path: Path = LANDMARKS_FILE) -> dict:
    vols = pyogrio.read_dataframe(gpkg, layer="dbt_volumes")
    osm = pyogrio.read_dataframe(gpkg, layer="osm_buildings")
    parts = pyogrio.read_dataframe(gpkg, layer="osm_building_parts")
    res = build(vols, osm, parts, load_landmarks(landmarks_path))
    for name in ("render_volumes", "buildings"):
        pyogrio.write_dataframe(res[name], gpkg, layer=name, driver="GPKG", append=False)
    sha = canonical_dump_sha256(gpkg)
    rep = make_report(res)
    rep["default"] = res["defaults"]
    rep["checks"] = check_layers(res["render_volumes"], res["buildings"])
    write_outputs(res, rep, res["defaults"], sha, out_dir)
    return {"report": rep, "sha": sha}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--extent", choices=["pilot"], required=True)
    ap.add_argument("--artifacts", type=Path, default=ARTIFACT_DIR)
    args = ap.parse_args(argv)
    gpkg = config.PROCESSED_DIR / "pilot.gpkg"
    if not gpkg.exists():
        sys.exit(f"missing {gpkg}; run milano_iso.normalise first")
    r = run(gpkg, args.artifacts)
    rep = r["report"]
    print(f"canonical dump sha256 of {gpkg.name}: {r['sha']}")
    print(json.dumps({"checks": rep["checks"], "counts": rep["counts"]}, sort_keys=True))
    la = rep["landmark_assignment"]
    if la["no_osm_footprint"] or la["no_rendered_overlap"]:
        print(f"landmarks without assignment: {json.dumps(la, sort_keys=True)}")
    return 0 if all(rep["checks"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
