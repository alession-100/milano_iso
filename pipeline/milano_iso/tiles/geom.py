"""Geometry for the tile export: simplification, extrusion, triangulation, ribbons.

All functions work in local metres (E - E0, N - N0) with the Z-up right-handed frame
(east, north, up). ``MeshBuilder.to_gl_chunks`` converts to the client frame x = E, y = up,
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
MAX_CHUNK_VERTICES = 65535  # uint16 indices (ADR-0022)


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
    """Accumulates indexed triangles with shared vertices in the local ENU frame (ADR-0022).

    A vertex is identified by (x, y, z, feature id), so a ring vertex is stored once per height.
    Triangles are counter-clockwise seen from outside; normals are not stored (flat shading in
    the client derives them from screen-space derivatives).
    """

    def __init__(self) -> None:
        self._index: dict[tuple[float, float, float, int], int] = {}
        self._xyz: list[tuple[float, float, float]] = []
        self._fid: list[int] = []
        self._tri: list[tuple[int, int, int]] = []

    def _vertex(self, x: float, y: float, z: float, fid: int) -> int:
        key = (float(x), float(y), float(z), fid)
        k = self._index.get(key)
        if k is None:
            k = len(self._xyz)
            self._index[key] = k
            self._xyz.append(key[:3])
            self._fid.append(fid)
        return k

    def add_triangles(self, tris: np.ndarray, fid: int) -> None:
        """tris (n, 3, 3): counter-clockwise seen from outside."""
        for t in tris:
            a, b, c = (self._vertex(v[0], v[1], v[2], fid) for v in t)
            if a != b and b != c and a != c:
                self._tri.append((a, b, c))

    @property
    def n_vertices(self) -> int:
        return len(self._xyz)

    @property
    def n_triangles(self) -> int:
        return len(self._tri)

    def add_flat(self, poly: Polygon, z: float, fid: int) -> None:
        """Upward-facing triangulated polygon at height z."""
        t2 = triangulate_polygon(poly)
        if len(t2) == 0:
            return
        self.add_triangles(np.concatenate([t2, np.full((len(t2), 3, 1), z)], axis=2), fid)

    def add_extrusion(self, poly: Polygon, bottom: float, top: float, fid: int) -> None:
        """Walls from bottom to top, a flat top cap, and a bottom cap only if bottom > 0."""
        poly = orient(poly, 1.0)  # exterior CCW, holes CW: outward is right of the edge
        wall = []
        for ring in (poly.exterior, *poly.interiors):
            c = np.asarray(ring.coords, dtype=np.float64)
            for a, b in itertools.pairwise(c):
                if math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-9:
                    continue
                a0 = [a[0], a[1], bottom]
                b0 = [b[0], b[1], bottom]
                b1 = [b[0], b[1], top]
                a1 = [a[0], a[1], top]
                wall += [[a0, b0, b1], [a0, b1, a1]]
        if wall:
            self.add_triangles(np.array(wall), fid)
        t2 = triangulate_polygon(poly)
        if len(t2):
            self.add_triangles(np.concatenate([t2, np.full((len(t2), 3, 1), top)], axis=2), fid)
            if bottom > 0:
                dn = np.concatenate([t2, np.full((len(t2), 3, 1), bottom)], axis=2)[:, [0, 2, 1]]
                self.add_triangles(dn, fid)

    def to_gl_chunks(self, max_vertices: int = MAX_CHUNK_VERTICES) -> list[dict[str, np.ndarray]]:
        """Client frame (x = E, y = up, z = -N), float64, split into chunks of at most
        ``max_vertices`` vertices (triangles stay whole, in insertion order)."""
        if not self._tri:
            raise ValueError("empty mesh")
        xyz = np.asarray(self._xyz, dtype=np.float64)
        pos_all = np.stack([xyz[:, 0], xyz[:, 2], -xyz[:, 1]], axis=1)
        fid_all = np.asarray(self._fid, dtype=np.int64)
        chunks, remap, verts, idx = [], {}, [], []

        def flush() -> None:
            sel = np.asarray(verts, dtype=np.int64)
            chunks.append(
                {
                    "positions": pos_all[sel],
                    "feature_ids": fid_all[sel],
                    "indices": np.asarray(idx, dtype=np.int64),
                }
            )

        for tri in self._tri:
            new = sum(1 for v in set(tri) if v not in remap)
            if remap and len(remap) + new > max_vertices:
                flush()
                remap, verts, idx = {}, [], []
            for v in tri:
                if v not in remap:
                    remap[v] = len(verts)
                    verts.append(v)
                idx.append(remap[v])
        flush()
        return chunks


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
