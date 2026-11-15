"""Geometry helpers."""

import hashlib
import itertools
from pathlib import Path

import numpy as np
import pyogrio
import shapely


def polygon_centroid_area(ring):
    """Signed area and centroid (cx, cy) of a closed ring of (x, y) vertices.

    Numerically stable: the first vertex is subtracted before the shoelace sum, so
    coordinates of about 5e6 m (EPSG:32632) do not cancel catastrophically.
    The area is positive for counter-clockwise rings.
    """
    bx, by = ring[0]
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in itertools.pairwise(ring):
        x0 -= bx
        y0 -= by
        x1 -= bx
        y1 -= by
        cr = x0 * y1 - x1 * y0
        a += cr
        cx += (x0 + x1) * cr
        cy += (y0 + y1) * cr
    a *= 0.5
    return a, bx + cx / (6 * a), by + cy / (6 * a)


def canonical_dump_sha256(gpkg: Path) -> str:
    """sha256 of a canonical text dump (layers sorted by name, rows in stored order,
    WKB geometry, repr of attribute values). Independent of gpkg file-level metadata."""
    h = hashlib.sha256()
    for layer in sorted(name for name, _ in pyogrio.list_layers(gpkg)):
        info = pyogrio.read_info(gpkg, layer=layer)
        h.update(f"LAYER {layer} {info['crs']} {info['geometry_type']}\n".encode())
        df = pyogrio.read_dataframe(gpkg, layer=layer)
        h.update(("COLUMNS " + ",".join(f"{c}:{df[c].dtype}" for c in df.columns) + "\n").encode())
        for row in df.itertuples(index=False):
            parts = []
            for v in row:
                if isinstance(v, shapely.Geometry):
                    parts.append(shapely.to_wkb(v, output_dimension=3, byte_order=1).hex())
                elif v is None or (isinstance(v, float) and np.isnan(v)):
                    parts.append("None")
                else:
                    parts.append(repr(v))
            h.update(("|".join(parts) + "\n").encode())
    return h.hexdigest()
