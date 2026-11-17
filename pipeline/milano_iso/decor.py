"""Trees and road markings added to processed/pilot.gpkg (T-4.1, ADR-0028).

Run: ``python -m milano_iso.decor --extent pilot`` (after ``milano_iso.heights``).

Adds two layers to the processed GeoPackage (EPSG:32632):

- ``trees`` (Point): OSM ``natural=tree`` nodes (``source=osm_tree``), trees placed along OSM
  ``natural=tree_row`` ways (``osm_tree_row``; the line is data, the positions on it are style) and
  a seeded decorative fill inside park and garden areas (``fill``; style, ``decorative=true``, no
  OSM id). Columns: osm_type, osm_id, source, decorative, height_m, height_source.
- ``markings`` (MultiPolygon, flat): dashed centre lines on the road classes of
  ``style.CENTRE_LINE_CLASSES`` and zebra stripes on OSM ``footway=crossing`` ways. Columns:
  osm_type, osm_id (of the road or crossing the marking comes from), kind, stylised (always true).

The tag rules live here rather than in ``classify.RULES``: those rules feed ``normalise``, which
must not change its outputs (T-1.3 artifacts). Trees and crossings are read from the OSM interim
extract (``interim/osm_pilot.gpkg``); roads, buildings, green, road areas and water come from the
processed layers. Everything is deterministic: sorted iteration, a seeded generator per grid cell.
"""

import argparse
import json
import logging
import math
import re
import sys
from collections import Counter
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely
from shapely.geometry import MultiPolygon, Point, Polygon, box
from shapely.ops import substring

from milano_iso import classify, config, style
from milano_iso.geo import canonical_dump_sha256
from milano_iso.normalise import DropLog, reproject
from milano_iso.tiles import geom as tgeom

log = logging.getLogger("milano_iso.decor")

METRIC_CRS = "EPSG:32632"
ARTIFACT_DIR = config.REPO_ROOT / "reports" / "artifacts" / "T-4.1"
TREE_COLUMNS = ["osm_type", "osm_id", "source", "decorative", "height_m", "height_source"]
MARKING_COLUMNS = ["osm_type", "osm_id", "kind", "stylised"]
_HEIGHT_RE = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*(?:m)?\s*$", re.IGNORECASE)


# ----------------------------------------------------------------------------- reading


def read_osm_tags(osm_gpkg: Path) -> dict[str, gpd.GeoDataFrame]:
    """``points`` and ``lines`` of the OSM interim extract, tags decoded, geometry in EPSG:32632."""
    out = {}
    for layer in ("points", "lines"):
        gdf = pyogrio.read_dataframe(osm_gpkg, layer=layer)
        gdf["tags"] = gdf["tags"].map(json.loads)
        out[layer] = gdf
    return to_metric(out)


def to_metric(osm: dict[str, gpd.GeoDataFrame]) -> dict[str, gpd.GeoDataFrame]:
    """Reproject EPSG:4326 frames (as read from the extract) to EPSG:32632."""
    res = {}
    for name, gdf in osm.items():
        g = gdf.copy()
        g["geometry"] = reproject(gdf.geometry.to_numpy(), "EPSG:4326")
        res[name] = gpd.GeoDataFrame(g, geometry="geometry", crs=METRIC_CRS)
    return res


def parse_tree_height(raw) -> float | None:
    """Metres from an OSM tree ``height`` tag ('9', '8.5', '12 m'); None when not a plain number
    or not in (0, TREE_MAX_HEIGHT_M]."""
    if raw is None:
        return None
    m = _HEIGHT_RE.match(str(raw))
    if not m:
        return None
    h = float(m.group(1).replace(",", "."))
    return h if 0 < h <= style.TREE_MAX_HEIGHT_M else None


# ----------------------------------------------------------------------------- trees


def _height_of(tags, key, fid, log_: DropLog):
    raw = tags.get("height")
    h = parse_tree_height(raw)
    if h is not None:
        return h, "osm_height"
    if raw is not None:
        log_.add("trees", "osm", fid, "defaulted", f"height_tag_not_parseable:{raw}")
    return style.TREE_DEFAULT_HEIGHT_M, "style_default"


def points_along(line, spacing: float) -> list[Point]:
    """Points at spacing/2, 3*spacing/2, ... along a line; one midpoint for a short line."""
    length = line.length
    if length <= 0:
        return []
    n = max(1, int(length // spacing))
    pitch = length / n  # evenly spread, at most `spacing` apart
    return [line.interpolate((k + 0.5) * pitch) for k in range(n)]


def mapped_trees(osm: dict, extent, log_: DropLog) -> tuple[gpd.GeoDataFrame, dict]:
    """OSM natural=tree nodes and trees along natural=tree_row ways, inside ``extent``."""
    rows = []
    stats: Counter = Counter()
    pts = osm["points"]
    for t, i, tags, g in zip(
        pts["osm_type"], pts["osm_id"], pts["tags"], pts.geometry, strict=True
    ):
        if tags.get("natural") != "tree":
            continue
        stats["tree_nodes_in_extract"] += 1
        fid = f"{t}{i}"
        if not extent.intersects(g):
            log_.add("trees", "osm", fid, "dropped", "outside_extent")
            stats["dropped_outside_extent"] += 1
            continue
        h, hs = _height_of(tags, "height", fid, log_)
        stats["height_tag_parsed" if hs == "osm_height" else "height_style_default"] += 1
        rows.append((t, int(i), "osm_tree", False, h, hs, g))
    lines = osm["lines"]
    for t, i, tags, g in zip(
        lines["osm_type"], lines["osm_id"], lines["tags"], lines.geometry, strict=True
    ):
        if tags.get("natural") != "tree_row":
            continue
        stats["tree_rows_in_extract"] += 1
        fid = f"{t}{i}"
        clipped = shapely.intersection(g, extent)
        parts = [p for p in shapely.get_parts(clipped) if p.geom_type == "LineString"]
        if not parts:
            log_.add("trees", "osm", fid, "dropped", "tree_row_outside_extent")
            stats["dropped_outside_extent"] += 1
            continue
        h, hs = _height_of(tags, "height", fid, log_)
        n = 0
        for part in parts:
            for p in points_along(part, style.TREE_ROW_SPACING_M):
                rows.append((t, int(i), "osm_tree_row", False, h, hs, p))
                n += 1
        stats["row_trees_placed"] += n
    df = pd.DataFrame(rows, columns=[*TREE_COLUMNS, "geometry"])
    df = df.sort_values(["osm_type", "osm_id"], kind="stable").reset_index(drop=True)
    return gpd.GeoDataFrame(df, geometry="geometry", crs=METRIC_CRS), dict(sorted(stats.items()))


def road_ribbons(roads: gpd.GeoDataFrame) -> list:
    """The ribbon polygons the tile export draws for surface roads (same width rule)."""
    out = []
    for r in roads.itertuples(index=False):
        if bool(r.underground) or r.geometry is None or r.geometry.is_empty:
            continue
        w, _ = tgeom.ribbon_width(r.width_raw, r.class_, style.ROAD_WIDTH_M)
        out.append(tgeom.ribbon(r.geometry, w))
    return out


def avoid_zone(layers: dict, mapped: gpd.GeoDataFrame):
    """Union of everything a fill tree keeps its clearance from."""
    c = style.FILL_CLEARANCE_M
    parts = []
    b = layers["buildings"].geometry
    parts += [g.buffer(c["building"]) for g in b if not g.is_empty]
    rv = layers["render_volumes"]
    parts += [g.buffer(c["building"]) for g in rv[rv["rendered"].astype(bool)].geometry]
    parts += [
        g.buffer(c["road"])
        for g in road_ribbons(layers["roads"].rename(columns={"class": "class_"}))
    ]
    parts += [g.buffer(c["road_area"]) for g in layers["road_areas"].geometry if not g.is_empty]
    parts += [g.buffer(c["water"]) for g in layers["water"].geometry if not g.is_empty]
    parts += [g.buffer(c["tree"]) for g in mapped.geometry]
    return shapely.union_all(parts) if parts else Polygon()


def fill_trees(layers: dict, mapped: gpd.GeoDataFrame, extent) -> gpd.GeoDataFrame:
    """Decorative trees on a jittered grid in park and garden areas (style, seeded)."""
    green = layers["green"]
    kinds = green["kind"].isin(style.FILL_GREEN_KINDS)
    zone = shapely.union_all(list(green[kinds].geometry))
    zone = zone.buffer(-style.FILL_EDGE_INSET_M).intersection(extent)
    zone = zone.difference(avoid_zone(layers, mapped))
    rows = []
    if not zone.is_empty:
        shapely.prepare(zone)
        s = style.FILL_SPACING_M
        x0, y0, x1, y1 = zone.bounds
        for ix in range(math.floor(x0 / s), math.floor(x1 / s) + 1):
            for iy in range(math.floor(y0 / s), math.floor(y1 / s) + 1):
                rng = np.random.default_rng([style.FILL_SEED, ix, iy])
                dx, dy = rng.uniform(-style.FILL_JITTER_M, style.FILL_JITTER_M, 2)
                hj = rng.uniform(-style.FILL_HEIGHT_JITTER, style.FILL_HEIGHT_JITTER)
                p = Point((ix + 0.5) * s + dx, (iy + 0.5) * s + dy)
                if zone.contains(p):
                    h = round(style.TREE_DEFAULT_HEIGHT_M * (1.0 + hj), 3)
                    rows.append((None, None, "fill", True, h, "style_default", p))
    df = pd.DataFrame(rows, columns=[*TREE_COLUMNS, "geometry"])
    return gpd.GeoDataFrame(df, geometry="geometry", crs=METRIC_CRS)


def build_trees(osm: dict, layers: dict, extent, log_: DropLog):
    mapped, stats = mapped_trees(osm, extent, log_)
    fill = fill_trees(layers, mapped, extent)
    trees = pd.concat([mapped, fill], ignore_index=True)
    trees["osm_id"] = trees["osm_id"].astype("Int64")
    trees = gpd.GeoDataFrame(trees, geometry="geometry", crs=METRIC_CRS)
    stats["fill_trees"] = len(fill)
    stats["mapped_trees_total"] = len(mapped)
    return trees, stats


# ----------------------------------------------------------------------------- markings


def dashes(line, dash: float, gap: float, trim: float) -> list:
    """Sub-lines of ``line`` of length ``dash`` every dash+gap, centred between the end trims."""
    usable = line.length - 2 * trim
    if usable < dash:
        return []
    n = int((usable + gap) // (dash + gap))
    if n < 1:
        return []
    start = trim + (usable - (n * dash + (n - 1) * gap)) / 2
    return [
        substring(line, start + k * (dash + gap), start + k * (dash + gap) + dash) for k in range(n)
    ]


def centre_line_rows(roads: gpd.GeoDataFrame, stats: Counter) -> list:
    rows = []
    for r in roads.itertuples(index=False):
        if r.class_ not in style.CENTRE_LINE_CLASSES or bool(r.underground):
            continue
        stats["centre_line_roads_considered"] += 1
        polys = []
        for part in shapely.get_parts(r.geometry):
            if part.geom_type != "LineString":
                continue
            for d in dashes(part, style.CENTRE_DASH_M, style.CENTRE_GAP_M, style.CENTRE_END_TRIM_M):
                if d.length > 0:
                    polys.append(
                        d.buffer(style.CENTRE_WIDTH_M / 2, cap_style="flat", join_style="mitre")
                    )
        if not polys:
            stats["centre_line_roads_too_short"] += 1
            continue
        stats["centre_line_dashes"] += len(polys)
        rows.append((r.osm_type, int(r.osm_id), "centre_line", True, MultiPolygon(polys)))
    return rows


def zebra_stripes(line) -> list[Polygon]:
    """Stripes across a crossing way: one every ZEBRA_STRIPE_PITCH_M along it."""
    w, pitch = style.ZEBRA_STRIPE_WIDTH_M, style.ZEBRA_STRIPE_PITCH_M
    usable = line.length - 2 * style.ZEBRA_END_TRIM_M
    if usable < w:
        return []
    n = int((usable - w) // pitch) + 1
    first = style.ZEBRA_END_TRIM_M + (usable - ((n - 1) * pitch + w)) / 2 + w / 2
    half_len = style.ZEBRA_STRIPE_LENGTH_M / 2
    out = []
    for k in range(n):
        d = first + k * pitch
        a, b = line.interpolate(max(0.0, d - 0.25)), line.interpolate(min(line.length, d + 0.25))
        tx, ty = b.x - a.x, b.y - a.y
        norm = math.hypot(tx, ty)
        if norm == 0:
            continue
        tx, ty = tx / norm, ty / norm
        c = line.interpolate(d)
        px, py = -ty, tx  # perpendicular to the crossing way: along the road
        hw = w / 2
        out.append(
            Polygon(
                [
                    (c.x - tx * hw - px * half_len, c.y - ty * hw - py * half_len),
                    (c.x + tx * hw - px * half_len, c.y + ty * hw - py * half_len),
                    (c.x + tx * hw + px * half_len, c.y + ty * hw + py * half_len),
                    (c.x - tx * hw + px * half_len, c.y - ty * hw + py * half_len),
                ]
            )
        )
    return out


def crossing_rows(osm: dict, extent, log_: DropLog, stats: Counter) -> list:
    rows = []
    lines = osm["lines"]
    for t, i, tags, g in zip(
        lines["osm_type"], lines["osm_id"], lines["tags"], lines.geometry, strict=True
    ):
        if tags.get("footway") != "crossing":
            continue
        stats["crossing_ways_in_extract"] += 1
        fid = f"{t}{i}"
        value = tags.get("crossing")
        if value not in style.ZEBRA_CROSSING_VALUES:
            log_.add("markings", "osm", fid, "dropped", f"crossing_not_marked:{value}")
            stats["crossing_ways_not_marked"] += 1
            continue
        if classify.is_underground(tags):
            log_.add("markings", "osm", fid, "dropped", "underground")
            stats["crossing_ways_underground"] += 1
            continue
        if not extent.intersects(g):
            log_.add("markings", "osm", fid, "dropped", "outside_extent")
            stats["crossing_ways_outside_extent"] += 1
            continue
        stripes = zebra_stripes(g) if g.geom_type == "LineString" else []
        if not stripes:
            log_.add("markings", "osm", fid, "dropped", "crossing_too_short")
            stats["crossing_ways_too_short"] += 1
            continue
        stats["zebra_crossings"] += 1
        stats["zebra_stripes"] += len(stripes)
        rows.append((t, int(i), "zebra", True, MultiPolygon(stripes)))
    return rows


def build_markings(osm: dict, layers: dict, extent, log_: DropLog):
    stats: Counter = Counter()
    roads = layers["roads"].rename(columns={"class": "class_"})
    rows = centre_line_rows(roads, stats) + crossing_rows(osm, extent, log_, stats)
    # nodes: highway=crossing points exist in the extract but are not used (no orientation).
    stats["crossing_nodes_in_extract_unused"] = int(
        sum(t.get("highway") == "crossing" for t in osm["points"]["tags"])
    )
    df = pd.DataFrame(rows, columns=[*MARKING_COLUMNS, "geometry"])
    df["osm_id"] = df["osm_id"].astype("int64")
    df = df.sort_values(["osm_type", "osm_id"], kind="stable").reset_index(drop=True)
    gdf = gpd.GeoDataFrame(df, geometry="geometry", crs=METRIC_CRS)
    return gdf, dict(sorted(stats.items()))


# ----------------------------------------------------------------------------- run


def build_layers(osm: dict, layers: dict, bbox, log_: DropLog) -> dict:
    """``trees`` and ``markings`` frames plus their statistics."""
    extent = box(*bbox)
    trees, tstats = build_trees(osm, layers, extent, log_)
    markings, mstats = build_markings(osm, layers, extent, log_)
    return {"trees": trees, "markings": markings, "stats": {"trees": tstats, "markings": mstats}}


def run(gpkg: Path, osm_gpkg: Path, artifacts: Path, bbox=config.PILOT_AOI_BBOX) -> dict:
    """Add ``trees`` and ``markings`` to ``gpkg`` (replacing them if present)."""
    names = [n for n, _ in pyogrio.list_layers(gpkg)]
    layers = {
        n: pyogrio.read_dataframe(gpkg, layer=n)
        for n in ("buildings", "render_volumes", "green", "roads", "road_areas", "water")
    }
    for n in layers:
        assert n in names, n
    log_ = DropLog()
    osm = read_osm_tags(osm_gpkg)
    res = build_layers(osm, layers, bbox, log_)
    for name in ("trees", "markings"):
        pyogrio.write_dataframe(res[name], gpkg, layer=name, driver="GPKG")
    sha = canonical_dump_sha256(gpkg)
    trees = res["trees"]
    report = {
        "bbox_epsg32632": list(bbox),
        "style": {
            "fill_seed": style.FILL_SEED,
            "fill_spacing_m": style.FILL_SPACING_M,
            "fill_clearance_m": style.FILL_CLEARANCE_M,
            "tree_row_spacing_m": style.TREE_ROW_SPACING_M,
        },
        "trees_by_source": {
            k: int(v) for k, v in trees["source"].value_counts().sort_index().items()
        },
        "stats": res["stats"],
        "drop_log_rows": len(log_.rows),
        "canonical_dump_sha256_pilot_gpkg": sha,
    }
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / "decor_summary.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    log_.write(artifacts / "decor_drop_log.csv")
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--extent", choices=["pilot"], required=True)
    ap.add_argument("--artifacts", type=Path, default=ARTIFACT_DIR)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    gpkg = config.PROCESSED_DIR / "pilot.gpkg"
    osm_gpkg = config.INTERIM_DIR / "osm_pilot.gpkg"
    for p in (gpkg, osm_gpkg):
        if not p.exists():
            sys.exit(f"missing {p}; run the earlier data steps first")
    report = run(gpkg, osm_gpkg, args.artifacts)
    print(json.dumps({k: report[k] for k in ("trees_by_source", "stats")}, sort_keys=True))
    print(f"canonical dump sha256 of {gpkg.name}: {report['canonical_dump_sha256_pilot_gpkg']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
