"""Export processed/pilot.gpkg to one .glb plus one feature table per tile, and tiles.json (T-2.3).

Run: ``python -m milano_iso.tiles.export --extent pilot``
Rules: ADR-0021 (tile scheme), ADR-0022 (compact encoding, all buildings exported), ADR-0016. Deterministic: sorted
iteration, no timestamps, JSON with sorted keys.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely import affinity
from shapely.geometry import box

from milano_iso import config, landmark_details, landmark_style, style
from milano_iso import extent as extent_mod
from milano_iso.measure import report_counts
from milano_iso.tiles import geom, glb, grid, lod, manifest, minimap
from milano_iso.tiles import index as search_index

SUMMARY_DIR = config.REPO_ROOT / "reports" / "artifacts" / "T-2.3"
METRIC_CRS = 32632
GPKG_NAME = "pilot.gpkg"
BUDGET_GZIP_BYTES = 256_000  # ADR-0022, docs/VERIFICATION.md section 5
SAMPLE_VERTICES = 128  # per tile, written to the summary for the client position check
FLAT_LAYERS = ("landuse", "green", "water", "road_areas", "roads", "markings", "rail")
# Instanced layers (T-4.1): no mesh in the glb. Their per-tile feature table rows carry the
# position (x, z in client metres) of each instance; the client draws them as one InstancedMesh.
INSTANCED_LAYERS = ("trees",)
# T-4.2: stylised landmark details, one mesh per tile that has any; every row has stylised = true.
DETAIL_LAYER = "landmark_details"
# Feature-table columns per flat layer (osm_type, osm_id and the class or kind).
FLAT_FIELDS = {
    "landuse": ("osm_type", "osm_id", "kind"),
    "green": ("osm_type", "osm_id", "kind"),
    "water": ("osm_type", "osm_id", "kind"),
    "road_areas": ("osm_type", "osm_id", "class"),
    "roads": ("osm_type", "osm_id", "class"),
    "markings": ("osm_type", "osm_id", "kind", "stylised"),
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
        if layer == "markings":
            entry["stylised"] = bool(row.stylised)
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
            # "geom" (local line or polygon) is for the minimap only; it never reaches a table
            out.append({"entry": entry, "polys": polys, "geom": gl})
    return out


def _tree_tables(trees: gpd.GeoDataFrame) -> dict[tuple[int, int], list[dict]]:
    """Feature-table rows of the trees, per tile (by the tile the point falls in).

    Row order: mapped trees by (osm_type, osm_id), then fill trees in layer order (the order the
    pipeline wrote them). x and z are client-frame metres (x = E - E0, z = -(N - N0)) to 1 cm.
    """
    out: dict[tuple[int, int], list[dict]] = {}
    for r in trees.itertuples(index=False):
        p = r.geometry
        ij = grid.tile_ij(p.x, p.y)
        out.setdefault(ij, []).append(
            {
                "osm_type": _clean(r.osm_type),
                "osm_id": None if pd.isna(r.osm_id) else int(r.osm_id),
                "source": _clean(r.source),
                "decorative": bool(r.decorative),
                "height_m": _clean(r.height_m),
                "height_source": _clean(r.height_source),
                "x": round(p.x - config.ORIGIN_E, 2) + 0.0,
                "z": round(-(p.y - config.ORIGIN_N), 2) + 0.0,
            }
        )
    return out


def _collect_details(specs, rendered, vols, gpkg) -> tuple[list, dict, dict]:
    """STYLISED details (T-4.2) of every spec whose landmark is in the data, plus a report.

    A landmark's volumes are the rendered DBT volumes of the rendered buildings that carry its
    ``landmark_id``. A spec without any (out-of-pilot landmarks, Phase 6) is skipped and reported.
    The third result is {landmark id: local roof footprint} of the roof landmarks (T-5.3a: the
    Galleria has no rendered building of its own, so the index takes its extent from the roof).
    A spec with a ``roof`` source (the Galleria) takes the OSM footprint named by the spec and the
    rendered volumes next to it; the footprint must be exactly one row, and the adjacent volumes
    must exist, or the build fails (the card's escalation rule).
    """
    all_vols = [
        landmark_details.Volume(v.vol_key, _to_local(v.geometry), float(v.bottom_m), float(v.top_m))
        for v in vols.itertuples(index=False)
    ]
    by_building: dict[str, list] = {}
    for v, lv in zip(vols.itertuples(index=False), all_vols, strict=True):
        by_building.setdefault(v.building_key, []).append(lv)
    details: list = []
    report: dict = {}
    roof_footprints: dict = {}
    osm_buildings = None
    for lid in sorted(specs):
        spec = specs[lid]
        own_keys = sorted(rendered.loc[rendered["landmark_id"] == lid, "building_key"])
        own = [lv for k in own_keys for lv in by_building.get(k, [])]
        if spec.roof is not None:
            if osm_buildings is None:
                osm_buildings = _read(gpkg, "osm_buildings")
            r = spec.roof
            sel = osm_buildings[
                (osm_buildings["osm_type"] == r.osm_type) & (osm_buildings["osm_id"] == r.osm_id)
            ]
            if len(sel) != 1:
                raise ValueError(
                    f"{lid}: roof footprint {r.osm_type}{r.osm_id} gives {len(sel)} rows"
                )
            roof_geom = _to_local(sel.geometry.iloc[0])
            roof_footprints[lid] = roof_geom
            adj = landmark_details.adjacent_volumes(roof_geom, all_vols, r)
            adj_ids = {id(a) for a in adj}
            owners = sorted(
                {k for k, lvs in by_building.items() for lv in lvs if id(lv) in adj_ids}
            )
            if len(owners) != 1:
                raise ValueError(
                    f"{lid}: the volumes next to the roof belong to {len(owners)} buildings {owners}"
                )
            d, facts = landmark_details.build_landmark(spec, own, roof_geom, adj)
            facts["adjacent_building"] = owners[0]
            facts["roof_area_m2"] = round(float(roof_geom.area), 1)
        elif own:
            d, facts = landmark_details.build_landmark(spec, own)
        else:
            report[lid] = {"details": 0, "skipped": "no rendered volumes (out of the pilot)"}
            continue
        kinds: dict[str, int] = {}
        for x in d:
            kinds[x.kind] = kinds.get(x.kind, 0) + 1
        report[lid] = {"details": len(d), "kinds": dict(sorted(kinds.items())), **facts}
        details += d
    return details, report, roof_footprints


def _detail_tables(details) -> dict[tuple[int, int], list]:
    """Details per tile, by the tile of each detail's anchor (local metres)."""
    out: dict[tuple[int, int], list] = {}
    for d in details:
        ij = grid.tile_ij(d.anchor[0] + config.ORIGIN_E, d.anchor[1] + config.ORIGIN_N)
        out.setdefault(ij, []).append(d)
    return out


def _names(named: gpd.GeoDataFrame) -> dict[tuple[str, int], str]:
    """{(osm_type, osm_id): name} from the named_features layer (non-empty names only)."""
    out = {}
    for r in named.itertuples(index=False):
        if isinstance(r.name, str) and r.name.strip() != "":
            out[(r.osm_type, int(r.osm_id))] = r.name
    return out


def _clip_polys(polys, tile_box) -> list:
    out = []
    for p in polys:
        if not shapely.intersects(p, tile_box):
            continue
        out.extend(geom.polygons_of(p.intersection(tile_box)))
    return out


class _FlatIndex:
    """Spatial index of one flat layer: which polygons of which features meet a tile box.

    ``features(box)`` returns [(feature, polygons)] in feature order, polygons in their order,
    only those that intersect ``box``: the same pieces, in the same order, as testing every
    polygon of every feature (T-6.1: the full-city export cannot afford that per tile).
    """

    def __init__(self, features: list[dict]):
        self.features = features
        owner, polys = [], []
        for fi, f in enumerate(features):
            for p in f["polys"]:
                owner.append(fi)
                polys.append(p)
        self.owner = np.asarray(owner, dtype=np.int64)
        self.polys = polys
        self.tree = shapely.STRtree(polys) if polys else None

    def features_in(self, tile_box) -> list[tuple[dict, list]]:
        if self.tree is None:
            return []
        hits = np.sort(self.tree.query(tile_box, predicate="intersects"))
        out: list[tuple[dict, list]] = []
        last = -1
        for h in hits:
            fi = int(self.owner[h])
            if fi != last:
                out.append((self.features[fi], []))
                last = fi
            out[-1][1].append(self.polys[int(h)])
        return out


def _named(layer: str, mb: geom.MeshBuilder) -> list[dict]:
    """Chunks of a builder as meshes: `<layer>`, or `<layer>#<n>` when split."""
    chunks = mb.to_gl_chunks()
    if len(chunks) == 1:
        return [{"name": layer, **chunks[0]}]
    return [{"name": f"{layer}#{n}", **c} for n, c in enumerate(chunks)]


def _max_offset(meshes: list[dict], centre: tuple[float, float]) -> float:
    """Largest absolute coordinate offset from the tile centre (x, z; y from 0), in metres."""
    if not meshes:
        return 0.0
    c = np.array([centre[0], 0.0, centre[1]])
    return float(max(np.abs(m["positions"] - c).max() for m in meshes))


def _content_bbox(
    meshes: list[dict], centre: tuple[float, float], unit: float = glb.QUANT_SCALE
) -> dict:
    """Extent of the dequantised vertices (what the client decodes), client frame, metres.

    Whole buildings may overhang the tile cell (ADR-0022 point 5), so the grid cell is not a
    bound of the content. Rounded to 3 decimals (the quantisation unit is 0.02 m).
    """
    pts = np.concatenate(
        [glb.dequantise(glb.quantise(m["positions"], centre, unit), centre, unit) for m in meshes]
    )
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    return {
        "min": [round(float(v), 3) + 0.0 for v in lo],
        "max": [round(float(v), 3) + 0.0 for v in hi],
    }


def _sample(meshes: list[dict]) -> list[dict]:
    """Evenly spaced vertices with their float64 client-frame coordinates (metres)."""
    owners = [(m["name"], v) for m in meshes for v in range(len(m["positions"]))]
    if not owners:
        return []
    by_name = {m["name"]: m for m in meshes}
    picks = np.unique(
        np.linspace(0, len(owners) - 1, min(SAMPLE_VERTICES, len(owners))).astype(int)
    )
    out = []
    for p in picks:
        name, v = owners[int(p)]
        out.append(
            {"mesh": name, "vertex": v, "xyz": [float(c) for c in by_name[name]["positions"][v]]}
        )
    return out


def write_tile(
    out_dir,
    name,
    i,
    j,
    meshes,
    tables,
    layer_stats,
    centre,
    unit=glb.QUANT_SCALE,
    size=config.TILE_SIZE_M,
):
    """Write ``<name>.glb`` and ``<name>.json``; return (manifest entry, glb bytes).

    ``unit`` and ``size`` are the quantisation unit and the cell size (coarse levels, T-6.2).

    A tile without meshes writes nothing and returns None: never a 0-byte .glb (T-2.5).
    """
    if not meshes:
        return None
    n_features = sum(len(t) for t in tables.values())
    blob = glb.write_glb(meshes, centre, n_features, unit)
    (out_dir / f"{name}.glb").write_bytes(blob)
    (out_dir / f"{name}.json").write_bytes(_json_bytes({"tile": name, "layers": tables}))
    entry = manifest.tile_entry(
        out_dir,
        name,
        i,
        j,
        {k: v["features"] for k, v in layer_stats.items()},
        _content_bbox(meshes, centre, unit),
        size,
    )
    return entry, blob


def build(
    extent: str = "pilot",
    out_dir: Path | None = None,
    summary_dir: Path | None = None,
    specs: dict | None = None,
    landmark_names: dict[str, str] | None = None,
    levels: tuple | None = None,
):
    """Build the tiles of an extent. ``levels``: the coarse levels (default ``lod.LEVELS``; ``()``
    writes the base tiles only, as the visual-regression fixture does)."""
    levels = lod.LEVELS if levels is None else levels
    minimap_lite = extent != "pilot"  # T-6.2: the city minimap is the light one (minimap.render)
    extent_poly = extent_mod.polygon(extent)
    bbox = extent_mod.bbox(extent)
    gpkg = extent_mod.processed_gpkg(extent)
    out_dir = out_dir or extent_mod.tiles_dir(extent)
    summary_dir = summary_dir or extent_mod.artifact_dir(extent, SUMMARY_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in sorted([*out_dir.glob("*.glb"), *out_dir.glob("*.json"), *out_dir.glob("*.svg")]):
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
    buildings_of_tile: dict[tuple[int, int], list] = {}
    for b in rendered.itertuples(index=False):
        rp = b.geometry.representative_point()
        tile_of[b.building_key] = grid.tile_ij(rp.x, rp.y)
        buildings_of_tile.setdefault(tile_of[b.building_key], []).append(b)

    flat = {}
    platform_ways: set[tuple[str, int]] = set()  # ADR-0033: never part of a street entry
    for layer in FLAT_LAYERS:
        gdf = _read(gpkg, layer)
        if layer == "roads" and "is_platform" in gdf.columns:
            platform_ways = {
                (r.osm_type, int(r.osm_id))
                for r in gdf.itertuples(index=False)
                if bool(r.is_platform)
            }
        if "class" in gdf.columns:
            gdf = gdf.rename(columns={"class": "class_"})
        flat[layer] = _flat_features(layer, gdf)
    flat_index = {layer: _FlatIndex(flat[layer]) for layer in FLAT_LAYERS}
    names = _names(_read(gpkg, "named_features"))
    if landmark_names is None:
        landmark_names = search_index.load_landmark_names()
    # rendered pieces of the named streets, green and water areas, for index.json (T-5.3a)
    named_pieces: dict[tuple[str, str, int], dict] = {}
    trees_gdf = _read(gpkg, "trees")
    trees_by_tile = _tree_tables(trees_gdf)

    details, detail_report, roof_footprints = _collect_details(
        landmark_style.SPECS if specs is None else specs, rendered, vols, gpkg
    )
    details_by_tile = _detail_tables(details)

    shapely.prepare(extent_poly)
    aoi_tiles = {
        t
        for t in grid.tiles_covering(bbox)
        if shapely.intersects(extent_poly, box(*grid.tile_bbox(*t)))
    }
    tiles = sorted(aoi_tiles | set(tile_of.values()) | set(details_by_tile))  # ADR-0022 point 5
    ax0, ay0, ax1, ay1 = bbox
    extent_box = box(
        ax0 - config.ORIGIN_E, ay0 - config.ORIGIN_N, ax1 - config.ORIGIN_E, ay1 - config.ORIGIN_N
    )
    summary_tiles = {}
    entries = []
    index_buildings = []
    seen_buildings: dict[str, str] = {}
    duplicates = []
    for i, j in tiles:
        name = grid.tile_name(i, j)
        tbox = box(*grid.tile_bbox_local(i, j))
        fbox = tbox.intersection(extent_box)  # flat layers: processed extent and tile
        centre = (
            config.TILE_SIZE_M * i + config.TILE_SIZE_M / 2,
            -(config.TILE_SIZE_M * j + config.TILE_SIZE_M / 2),
        )
        meshes, tables, layer_stats = [], {}, {}
        max_h = 0.0

        # Buildings
        mb = geom.MeshBuilder()
        table = []
        n_vols = 0
        for b in buildings_of_tile.get((i, j), []):
            if b.building_key in seen_buildings:
                duplicates.append(b.building_key)
            seen_buildings[b.building_key] = name
            index_buildings.append(
                {
                    "key": b.building_key,
                    "name": _clean(b.name),
                    "landmark_id": _clean(b.landmark_id),
                    "geom": _to_local(b.geometry),
                    "tile": name,
                }
            )
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
            hits = [] if fbox.is_empty else flat_index[layer].features_in(fbox)
            for f, hit_polys in hits:
                clipped = _clip_polys(hit_polys, fbox)
                if not clipped:
                    continue
                fid = len(table)
                before = mf.n_vertices
                for p in clipped:
                    mf.add_flat(p, style.LAYER_HEIGHT_M[layer], fid)
                if mf.n_vertices > before:
                    table.append(f["entry"])
                    pkey = (f["entry"]["osm_type"], f["entry"]["osm_id"])
                    if layer in ("roads", "green", "water") and pkey in names:
                        piece = named_pieces.setdefault(
                            (layer, *pkey),
                            {
                                "geoms": [],
                                "tiles": set(),
                                "name": names[pkey],
                                "platform": layer == "roads" and pkey in platform_ways,
                            },
                        )
                        piece["geoms"].extend(clipped)
                        piece["tiles"].add(name)
            if table:
                meshes.extend(_named(layer, mf))
                tables[layer] = table
                layer_stats[layer] = {
                    "features": len(table),
                    "vertices": mf.n_vertices,
                    "triangles": mf.n_triangles,
                }

        # Landmark details (T-4.2): STYLISED; one row per detail, `stylised` is always true.
        tile_details = details_by_tile.get((i, j), [])
        if tile_details:
            md = geom.MeshBuilder()
            table = []
            for d in tile_details:
                fid = len(table)
                md.add_triangles(d.tris, fid)
                table.append({"landmark_id": d.landmark_id, "detail": d.kind, "stylised": True})
            meshes.extend(_named(DETAIL_LAYER, md))
            tables[DETAIL_LAYER] = table
            layer_stats[DETAIL_LAYER] = {
                "features": len(table),
                "vertices": md.n_vertices,
                "triangles": md.n_triangles,
            }

        trees = trees_by_tile.pop((i, j), [])
        if trees:
            tables["trees"] = trees
            layer_stats["trees"] = {"features": len(trees), "vertices": 0, "triangles": 0}

        written = write_tile(out_dir, name, i, j, meshes, tables, layer_stats, centre)
        if written is None:
            continue  # T-2.5: an empty tile is skipped (no file, not in the manifest)
        entry, blob = written
        sample = _sample(meshes)
        gz = entry["glb"]["gzip9_bytes"]
        try:
            import brotli

            br = len(brotli.compress(blob))
        except ImportError:
            br = None
        entries.append(entry)
        summary_tiles[name] = {
            "glb_bytes": len(blob),
            "gzip9_bytes": gz,
            "brotli_bytes": br,
            "over_gzip_budget": gz > BUDGET_GZIP_BYTES,
            "max_hausdorff_m": round(max_h, 6),
            "max_offset_from_centre_m": round(_max_offset(meshes, centre), 3),
            "features": sum(len(t) for t in tables.values()),
            "meshes": [m["name"] for m in meshes],
            "centre_client_m": list(centre),
            "position_sample": sample,
            "layers": layer_stats,
        }

    streets, areas = [], []
    for (layer, osm_type, osm_id), piece in sorted(named_pieces.items()):
        rec = {"osm_type": osm_type, "osm_id": osm_id, **piece}
        if layer == "roads":
            streets.append(rec)
        else:
            areas.append({"kind": layer, **rec})
    roof_landmarks = [
        {
            "landmark_id": lid,
            "geom": geom,
            "tiles": sorted(
                grid.tile_name(*ij)
                for ij, ds in details_by_tile.items()
                if any(d.landmark_id == lid for d in ds)
            ),
        }
        for lid, geom in sorted(roof_footprints.items())
    ]
    index_entries = search_index.build_entries(
        index_buildings, streets, areas, landmark_names, roof_landmarks
    )
    coarse = []
    lod_dropped: list = []
    for level in levels:
        res = lod.build_level(
            level,
            out_dir=out_dir,
            rendered=rendered,
            vols_by_building=vols_by_building,
            flat=flat,
            flat_index=flat_index,
            extent_poly=extent_poly,
            extent_box=extent_box,
            bbox=bbox,
            to_local=_to_local,
        )
        coarse.append(res)
        lod_dropped += res["dropped"]
    index_path = out_dir / search_index.INDEX_NAME
    index_path.write_bytes(_json_bytes(search_index.index_document(index_entries)))

    boxes = [
        (
            e["content_bbox_local"]["min"][0],
            e["content_bbox_local"]["min"][2],
            e["content_bbox_local"]["max"][0],
            e["content_bbox_local"]["max"][2],
        )
        for e in entries
    ]
    polys_of = {layer: [p for f in flat[layer] for p in f["polys"]] for layer in ("water", "green")}
    minimap_path = out_dir / minimap.MINIMAP_NAME
    minimap_path.write_bytes(
        minimap.render(
            minimap.viewbox_of(boxes),
            polys_of["water"],
            polys_of["green"],
            [r["geom"] for r in index_buildings],
            [(f["entry"]["class"], f["geom"]) for f in flat["roads"]],
            lite=minimap_lite,
        )
    )

    manifest.write_manifest(
        out_dir,
        manifest.build_manifest(
            entries,
            ["buildings", *FLAT_LAYERS, DETAIL_LAYER, *INSTANCED_LAYERS],
            list(INSTANCED_LAYERS),
            index=manifest.file_entry(index_path),
            minimap=manifest.file_entry(minimap_path),
            levels=[lod.base_level(), *(c["manifest"] for c in coarse)] if coarse else None,
        ),
    )
    n_trees_in_tiles = sum(
        t["layers"].get("trees", {}).get("features", 0) for t in summary_tiles.values()
    )
    per_tile_buildings = sum(
        t["layers"].get("buildings", {}).get("features", 0) for t in summary_tiles.values()
    )
    summary = {
        "extent": extent,
        "budget_gzip_bytes": BUDGET_GZIP_BYTES,
        "tiles": summary_tiles,
        "landmark_details": detail_report,
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
            "landmark_details_in_tiles": sum(
                t["layers"].get(DETAIL_LAYER, {}).get("features", 0) for t in summary_tiles.values()
            ),
            "landmark_details_built": len(details),
            "trees_in_layer": len(trees_gdf),
            "trees_in_tiles": n_trees_in_tiles,
            "trees_count_matches": n_trees_in_tiles == len(trees_gdf),
            "buildings_in_two_tiles": sorted(set(duplicates)),
            "rendered_volumes_without_rendered_building": len(stray),
            "tiles_outside_pilot_aoi": sorted(
                grid.tile_name(*t) for t in tiles if t not in aoi_tiles
            ),
        },
    }
    if coarse:
        # T-6.2: separate files, so export_summary.json keeps its shape
        (summary_dir / "lod_summary.json").write_bytes(
            _json_bytes({"extent": extent, "levels": [c["summary"] for c in coarse]})
        )
        (summary_dir / "lod_summary.md").write_text(
            lod_markdown(coarse), encoding="utf-8", newline="\n"
        )
        (summary_dir / "lod_dropped_buildings.csv").write_bytes(lod.dropped_csv(lod_dropped))
    (summary_dir / "export_summary.json").write_bytes(_json_bytes(summary))
    (summary_dir / "export_summary.md").write_text(
        _markdown(summary), encoding="utf-8", newline="\n"
    )
    return summary


def lod_markdown(coarse: list[dict]) -> str:
    lines = ["# Coarse levels (T-6.2)", ""]
    lines += [
        (
            "| level | block m | tolerance m | blocks | buildings in | kept | dropped | "
            "max error bound m | max block gzip-9 | total gzip-9 |"
        ),
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for c in coarse:
        s, m = c["summary"], c["manifest"]
        lines.append(
            f"| {s['level']} | {s['block_m']} | {s['tolerance_m']} | {m['totals']['tiles']} | "
            f"{s['buildings_in']} | {s['buildings_kept']} | {s['buildings_dropped']} | "
            f"{s['max_error_bound_m']} | {s['max_gzip9_bytes']} | {m['totals']['gzip9_bytes']} |"
        )
    return "\n".join(lines) + "\n"


def _markdown(s: dict) -> str:
    lines = ["# Tile export summary (T-2.3)", ""]
    lines.append("| tile | layer | features | vertices | triangles |")
    lines.append("|---|---|---:|---:|---:|")
    for name, t in s["tiles"].items():
        for layer, st in t["layers"].items():
            lines.append(
                f"| {name} | {layer} | {st['features']} | {st['vertices']} | {st['triangles']} |"
            )
    lines += [
        "",
        ("| tile | glb bytes | gzip-9 bytes | brotli bytes | max Hausdorff m | gzip > budget |"),
    ]
    lines.append("|---|---:|---:|---:|---:|---|")
    for name, t in s["tiles"].items():
        br = t["brotli_bytes"] if t["brotli_bytes"] is not None else "n/a"
        lines.append(
            f"| {name} | {t['glb_bytes']} | {t['gzip9_bytes']} | {br} | "
            f"{t['max_hausdorff_m']} | {'YES' if t['over_gzip_budget'] else 'no'} |"
        )
    tot = s["totals"]
    worst = max(t["max_offset_from_centre_m"] for t in s["tiles"].values())
    lines += [
        "",
        (
            f"Worst offset from a tile centre: {worst} m; int16 range +/-655.34 m "
            f"(2 cm unit), headroom {round(655.34 - worst, 3)} m."
        ),
    ]
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
    ap.add_argument("--extent", choices=list(extent_mod.EXTENTS), default="pilot")
    args = ap.parse_args(argv)
    s = build(args.extent)
    report_counts(
        **{
            "in": s["checks"]["buildings_rendered"] + s["checks"]["trees_in_layer"],
            "out": sum(t["features"] for t in s["tiles"].values()),
            "tiles": len(s["tiles"]),
        }
    )
    print(f"tiles: {', '.join(s['tiles'])}")
    print(f"checks: {s['checks']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
