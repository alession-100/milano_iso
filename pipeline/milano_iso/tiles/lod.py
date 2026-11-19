"""Coarse levels of detail (T-6.2, ADR-0037): the same data as the base tiles, in bigger blocks.

A level is a block size, a tolerance and a list of what it keeps. The client shows a level only
where its error is at most one screen pixel, i.e. where metres per pixel >= the level's tolerance,
so ``tolerance_m`` is the contract: every polygon a coarse tile keeps lies within ``tolerance_m``
(Hausdorff) of the polygon of the base tiles in the plan, and heights within ``height_step_m / 2``.

What a level may do to the data, and only this:
  * simplify polygon outlines (Douglas-Peucker, topology kept: vertices are a subset of the snapped
    input, nothing is added or moved by more than the tolerance);
  * merge the volumes of one building whose bottom and top fall in the same vertical step into one
    prism (the heights are rounded to the step, an error of at most half of it; an invisible join
    disappears, a visible step between two heights stays);
  * drop a polygon piece whose bounding box is not larger than the tolerance (under one pixel);
  * drop a building whose footprint is under ``building_min_area_m2``, unless it is named, a
    landmark or at least ``keep_height_m`` tall (every dropped key is logged with its reason);
  * drop flat layers, road classes and flat pieces under ``flat_min_area_m2``;
  * drop trees, road markings and landmark details (smaller than a pixel at these scales).
Buildings keep their keys and every feature-table field of the base tile.

Platform independence (CLAUDE.md lessons): every polygon is snapped to the level's grid
(``shapely.set_precision``) and rebuilt from integer grid steps with a fixed ring orientation and
start vertex, and pieces are sorted, so union, intersection and simplification (which may return the
same ring from another vertex on another platform) cannot change the triangulation or the bytes.
"""

from dataclasses import dataclass, field

import shapely
from shapely.geometry import Polygon, box

from milano_iso import config, style
from milano_iso.tiles import geom, glb, grid

BASE_TOLERANCE_M = geom.SIMPLIFY_TOLERANCE_M
COARSE_FLAT_LAYERS = ("landuse", "green", "water", "road_areas", "roads", "rail")


@dataclass(frozen=True)
class Level:
    level: int
    block_m: int
    tolerance_m: float
    unit_m: float  # int16 quantisation unit of the glb (the base is 0.02 m, ADR-0022 2a)
    building_min_area_m2: float
    keep_height_m: float
    height_step_m: float  # vertical tolerance: heights are rounded to it when volumes are merged
    flat_min_area_m2: float
    road_classes: tuple[str, ...]
    rail_classes: tuple[str, ...] = ("rail",)
    flat_layers: tuple[str, ...] = field(default=COARSE_FLAT_LAYERS)

    @property
    def prefix(self) -> str:
        return f"L{self.level}"

    def describe(self) -> dict:
        """What the level keeps, for tiles.json (sorted keys on write)."""
        return {
            "level": self.level,
            "block_m": self.block_m,
            "tolerance_m": self.tolerance_m,
            "unit_m": self.unit_m,
            "keeps": {
                "building_min_area_m2": self.building_min_area_m2,
                "building_keep_height_m": self.keep_height_m,
                "building_keep_named_and_landmarks": True,
                "height_step_m": self.height_step_m,
                "flat_layers": list(self.flat_layers),
                "flat_min_area_m2": self.flat_min_area_m2,
                "road_classes": list(self.road_classes),
                "rail_classes": list(self.rail_classes),
                "dropped_layers": ["markings", "trees", "landmark_details"],
            },
        }


STREET_CLASSES = ("motorway", "trunk", "primary", "secondary", "tertiary")
LOCAL_CLASSES = ("residential", "unclassified", "living_street", "pedestrian")

# Chosen from the measurements in reports/artifacts/T-6.2/ (ADR-0037).
LEVELS: tuple[Level, ...] = (
    Level(
        level=1,
        block_m=500,
        tolerance_m=1.0,
        unit_m=0.02,
        building_min_area_m2=20.0,
        keep_height_m=40.0,
        height_step_m=2.0,
        flat_min_area_m2=4.0,
        road_classes=STREET_CLASSES + LOCAL_CLASSES,
    ),
    Level(
        level=2,
        block_m=1000,
        tolerance_m=2.0,
        unit_m=0.04,
        building_min_area_m2=40.0,
        keep_height_m=40.0,
        height_step_m=4.0,
        flat_min_area_m2=16.0,
        road_classes=STREET_CLASSES + LOCAL_CLASSES,
    ),
    Level(
        level=3,
        block_m=2000,
        tolerance_m=5.0,
        unit_m=0.04,
        building_min_area_m2=300.0,
        keep_height_m=40.0,
        height_step_m=10.0,
        flat_min_area_m2=100.0,
        road_classes=STREET_CLASSES,
        rail_classes=(),
        flat_layers=("landuse", "green", "water", "roads"),
    ),
)


def base_level() -> dict:
    return {
        "level": 0,
        "block_m": config.TILE_SIZE_M,
        "tolerance_m": BASE_TOLERANCE_M,
        "unit_m": glb.QUANT_SCALE,
    }


def snap(g, unit: float):
    """Snap to the grid of ``unit`` metres (local frame), validity kept."""
    return shapely.set_precision(g, unit)


def _int_ring(coords, unit: float, exterior: bool) -> list[tuple[int, int]] | None:
    """Ring as integer grid steps: no repeated points, fixed orientation and start vertex."""
    pts: list[tuple[int, int]] = []
    for x, y in coords:
        p = (round(float(x) / unit), round(float(y) / unit))
        if not pts or pts[-1] != p:
            pts.append(p)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    if len(pts) < 3:
        return None
    n = len(pts)
    area2 = sum(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1] for k in range(n))
    if area2 == 0:
        return None
    if (area2 > 0) != exterior:
        pts.reverse()
    k = pts.index(min(pts))
    return pts[k:] + pts[:k]


def canonical(poly: Polygon, unit: float) -> Polygon | None:
    """The polygon on the grid, rings with a fixed orientation and start vertex (or None)."""
    ext = _int_ring(poly.exterior.coords, unit, True)
    if ext is None:
        return None
    holes = sorted(
        h for h in (_int_ring(r.coords, unit, False) for r in poly.interiors) if h is not None
    )

    def xy(ring):
        return [(x * unit, y * unit) for x, y in ring]

    return Polygon(xy(ext), [xy(h) for h in holes])


def _canonical_sorted(polys, unit: float) -> list[Polygon]:
    keyed = []
    for p in polys:
        c = canonical(p, unit)
        if c is not None and c.is_valid and c.area > geom.MIN_AREA_M2:
            keyed.append((tuple(c.exterior.coords), c))
    keyed.sort(key=lambda t: t[0])
    return [c for _, c in keyed]


def _simplified(poly: Polygon, level: Level):
    """Douglas-Peucker with the tolerance minus the snapping slack, so the sum stays within it."""
    s = shapely.simplify(poly, level.tolerance_m - level.unit_m, preserve_topology=True)
    return poly if (s.is_empty or not s.is_valid) else s


def _checked_simplification(q: Polygon, level: Level):
    """Simplify, then measure; tighten the tolerance in steps until the measured distance fits.

    The topology-preserving simplifier does not always keep every vertex within its tolerance of the
    result (a ring start, a hole), so the distance is measured, not assumed.
    """
    limit = level.tolerance_m - level.unit_m
    for factor in (1.0, 0.75, 0.5, 0.25):
        s = shapely.simplify(q, limit * factor, preserve_topology=True)
        if s.is_empty or not s.is_valid:
            break
        d = boundary_distance(q, s)
        if d <= limit:
            return s, d
    return q, 0.0


def boundary_distance(a, b) -> float:
    """Largest distance from a vertex of ``a`` to the boundary of ``b``, and the other way round.

    Exact for Douglas-Peucker output: between two vertices the distance to a segment is convex, so
    its maximum is at a vertex (shapely.hausdorff_distance compares vertices with vertices and
    overstates it).
    """
    out = 0.0
    for p, q in ((a, b), (b, a)):
        pts = shapely.points(shapely.get_coordinates(p))
        out = max(out, float(shapely.distance(pts, q.boundary).max()))
    return out


def coarse_parts(polys: list, level: Level) -> tuple[list[Polygon], float]:
    """(parts, error bound) of polygons that form one prism, simplified within the tolerance.

    The polygons are snapped, merged (union), canonicalised and simplified. The error bound is the
    distance between each merged piece and its simplification plus the grid unit (the snapping
    slack), checked against the tolerance. Pieces whose bounding box is not larger than the
    tolerance are dropped (under one pixel); the result may then be empty.
    """
    snapped = [snap(p, level.unit_m) for p in polys]
    merged = shapely.union_all(snapped) if len(snapped) > 1 else snapped[0]
    parts: list[Polygon] = []
    bound = 0.0
    for q in _canonical_sorted(geom.polygons_of(snap(merged, level.unit_m)), level.unit_m):
        x0, y0, x1, y1 = q.bounds
        if max(x1 - x0, y1 - y0) <= level.tolerance_m:
            continue
        simp, b = _checked_simplification(q, level)
        bound = max(bound, b + level.unit_m)
        parts.extend(geom.polygons_of(simp))
    if bound > level.tolerance_m:
        raise ValueError(
            f"error bound {bound:.3f} m exceeds the level tolerance {level.tolerance_m}"
        )
    return _canonical_sorted(parts, level.unit_m), bound


def prisms_of_building(vols: list, level: Level) -> tuple[list, int, float]:
    """Merged prisms of one building: ([(parts, bottom, top)], dropped pieces, error bound).

    ``vols``: (local polygon, bottom, top) per volume. Volumes whose bottom and top round to the
    same ``height_step_m`` (the vertical tolerance) are merged into one prism with the rounded
    heights; the others are kept as they are. A volume entirely below the ground plane (top at or
    below 0 after rounding) is never visible and is not drawn.
    """
    step = level.height_step_m
    groups: dict[tuple[float, float], list] = {}
    n_drop = 0
    for poly, bottom, top in vols:
        qb = round(bottom / step) * step
        qt = round(top / step) * step
        if qt <= 0:
            n_drop += 1
            continue
        if qt <= qb:
            qt = qb + step
        groups.setdefault((round(qb, 6), round(qt, 6)), []).append(poly)
    out, bound = [], 0.0
    for (qb, qt), polys in sorted(groups.items()):
        parts, b = coarse_parts(polys, level)
        bound = max(bound, b)
        if parts:
            out.append((parts, qb, qt))
        else:
            n_drop += 1
    return out, n_drop, bound


def keep_building(level: Level, row, area: float) -> tuple[bool, str]:
    """(kept, reason) for a rendered building row (name, landmark_id, height_m)."""
    if row.landmark_id is not None and row.landmark_id == row.landmark_id:
        return True, "landmark"
    if isinstance(row.name, str) and row.name.strip() != "":
        return True, "named"
    if float(row.height_m) >= level.keep_height_m:
        return True, "tall"
    if area >= level.building_min_area_m2:
        return True, "area"
    return False, f"footprint {area:.1f} m2 < {level.building_min_area_m2:g} m2"


def clip_flat(hit_polys, fbox, level: Level) -> list[Polygon]:
    """Clip to the block, snap, simplify, drop pieces under the level's minimum area."""
    from milano_iso.tiles import export as ex

    out = []
    for p in ex._clip_polys(hit_polys, fbox):
        s = snap(p, level.unit_m)
        if s.is_empty:
            continue
        for q in _canonical_sorted(geom.polygons_of(s), level.unit_m):
            for r in geom.polygons_of(_simplified(q, level)):
                if r.area >= level.flat_min_area_m2:
                    out.append(r)
    return _canonical_sorted(out, level.unit_m)


def build_level(
    level: Level,
    *,
    out_dir,
    rendered,
    vols_by_building,
    flat,
    flat_index,
    extent_poly,
    extent_box,
    bbox,
    to_local,
    only: set | None = None,
) -> dict:
    """Write every block of one level; return {manifest, summary, dropped}.

    ``rendered``: the rendered buildings (sorted by key); ``vols_by_building``: their volumes;
    ``flat`` / ``flat_index``: the flat layer features of the base export; ``to_local``: the
    EPSG:32632 to local-metres translation. ``only`` restricts the blocks (experiments).
    """
    from milano_iso.tiles import export as ex

    size = level.block_m
    block_of: dict[tuple[int, int], list] = {}
    for b in rendered.itertuples(index=False):
        rp = b.geometry.representative_point()
        block_of.setdefault(grid.tile_ij(rp.x, rp.y, size=size), []).append(b)
    shapely.prepare(extent_poly)
    covering = {
        t
        for t in grid.tiles_covering(bbox, size)
        if shapely.intersects(extent_poly, box(*grid.tile_bbox(*t, size=size)))
    }
    blocks = sorted(covering | set(block_of))
    if only is not None:
        blocks = [t for t in blocks if t in only]

    entries, stats, dropped = [], {}, []
    n_in = n_kept = n_vol_dropped = 0
    bound = 0.0
    for i, j in blocks:
        name = f"{level.prefix}_{grid.tile_name(i, j)}"
        tbox = box(*grid.tile_bbox_local(i, j, size))
        fbox = tbox.intersection(extent_box)
        centre = (size * i + size / 2, -(size * j + size / 2))
        meshes, tables, layer_stats = [], {}, {}

        mb = geom.MeshBuilder()
        table = []
        n_vols = 0
        for b in block_of.get((i, j), []):
            n_in += 1
            keep, reason = keep_building(level, b, float(b.geometry.area))
            if not keep:
                dropped.append((level.level, b.building_key, reason))
                continue
            vols = [
                (p, float(v.bottom_m), float(v.top_m))
                for v in vols_by_building.get(b.building_key, [])
                for p in geom.polygons_of(to_local(v.geometry))
            ]
            pieces, n_drop, bd = prisms_of_building(vols, level)
            n_vol_dropped += n_drop
            bound = max(bound, bd)
            if not pieces:
                dropped.append((level.level, b.building_key, "every volume is under the tolerance"))
                continue
            fid = len(table)
            table.append(
                {
                    "key": b.building_key,
                    "name": ex._clean(b.name),
                    "building_type": ex._clean(b.building_type),
                    "height_m": ex._clean(b.height_m),
                    "height_source": ex._clean(b.height_source),
                    "landmark_id": ex._clean(b.landmark_id),
                }
            )
            for parts, bottom, top in pieces:
                for part in parts:
                    mb.add_extrusion(part, bottom, top, fid)
                n_vols += 1
            n_kept += 1
        if table:
            meshes.extend(ex._named("buildings", mb))
            tables["buildings"] = table
            layer_stats["buildings"] = {
                "features": len(table),
                "volumes": n_vols,
                "vertices": mb.n_vertices,
                "triangles": mb.n_triangles,
            }

        for layer in level.flat_layers:
            mf = geom.MeshBuilder()
            table = []
            hits = [] if fbox.is_empty else flat_index[layer].features_in(fbox)
            for f, hit_polys in hits:
                cls = f["entry"].get("class")
                if layer == "roads" and cls not in level.road_classes:
                    continue
                if layer == "rail" and cls not in level.rail_classes:
                    continue
                clipped = clip_flat(hit_polys, fbox, level)
                if not clipped:
                    continue
                fid = len(table)
                before = mf.n_vertices
                for p in clipped:
                    mf.add_flat(p, style.LAYER_HEIGHT_M[layer], fid)
                if mf.n_vertices > before:
                    table.append(f["entry"])
            if table:
                meshes.extend(ex._named(layer, mf))
                tables[layer] = table
                layer_stats[layer] = {
                    "features": len(table),
                    "vertices": mf.n_vertices,
                    "triangles": mf.n_triangles,
                }

        written = ex.write_tile(
            out_dir, name, i, j, meshes, tables, layer_stats, centre, unit=level.unit_m, size=size
        )
        if written is None:
            continue
        entry, _blob = written
        entries.append(entry)
        stats[name] = {
            "glb_bytes": entry["glb"]["bytes"],
            "gzip9_bytes": entry["glb"]["gzip9_bytes"],
            "features_json_bytes": entry["features"]["bytes"],
            "max_offset_from_centre_m": round(ex._max_offset(meshes, centre), 3),
            "layers": layer_stats,
        }
    entries.sort(key=lambda e: e["id"])
    counts: dict[str, int] = {}
    for e in entries:
        for k, v in e["counts"].items():
            counts[k] = counts.get(k, 0) + v
    desc = level.describe()
    desc["tiles"] = entries
    desc["totals"] = {
        "tiles": len(entries),
        "counts": dict(sorted(counts.items())),
        "glb_bytes": sum(e["glb"]["bytes"] for e in entries),
        "gzip9_bytes": sum(e["glb"]["gzip9_bytes"] for e in entries),
        "features_bytes": sum(e["features"]["bytes"] for e in entries),
    }
    summary = {
        "level": level.level,
        "block_m": size,
        "tolerance_m": level.tolerance_m,
        "buildings_in": n_in,
        "buildings_kept": n_kept,
        "buildings_dropped": len(dropped),
        "volumes_dropped_under_tolerance": n_vol_dropped,
        "max_error_bound_m": round(bound, 6),
        "tiles": stats,
        "max_gzip9_bytes": max((s["gzip9_bytes"] for s in stats.values()), default=0),
    }
    return {"manifest": desc, "summary": summary, "dropped": dropped}


def dropped_csv(rows: list[tuple[int, str, str]]) -> bytes:
    lines = ["level,building_key,reason"] + [f"{lv},{k},{r}" for lv, k, r in sorted(rows)]
    return ("\n".join(lines) + "\n").encode("utf-8")
