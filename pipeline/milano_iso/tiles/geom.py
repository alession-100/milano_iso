"""Geometry for the tile export: simplification, extrusion, triangulation, ribbons.

All functions work in local metres (E - E0, N - N0) with the Z-up right-handed frame
(east, north, up). ``MeshBuilder.to_gl`` converts to the client frame x = E, y = up,
z = -N (a proper rotation, so counter-clockwise winding is preserved).
"""

import itertools
import math

import numpy as np
import shapely
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

from milano_iso import style

SIMPLIFY_TOLERANCE_M = 0.2
MAX_HAUSDORFF_M = 0.5
MIN_AREA_M2 = 1e-6


def polygons_of(geom) -> list[Polygon]:
    """Polygon parts of any geometry, in a stable order, without empty or sliver parts."""
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        parts = [geom]
    elif hasattr(geom, "geoms"):
        parts = [p for g in geom.geoms for p in polygons_of(g)]
    else:
        parts = []
    return [p for p in parts if p.area > MIN_AREA_M2]


def simplify_footprint(poly: Polygon) -> tuple[list[Polygon], float]:
    """Simplify with tolerance 0.2 m; return the parts and the Hausdorff distance to the input.

    Raises ValueError when the distance exceeds 0.5 m (ADR-0021).
    """
    simp = poly.simplify(SIMPLIFY_TOLERANCE_M, preserve_topology=True)
    if not simp.is_valid or simp.is_empty:
        simp = poly  # keep the original rather than a broken simplification
    h = float(shapely.hausdorff_distance(poly, simp))
    if h > MAX_HAUSDORFF_M:
        raise ValueError(f"Hausdorff {h:.3f} m exceeds {MAX_HAUSDORFF_M} m")
    return polygons_of(simp), h


def triangulate_polygon(poly: Polygon) -> np.ndarray:
    """Triangles (n, 3, 2) of a polygon with holes, constrained to the polygon.

    Each triangle is counter-clockwise; the output order is deterministic.
    """
    tris = shapely.constrained_delaunay_triangles(poly)
    out = []
    for t in tris.geoms:
        c = np.array(t.exterior.coords[:3], dtype=np.float64)
        area2 = (c[1, 0] - c[0, 0]) * (c[2, 1] - c[0, 1]) - (c[2, 0] - c[0, 0]) * (
            c[1, 1] - c[0, 1]
        )
        if abs(area2) < 1e-12:
            continue
        if area2 < 0:
            c = c[[0, 2, 1]]
        s = min(range(3), key=lambda m: (c[m, 0], c[m, 1]))
        out.append(np.roll(c, -s, axis=0))
    if not out:
        return np.zeros((0, 3, 2))
    arr = np.stack(out)
    order = np.lexsort(
        (arr[:, 2, 1], arr[:, 2, 0], arr[:, 1, 1], arr[:, 1, 0], arr[:, 0, 1], arr[:, 0, 0])
    )
    return arr[order]


class MeshBuilder:
    """Accumulates flat-shaded triangles (duplicated vertices) in the local ENU frame."""

    def __init__(self) -> None:
        self._pos: list[np.ndarray] = []
        self._nrm: list[np.ndarray] = []
        self._fid: list[np.ndarray] = []

    def add_triangles(self, tris: np.ndarray, normals: np.ndarray, fid: int) -> None:
        """tris (n, 3, 3), normals (n, 3): one normal per triangle."""
        n = len(tris)
        if n == 0:
            return
        self._pos.append(tris.reshape(n * 3, 3))
        self._nrm.append(np.repeat(normals, 3, axis=0))
        self._fid.append(np.full(n * 3, fid, dtype=np.uint32))

    @property
    def n_vertices(self) -> int:
        return sum(len(p) for p in self._pos)

    @property
    def n_triangles(self) -> int:
        return self.n_vertices // 3

    def add_flat(self, poly: Polygon, z: float, fid: int) -> None:
        """Upward-facing triangulated polygon at height z."""
        t2 = triangulate_polygon(poly)
        if len(t2) == 0:
            return
        tris = np.concatenate([t2, np.full((len(t2), 3, 1), z)], axis=2)
        self.add_triangles(tris, np.tile([0.0, 0.0, 1.0], (len(t2), 1)), fid)

    def add_extrusion(self, poly: Polygon, bottom: float, top: float, fid: int) -> None:
        """Walls from bottom to top, a flat top cap, and a bottom cap only if bottom > 0."""
        poly = orient(poly, 1.0)  # exterior CCW, holes CW: outward is right of the edge
        wall_t, wall_n = [], []
        for ring in (poly.exterior, *poly.interiors):
            c = np.asarray(ring.coords, dtype=np.float64)
            for a, b in itertools.pairwise(c):
                dx, dy = b[0] - a[0], b[1] - a[1]
                length = math.hypot(dx, dy)
                if length < 1e-9:
                    continue
                nrm = [dy / length, -dx / length, 0.0]
                a0 = [a[0], a[1], bottom]
                b0 = [b[0], b[1], bottom]
                b1 = [b[0], b[1], top]
                a1 = [a[0], a[1], top]
                wall_t += [[a0, b0, b1], [a0, b1, a1]]
                wall_n += [nrm, nrm]
        if wall_t:
            self.add_triangles(np.array(wall_t), np.array(wall_n), fid)
        t2 = triangulate_polygon(poly)
        if len(t2):
            up = np.concatenate([t2, np.full((len(t2), 3, 1), top)], axis=2)
            self.add_triangles(up, np.tile([0.0, 0.0, 1.0], (len(t2), 1)), fid)
            if bottom > 0:
                dn = np.concatenate([t2, np.full((len(t2), 3, 1), bottom)], axis=2)[:, [0, 2, 1]]
                self.add_triangles(dn, np.tile([0.0, 0.0, -1.0], (len(t2), 1)), fid)

    def to_gl(self) -> dict[str, np.ndarray]:
        """Client frame (x = E, y = up, z = -N), cast to float32 last."""
        if not self._pos:
            raise ValueError("empty mesh")
        p = np.concatenate(self._pos)
        n = np.concatenate(self._nrm)
        fid = np.concatenate(self._fid)
        pos = np.stack([p[:, 0], p[:, 2], -p[:, 1]], axis=1).astype(np.float32)
        nrm = np.stack([n[:, 0], n[:, 2], -n[:, 1]], axis=1).astype(np.float32)
        return {
            "positions": pos,
            "normals": nrm,
            "feature_ids": fid,
            "indices": np.arange(len(pos), dtype=np.uint32),
        }


def parse_width(raw) -> float | None:
    """Metres from an OSM width tag such as '7.3' or '1.20 m'; None if not valid."""
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return None
    s = str(raw).strip().lower().replace(",", ".")
    if s.endswith("m"):
        s = s[:-1].strip()
    try:
        w = float(s)
    except ValueError:
        return None
    if not math.isfinite(w) or w <= 0 or w > style.MAX_TAG_WIDTH_M:
        return None
    return w


def ribbon_width(width_raw, cls: str, table: dict[str, float]) -> tuple[float, str]:
    """Width and its source: 'osm' for a valid tag, else 'style' (class table)."""
    w = parse_width(width_raw)
    if w is not None:
        return w, "osm"
    if cls not in table:
        raise KeyError(f"no style width for class {cls!r}")
    return table[cls], "style"


def ribbon(line, width: float):
    """Buffer of a line by half the width: flat caps, mitre joins with a limit."""
    return line.buffer(
        width / 2.0, cap_style="flat", join_style="mitre", mitre_limit=style.MITRE_LIMIT
    )
