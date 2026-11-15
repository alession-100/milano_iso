"""Geometry helpers."""

import itertools


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
