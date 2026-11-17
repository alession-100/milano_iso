"""Build the stylised landmark details of T-4.2 from a spec (landmark_style.py) and the data.

All geometry here is in local metres (E - E0, N - N0, up), the frame of the tile export. A detail
is a small triangle mesh plus the facts the checks need (``base_m``, ``sits_on_m``). Every detail
is STYLISED (flagged ``stylised: true`` downstream); none of them changes a footprint or a
height taken from data. Deterministic: sorted iteration, no randomness.
"""

import itertools
import math
from dataclasses import dataclass

import numpy as np
import shapely
from shapely.geometry import MultiPoint, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import polylabel

from milano_iso import landmark_style as ls
from milano_iso.tiles import geom

SIT_EPS_M = 1e-6  # numeric slack when comparing heights


@dataclass(frozen=True)
class Volume:
    """A rendered DBT volume in local metres."""

    key: str
    geom: object  # Polygon or MultiPolygon
    bottom_m: float
    top_m: float


@dataclass
class Detail:
    landmark_id: str
    kind: str
    anchor: tuple[float, float]  # local x, y: decides the tile
    base_m: float  # lowest z of the mesh
    sits_on_m: float  # top of the surface the detail rests on (== base_m)
    tris: np.ndarray  # (n, 3, 3) local ENU, counter-clockwise seen from outside


def _round(x: float) -> float:
    return round(float(x), 6)


def _ring_points(n: int, r: float, cx: float, cy: float) -> list[tuple[float, float]]:
    """``n`` points counter-clockwise on a circle; the first sits at angle 45 deg (square axes)."""
    return [
        (
            _round(cx + r * math.cos(math.pi / 4 + 2 * math.pi * k / n)),
            _round(cy + r * math.sin(math.pi / 4 + 2 * math.pi * k / n)),
        )
        for k in range(n)
    ]


def prism_tris(p: ls.Prism, x: float, y: float, z: float) -> np.ndarray:
    """Shaft walls plus a pyramid tip, resting on z (no bottom face)."""
    ring = _ring_points(p.sides, p.radius_m, x, y)
    top = z + p.shaft_m
    tris = []
    for k in range(p.sides):
        (ax, ay), (bx, by) = ring[k], ring[(k + 1) % p.sides]
        if p.shaft_m > 0:
            tris.append([[ax, ay, z], [bx, by, z], [bx, by, top]])
            tris.append([[ax, ay, z], [bx, by, top], [ax, ay, top]])
        tris.append([[ax, ay, top], [bx, by, top], [x, y, top + p.tip_m]])
    return np.asarray(tris, dtype=np.float64)


def _densify(ring, step: float) -> list[tuple[float, float]]:
    pts = []
    c = list(ring.coords)
    for a, b in itertools.pairwise(c):
        n = max(1, math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        pts += [
            (_round(a[0] + (b[0] - a[0]) * k / n), _round(a[1] + (b[1] - a[1]) * k / n))
            for k in range(n)
        ]
    return pts


def _boundary_distance(poly: Polygon, pts: np.ndarray) -> np.ndarray:
    return shapely.distance(poly.boundary, shapely.points(pts))


def heightfield_tris(poly: Polygon, base: float, height_of, grid: float) -> np.ndarray:
    """Triangulated surface over ``poly``: z = base + height_of(distance to the edge).

    Points: the densified boundary, a regular grid inside (at least half a cell from the edge)
    and the pole of inaccessibility. Delaunay triangles whose centroid lies inside the polygon are
    kept. Shared vertices keep the surface watertight.
    """
    pts = []
    for ring in (poly.exterior, *poly.interiors):
        pts += _densify(ring, ls.BOUNDARY_STEP_M)
    x0, y0, x1, y1 = poly.bounds
    gx = np.arange(math.floor(x0 / grid) * grid, x1 + grid, grid)
    gy = np.arange(math.floor(y0 / grid) * grid, y1 + grid, grid)
    inner = poly.buffer(-grid / 2.0)
    for gx_i in gx:
        for gy_i in gy:
            if not inner.is_empty and inner.contains(Point(gx_i, gy_i)):
                pts.append((_round(gx_i), _round(gy_i)))
    pole = polylabel(poly, 0.05)
    pts.append((_round(pole.x), _round(pole.y)))
    arr = np.unique(np.asarray(pts, dtype=np.float64), axis=0)
    if len(arr) < 3:
        return np.zeros((0, 3, 3))
    tin = shapely.delaunay_triangles(MultiPoint([tuple(p) for p in arr]))
    d = _boundary_distance(poly, arr)
    z_of = {
        (float(p[0]), float(p[1])): base + float(height_of(float(dd)))
        for p, dd in zip(arr, d, strict=True)
    }
    out = []
    for t in tin.geoms:
        c = np.asarray(t.exterior.coords[:3], dtype=np.float64)
        if not poly.buffer(1e-6).contains(t.centroid):
            continue
        area2 = (c[1, 0] - c[0, 0]) * (c[2, 1] - c[0, 1]) - (c[2, 0] - c[0, 0]) * (
            c[1, 1] - c[0, 1]
        )
        if abs(area2) < 1e-9:
            continue
        if area2 < 0:
            c = c[[0, 2, 1]]
        out.append([[v[0], v[1], z_of[(float(v[0]), float(v[1]))]] for v in c])
    return np.asarray(out, dtype=np.float64).reshape(-1, 3, 3)


def hip_tris(poly: Polygon, base: float, rise: float) -> np.ndarray:
    """Pitched roof: height grows linearly from 0 at the edge to ``rise`` at the pole."""
    pole = polylabel(poly, 0.05)
    dmax = float(poly.boundary.distance(pole))
    if dmax <= 0:
        return np.zeros((0, 3, 3))
    return heightfield_tris(poly, base, lambda d: rise * min(d / dmax, 1.0), ls.CAP_GRID_M)


def vault_tris(poly: Polygon, base: float, rise_frac: float) -> tuple[np.ndarray, float]:
    """Arch vault: z = base + rise * sqrt(1 - (1 - min(d / W, 1))^2), W = A / P (half-span).

    Returns the triangles and the rise in metres.
    """
    half_span = poly.area / poly.length
    rise = rise_frac * half_span

    def h(d: float) -> float:
        s = min(d / half_span, 1.0)
        return rise * math.sqrt(max(0.0, 1.0 - (1.0 - s) ** 2))

    return heightfield_tris(poly, base, h, ls.VAULT_GRID_M), rise


def slab_tris(poly: Polygon, base: float, thickness: float, inset: float) -> np.ndarray:
    """Flat slab: walls from base to base + thickness and a top cap."""
    p = poly.buffer(-inset) if inset > 0 else poly
    mb = geom.MeshBuilder()
    for part in geom.polygons_of(p):
        mb.add_extrusion(part, base, base + thickness, 0)
    return _mb_tris(mb)


def _mb_tris(mb: geom.MeshBuilder) -> np.ndarray:
    if not mb.n_triangles:
        return np.zeros((0, 3, 3))
    xyz = np.asarray(mb._xyz, dtype=np.float64)
    return xyz[np.asarray(mb._tri, dtype=np.int64)]


# ---------------------------------------------------------------------------------------------
# Selection and placement
# ---------------------------------------------------------------------------------------------
def _sorted(volumes) -> list[Volume]:
    return sorted(volumes, key=lambda v: v.key)


def select(sel: ls.Select, volumes: list[Volume]) -> list[Volume]:
    vols = _sorted(volumes)
    if not vols:
        return []
    tallest = max(vols, key=lambda v: (v.top_m, v.key))
    top_max = tallest.top_m
    out = []
    for v in vols:
        if sel.tallest_only and v is not tallest:
            continue
        if sel.skip_tallest and v is tallest:
            continue
        if v.top_m < sel.min_top_frac * top_max:
            continue
        a = v.geom.area
        if a < sel.min_area_m2 or a > sel.max_area_m2:
            continue
        out.append(v)
    return out


def rest_height(point: Point, volumes: list[Volume]) -> float | None:
    """Top of the highest volume whose footprint covers the point (None if none does)."""
    tops = [v.top_m for v in volumes if v.geom.buffer(1e-6).contains(point)]
    return max(tops) if tops else None


def exposed_parts(vol: Volume, volumes: list[Volume]) -> list[Polygon]:
    """The part of a volume's footprint that no higher volume covers, as polygons.

    "Higher" is ordered by (top_m, key), so two volumes with equal tops never both cap.
    """
    higher = [v.geom for v in volumes if v is not vol and (v.top_m, v.key) > (vol.top_m, vol.key)]
    g = vol.geom
    if higher:
        g = g.difference(shapely.union_all(higher))
    return [p for p in geom.polygons_of(g) if p.area >= ls.MIN_CAP_AREA_M2]


def _edge_points(sel_vols: list[Volume], item: ls.Item) -> list[Point]:
    union = shapely.union_all([v.geom for v in sel_vols])
    inset = union.buffer(-item.inset_m) if item.inset_m > 0 else union
    pts = []
    for poly in geom.polygons_of(inset):
        ring = poly.exterior
        length = ring.length
        if length <= 0:
            continue
        n = item.count if item.count else max(1, math.ceil(length / float(item.spacing_m)))
        if item.count and len(geom.polygons_of(inset)) > 1:
            n = max(
                1,
                round(
                    item.count * length / sum(p.exterior.length for p in geom.polygons_of(inset))
                ),
            )
        for k in range(n):
            pts.append(ring.interpolate(length * k / n))
    return pts


def build_item(landmark_id: str, item: ls.Item, volumes: list[Volume]) -> list[Detail]:
    """Details of one item on the landmark's rendered volumes (not for ``roof`` items)."""
    sel = select(item.select, volumes)
    out: list[Detail] = []
    prim = item.primitive
    if item.place in ("centre", "edge"):
        if not isinstance(prim, ls.Prism):
            raise ValueError(f"{item.place} placement needs a Prism, got {type(prim).__name__}")
        if item.place == "centre":
            pts = []
            for v in sel:
                parts = geom.polygons_of(v.geom)
                if parts:
                    pts.append(polylabel(max(parts, key=lambda p: p.area), 0.05))
        else:
            pts = _edge_points(sel, item)
        for p in pts:
            z = rest_height(p, volumes)
            if z is None:
                continue  # a point not covered by any rendered volume: nothing to rest on
            x, y = _round(p.x), _round(p.y)
            out.append(Detail(landmark_id, prim.kind, (x, y), z, z, prism_tris(prim, x, y, z)))
        return out
    if item.place == "cap":
        for v in sel:
            for part in exposed_parts(v, volumes):
                part = orient(part, 1.0)
                if isinstance(prim, ls.HipCap):
                    tris = hip_tris(part, v.top_m, prim.rise_m)
                elif isinstance(prim, ls.SlabCap):
                    tris = slab_tris(part, v.top_m, prim.thickness_m, prim.inset_m)
                elif isinstance(prim, ls.VaultCap):
                    tris, _ = vault_tris(part, v.top_m, prim.rise_frac)
                else:
                    raise TypeError(f"cap placement does not take {type(prim).__name__}")
                if len(tris) == 0:
                    continue
                c = part.representative_point()
                out.append(
                    Detail(
                        landmark_id,
                        prim.kind,
                        (_round(c.x), _round(c.y)),
                        v.top_m,
                        v.top_m,
                        tris,
                    )
                )
        return out
    raise ValueError(f"unknown placement {item.place!r}")


def adjacent_volumes(roof, volumes: list[Volume], src: ls.RoofSource) -> list[Volume]:
    """Rendered volumes within ``eave_buffer_m`` of the roof footprint, with real contact.

    A volume counts when at least ``eave_min_overlap_m2`` of its footprint lies inside the
    buffered roof footprint (smaller overlaps are slivers).
    """
    zone = roof.buffer(src.eave_buffer_m)
    return [
        v for v in _sorted(volumes) if v.geom.intersection(zone).area >= src.eave_min_overlap_m2
    ]


def eave_height(adjacent: list[Volume]) -> float:
    """Base of the vault: the lowest ``top_m`` of the adjacent rendered volumes."""
    if not adjacent:
        raise ValueError("no adjacent rendered volume: the vault eave cannot be derived")
    return min(v.top_m for v in adjacent)


def build_roof_item(
    landmark_id: str, item: ls.Item, roof_geom, adjacent: list[Volume]
) -> tuple[list[Detail], dict]:
    """Vault over an external footprint; returns the details and the facts of the derivation."""
    prim = item.primitive
    if not isinstance(prim, ls.VaultCap):
        raise TypeError("roof placement needs a VaultCap")
    base = eave_height(adjacent)
    out = []
    rises = []
    for part in geom.polygons_of(roof_geom):
        part = orient(part, 1.0)
        tris, rise = vault_tris(part, base, prim.rise_frac)
        rises.append(rise)
        c = part.representative_point()
        out.append(Detail(landmark_id, prim.kind, (_round(c.x), _round(c.y)), base, base, tris))
    facts = {
        "eave_m": base,
        "adjacent_volumes": [(v.key, v.top_m) for v in adjacent],
        "rise_m": max(rises) if rises else 0.0,
    }
    return out, facts


def build_landmark(
    spec: ls.LandmarkSpec,
    volumes: list[Volume],
    roof_geom=None,
    adjacent: list[Volume] | None = None,
) -> tuple[list[Detail], dict]:
    """All details of a landmark. ``volumes``: the landmark's own rendered volumes."""
    details: list[Detail] = []
    facts: dict = {}
    for item in spec.items:
        if item.place == "roof":
            if roof_geom is None:
                raise ValueError(f"{spec.landmark_id}: roof footprint missing")
            d, facts = build_roof_item(spec.landmark_id, item, roof_geom, adjacent or [])
        else:
            d = build_item(spec.landmark_id, item, volumes)
        details += d
    return details, facts
