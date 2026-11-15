"""Export processed/pilot.gpkg to one .glb plus one feature table per 500 m tile (T-2.2, T-2.2a).

Run: ``python -m milano_iso.tiles.export --extent pilot``
Rules: ADR-0021 (tile scheme), ADR-0022 (compact encoding, all buildings exported), ADR-0016. Deterministic: sorted
iteration, no timestamps, JSON with sorted keys.
"""

import argparse
import gzip
import json
import math
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from shapely import affinity
from shapely.geometry import box

from milano_iso import config, style
from milano_iso.tiles import geom, glb, grid

SUMMARY_DIR = config.REPO_ROOT / "reports" / "artifacts" / "T-2.2"
METRIC_CRS = 32632
GPKG_NAME = "pilot.gpkg"
BUDGET_GZIP_BYTES = 250 * 1024
SAMPLE_VERTICES = 128  # per tile, written to the summary for the client position check
# Per-tile gzip-9 bytes of the T-2.2 export (reports/artifacts/T-2.2/export_summary.md at 8360d08).
BASELINE_GZIP9 = {"-1_-1": 527468, "-1_0": 476956, "0_-1": 378851, "0_0": 661914}
FLAT_LAYERS = ("landuse", "green", "water", "road_areas", "roads", "rail")
# Feature-table columns per flat layer (osm_type, osm_id and the class or kind).
FLAT_FIELDS = {
    "landuse": ("osm_type", "osm_id", "kind"),
    "green": ("osm_type", "osm_id", "kind"),
    "water": ("osm_type", "osm_id", "kind"),
    "road_areas": ("osm_type", "osm_id", "class"),
    "roads": ("osm_type", "osm_id", "class"),
    "rail": ("osm_type", "osm_id", "class"),
}


def _clean(v):
    """JSON-safe scalar: NaN/NA to None, numpy to python, floats rounded to 3 decimals."""
    if v is None:
        return None
    if isinstance(v, np.generic):
        v = v.item()
    if isinstance(v, float):
        return None if math.isnan(v) else round(v, 3)
    if isinstance(v, str | int | bool):
        return v
    try:
        if v != v:  # noqa: PLR0124  pandas NA / NaT
            return None
    except (TypeError, ValueError):
        pass
    return str(v)


def _to_local(g):
    return affinity.translate(g, xoff=-config.ORIGIN_E, yoff=-config.ORIGIN_N)


def _json_bytes(obj) -> bytes:
    s = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return (s + "\n").encode("utf-8")


def _read(path: Path, layer: str) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(path, layer=layer)
    if gdf.crs is None or gdf.crs.to_epsg() != METRIC_CRS:
        raise ValueError(f"layer {layer}: expected EPSG:{METRIC_CRS}, got {gdf.crs}")
    return gdf


def _sorted_flat(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    gdf = gdf.copy()
    gdf["_row"] = np.arange(len(gdf))
    return gdf.sort_values(["osm_type", "osm_id", "_row"], kind="mergesort").reset_index(drop=True)


def _flat_features(layer: str, gdf: gpd.GeoDataFrame) -> list[dict]:
    """Per source row (surface only): table entry and local polygons (ribbons for lines)."""
    if "underground" in gdf.columns:
        gdf = gdf[~gdf["underground"].astype(bool)]
    out = []
    for row in _sorted_flat(gdf).itertuples(index=False):
        g = row.geometry
        if g is None or g.is_empty:
            continue
        entry = {"osm_type": _clean(row.osm_type), "osm_id": _clean(row.osm_id)}
        if layer in ("roads", "rail", "road_areas"):
            entry["class"] = _clean(row.class_)
        else:
            entry["kind"] = _clean(row.kind)
        gl = _to_local(g)
        if layer in ("roads", "rail"):
            table = style.ROAD_WIDTH_M if layer == "roads" else style.RAIL_WIDTH_M
            raw = row.width_raw if layer == "roads" else None
            w, src = geom.ribbon_width(raw, entry["class"], table)
            entry["width_m"] = w
            entry["width_source"] = src
            polys = geom.polygons_of(geom.ribbon(gl, w))
        else:
            if not gl.is_valid:
                gl = shapely.make_valid(gl)
            polys = geom.polygons_of(gl)
        if polys:
            out.append({"entry": entry, "polys": polys})
    return out


def _clip_polys(polys, tile_box) -> list:
    out = []
    for p in polys:
        if not shapely.intersects(p, tile_box):
            continue
        out.extend(geom.polygons_of(p.intersection(tile_box)))
    return out


def _named(layer: str, mb: geom.MeshBuilder) -> list[dict]:
    """Chunks of a builder as meshes: `<layer>`, or `<layer>#<n>` when split."""
    chunks = mb.to_gl_chunks()
    if len(chunks) == 1:
        return [{"name": layer, **chunks[0]}]
    return [{"name": f"{layer}#{n}", **c} for n, c in enumerate(chunks)]


def _sample(meshes: list[dict]) -> list[dict]:
    """Evenly spaced vertices with their float64 client-frame coordinates (metres)."""
    owners = [(m["name"], v) for m in meshes for v in range(len(m["positions"]))]
    if not owners:
        return []
    by_name = {m["name"]: m for m in meshes}
    picks = np.unique(np.linspace(0, len(owners) - 1, min(SAMPLE_VERTICES, len(owners))).astype(int))
    out = []
    for p in picks:
        name, v = owners[int(p)]
        out.append({"mesh": name, "vertex": v, "xyz": [float(c) for c in by_name[name]["positions"][v]]})
    return out


def build(
    extent: str = "pilot",
    out_dir: Path | None = None,
    summary_dir: Path | None = None,
):
    if extent != "pilot":
        raise ValueError("only --extent pilot is supported")
    gpkg = config.PROCESSED_DIR / GPKG_NAME
    out_dir = out_dir or config.DATA_DIR / "tiles" / "pilot"
    summary_dir = summary_dir or SUMMARY_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in sorted([*out_dir.glob("*.glb"), *out_dir.glob("*.json")]):
        stale.unlink()
    summary_dir.mkdir(parents=True, exist_ok=True)

    buildings = _read(gpkg, "buildings")
    volumes = _read(gpkg, "render_volumes")
    n_buildings_total = len(buildings)
    rendered = buildings[buildings["rendered"].astype(bool)].sort_values("building_key")
    rendered = rendered.reset_index(drop=True)
    keys = set(rendered["building_key"])
    vols = volumes[volumes["rendered"].astype(bool) & volumes["building_key"].isin(keys)]
    vols = vols.sort_values("vol_key").reset_index(drop=True)
    vols_by_building: dict[str, list] = {}
    for v in vols.itertuples(index=False):
        vols_by_building.setdefault(v.building_key, []).append(v)
    stray = volumes[volumes["rendered"].astype(bool) & ~volumes["building_key"].isin(keys)]

    # Assign each rendered building to one tile by the representative point of its footprint.
    tile_of: dict[str, tuple[int, int]] = {}
    for b in rendered.itertuples(index=False):
        rp = b.geometry.representative_point()
        tile_of[b.building_key] = grid.tile_ij(rp.x, rp.y)

    flat = {}
    for layer in FLAT_LAYERS:
        gdf = _read(gpkg, layer)
        if "class" in gdf.columns:
            gdf = gdf.rename(columns={"class": "class_"})
        flat[layer] = _flat_features(layer, gdf)

    aoi_tiles = set(grid.tiles_covering(config.PILOT_AOI_BBOX))
    tiles = sorted(aoi_tiles | set(tile_of.values()))  # ADR-0022 point 5
    ax0, ay0, ax1, ay1 = config.PILOT_AOI_BBOX
    extent_box = box(ax0 - config.ORIGIN_E, ay0 - config.ORIGIN_N, ax1 - config.ORIGIN_E,
                     ay1 - config.ORIGIN_N)
    summary_tiles = {}
    seen_buildings: dict[str, str] = {}
    duplicates = []
    for i, j in tiles:
        name = grid.tile_name(i, j)
        tbox = box(*grid.tile_bbox_local(i, j))
        fbox = tbox.intersection(extent_box)  # flat layers: processed extent and tile
        centre = (
            grid.TILE_SIZE_M * i + grid.TILE_SIZE_M / 2,
            -(grid.TILE_SIZE_M * j + grid.TILE_SIZE_M / 2),
        )
        meshes, tables, layer_stats = [], {}, {}
        max_h = 0.0

        # Buildings
        mb = geom.MeshBuilder()
        table = []
        n_vols = 0
        for b in rendered.itertuples(index=False):
            if tile_of[b.building_key] != (i, j):
                continue
            if b.building_key in seen_buildings:
                duplicates.append(b.building_key)
            seen_buildings[b.building_key] = name
            fid = len(table)
            table.append(
                {
                    "key": b.building_key,
                    "name": _clean(b.name),
                    "building_type": _clean(b.building_type),
                    "height_m": _clean(b.height_m),
                    "height_source": _clean(b.height_source),
                    "landmark_id": _clean(b.landmark_id),
                }
            )
            for v in vols_by_building.get(b.building_key, []):
                for p in geom.polygons_of(_to_local(v.geometry)):
                    parts, h = geom.simplify_footprint(p)
                    max_h = max(max_h, h)
                    for part in parts:
                        mb.add_extrusion(part, float(v.bottom_m), float(v.top_m), fid)
                n_vols += 1
        if table:
            meshes.extend(_named("buildings", mb))
            tables["buildings"] = table
            layer_stats["buildings"] = {
                "features": len(table),
                "volumes": n_vols,
                "vertices": mb.n_vertices,
                "triangles": mb.n_triangles,
            }

        # Flat layers
        for layer in FLAT_LAYERS:
            mf = geom.MeshBuilder()
            table = []
            for f in flat[layer]:
                clipped = [] if fbox.is_empty else _clip_polys(f["polys"], fbox)
                if not clipped:
                    continue
                fid = len(table)
                before = mf.n_vertices
                for p in clipped:
                    mf.add_flat(p, style.LAYER_HEIGHT_M[layer], fid)
                if mf.n_vertices > before:
                    table.append(f["entry"])
            if table:
                meshes.extend(_named(layer, mf))
                tables[layer] = table
                layer_stats[layer] = {
                    "features": len(table),
                    "vertices": mf.n_vertices,
                    "triangles": mf.n_triangles,
                }

        n_features = sum(len(t) for t in tables.values())
        blob = glb.write_glb(meshes, centre, n_features) if meshes else b""
        sample = _sample(meshes)
        (out_dir / f"{name}.glb").write_bytes(blob)
        (out_dir / f"{name}.json").write_bytes(_json_bytes({"tile": name, "layers": tables}))
        gz = len(gzip.compress(blob, 9, mtime=0))
        try:
            import brotli

            br = len(brotli.compress(blob))
        except ImportError:
            br = None
        summary_tiles[name] = {
            "glb_bytes": len(blob),
            "gzip9_bytes": gz,
            "brotli_bytes": br,
            "over_gzip_budget": gz > BUDGET_GZIP_BYTES,
            "max_hausdorff_m": round(max_h, 6),
            "gzip9_baseline_t22": BASELINE_GZIP9.get(name),
            "features": n_features,
            "meshes": [m["name"] for m in meshes],
            "centre_client_m": list(centre),
            "position_sample": sample,
            "layers": layer_stats,
        }

    per_tile_buildings = sum(
        t["layers"].get("buildings", {}).get("features", 0) for t in summary_tiles.values()
    )
    summary = {
        "extent": "pilot",
        "budget_gzip_bytes": BUDGET_GZIP_BYTES,
        "tiles": summary_tiles,
        "totals": {
            "glb_bytes": sum(t["glb_bytes"] for t in summary_tiles.values()),
            "gzip9_bytes": sum(t["gzip9_bytes"] for t in summary_tiles.values()),
            "max_hausdorff_m": max(t["max_hausdorff_m"] for t in summary_tiles.values()),
        },
        "checks": {
            "buildings_total_in_layer": n_buildings_total,
            "buildings_rendered": len(rendered),
            "buildings_in_tiles": per_tile_buildings,
            "buildings_count_matches": per_tile_buildings == len(rendered),
            "buildings_in_two_tiles": sorted(set(duplicates)),
            "rendered_volumes_without_rendered_building": len(stray),
            "tiles_outside_pilot_aoi": sorted(
                grid.tile_name(*t) for t in tiles if t not in aoi_tiles
            ),
        },
    }
    (summary_dir / "export_summary.json").write_bytes(_json_bytes(summary))
    (summary_dir / "export_summary.md").write_text(
        _markdown(summary), encoding="utf-8", newline="\n"
    )
    return summary


def _markdown(s: dict) -> str:
    lines = ["# Tile export summary (T-2.2, T-2.2a)", ""]
    lines.append("| tile | layer | features | vertices | triangles |")
    lines.append("|---|---|---:|---:|---:|")
    for name, t in s["tiles"].items():
        for layer, st in t["layers"].items():
            lines.append(
                f"| {name} | {layer} | {st['features']} | {st['vertices']} | {st['triangles']} |"
            )
    lines += [
        "",
        "| tile | glb bytes | gzip-9 before (T-2.2) | gzip-9 after | brotli bytes "
        "| max Hausdorff m | gzip > 250 KB |",
    ]
    lines.append("|---|---:|---:|---:|---:|---:|---|")
    for name, t in s["tiles"].items():
        br = t["brotli_bytes"] if t["brotli_bytes"] is not None else "n/a"
        lines.append(
            f"| {name} | {t['glb_bytes']} | {t['gzip9_baseline_t22'] or 'n/a'} | "
            f"{t['gzip9_bytes']} | {br} | "
            f"{t['max_hausdorff_m']} | {'YES' if t['over_gzip_budget'] else 'no'} |"
        )
    tot = s["totals"]
    lines += [
        "",
        (
            f"Total: glb {tot['glb_bytes']} bytes, gzip-9 {tot['gzip9_bytes']} bytes, "
            f"max Hausdorff {tot['max_hausdorff_m']} m. "
            f"Budget per tile: {s['budget_gzip_bytes']} bytes gzip."
        ),
        "",
        "## Checks",
        "",
    ]
    for k, v in s["checks"].items():
        lines.append(f"- {k}: {v}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--extent", default="pilot")
    args = ap.parse_args(argv)
    s = build(args.extent)
    print(f"tiles: {', '.join(s['tiles'])}")
    print(f"checks: {s['checks']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
